/**
 * The audit pipeline.
 *
 * Stage order: parse → rule checks → rendered contrast checks → ML inference →
 * scoring. Progress is reported after every stage with real counts and
 * timestamps, so the pipeline panel in the UI shows what actually happened.
 *
 * Honest browser limitation: `DOMParser` and `getComputedStyle` do not exist
 * inside a Web Worker, so parsing and the rendered contrast pass must run on
 * the main thread. The pipeline yields to the browser between stages
 * (`requestAnimationFrame`) so the interface keeps repainting, and the ML
 * inference runs through TensorFlow.js, which uses WebGL off the main thread
 * where the device supports it.
 */

import type { Finding, Issue, IssueEvidence, MlDetail, PipelineStage, SeverityRow, Severity } from "../types";
import {
  CATEGORY_CODE,
  RULE_INDEX,
  RULES,
  WCAG_CRITERIA_COVERED,
  accessibleName,
  cssPath,
  principleOf,
  runContrastChecks,
  runRuleChecks,
  snippetOf,
} from "./rules";
import { computeScore } from "./scoring";
import { predictSeverity, predictText } from "../ml/engine";

export type DraftIssue = Omit<Issue, "id" | "audit_id" | "created_at">;

export interface AuditCoverage {
  rulesExecuted: number;
  criteriaRepresented: number;
  elementsInspected: number;
  contrastRendered: boolean;
  categories: string[];
}

export interface PipelineResult {
  issues: DraftIssue[];
  elementCount: number;
  durationMs: number;
  score: number;
  stages: PipelineStage[];
  mlUsed: boolean;
  coverage: AuditCoverage;
}

export interface PipelineOptions {
  onStage?: (stage: PipelineStage) => void;
  /** Called for every model inference when verification mode is on. */
  onTrace?: (line: string) => void;
  /** Skip all model inference (used by the validation suite for a rules-only run). */
  rulesOnly?: boolean;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

/**
 * Render HTML inside a sandboxed, off-screen iframe so computed styles exist.
 *
 * Security: `sandbox="allow-same-origin"` WITHOUT `allow-scripts` means no
 * script in the user's HTML can run, no forms submit, no popups open and no
 * top-level navigation happens; the parent can still read computed styles.
 */
export async function renderInIframe(html: string): Promise<{ doc: Document; dispose: () => void } | null> {
  if (typeof document === "undefined") return null;
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.setAttribute("title", "Accessibility analysis sandbox");
  frame.style.cssText = "position:absolute;left:-10000px;top:0;width:1024px;height:900px;border:0;";
  frame.srcdoc = html;
  document.body.appendChild(frame);
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    frame.addEventListener("load", done, { once: true });
    setTimeout(done, 1500);
  });
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return null;
  }
  return { doc, dispose: () => frame.remove() };
}

function evidenceOf(finding: Finding): IssueEvidence {
  const values: Record<string, string | number | boolean> = {};
  const extra = finding.extra ?? {};
  if (extra.altText !== undefined) values.alt = extra.altText;
  if (extra.linkText !== undefined) values.linkText = extra.linkText;
  if (extra.ratio !== undefined) values.contrastRatio = Number(extra.ratio.toFixed(2));
  if (extra.required !== undefined) values.requiredRatio = extra.required;
  if (extra.fg) values.foreground = extra.fg;
  if (extra.bg) values.background = extra.bg;
  if (extra.largeText !== undefined) values.largeText = extra.largeText;
  return {
    tag: finding.el?.tagName.toLowerCase() ?? "document",
    trigger: RULE_INDEX[finding.ruleId]?.trigger ?? "",
    values,
  };
}

function isInNav(el: Element | null): boolean {
  if (!el) return false;
  return Boolean(el.closest('nav, header, [role="navigation"]'));
}

function isInteractive(el: Element | null): boolean {
  if (!el) return false;
  return el.matches('a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [onclick], [tabindex]');
}

function positionOf(el: Element | null, all: Element[]): number {
  if (!el || all.length === 0) return 0;
  const index = all.indexOf(el);
  return index < 0 ? 0.5 : index / all.length;
}

export async function runPipeline(html: string, options: PipelineOptions = {}): Promise<PipelineResult> {
  const started = performance.now();
  const stages: PipelineStage[] = [];
  const emit = (stage: PipelineStage["stage"], label: string, detail: string, progress: number) => {
    const event: PipelineStage = { stage, label, detail, at: Math.round(performance.now() - started), progress };
    stages.push(event);
    options.onStage?.(event);
  };

  // ---- 1. Parse -------------------------------------------------------
  emit("parsing", "Parsing", "Building the DOM with DOMParser", 0.05);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const allElements = Array.from(doc.querySelectorAll("*"));
  const elementCount = allElements.length;
  emit("parsing", "Parsing", `${elementCount} elements parsed`, 0.15);
  await nextFrame();

  // ---- 2. Rule checks --------------------------------------------------
  emit("rules", "Rule checks", "Running deterministic WCAG 2.1 checks", 0.2);
  const findings = runRuleChecks(doc);
  emit("rules", "Rule checks", `${findings.length} rule findings`, 0.4);
  await nextFrame();

  // ---- 3. Contrast on a rendered copy ---------------------------------
  emit("contrast", "Contrast", "Rendering the page in a sandboxed frame", 0.45);
  const rendered = await renderInIframe(html);
  let contrastFindings: typeof findings = [];
  if (rendered) {
    contrastFindings = runContrastChecks(rendered.doc);
    emit("contrast", "Contrast", `${contrastFindings.length} text nodes below the required ratio`, 0.55);
  } else {
    emit("contrast", "Contrast", "Rendered pass unavailable in this environment — skipped", 0.55);
  }

  const combined = [...findings, ...contrastFindings];
  const ruleCounts = combined.reduce<Record<string, number>>((acc, f) => {
    acc[f.ruleId] = (acc[f.ruleId] ?? 0) + 1;
    return acc;
  }, {});

  // ---- 4. ML inference -------------------------------------------------
  emit("ml", "ML inference", "Scoring alt text, link text and severity", 0.6);
  let mlUsed = false;
  const drafts: DraftIssue[] = [];

  // 4a. model-discovered issues the rules cannot judge
  const mlFindings: typeof combined = [];
  const imagesWithAlt = Array.from(doc.querySelectorAll("img[alt]")).filter((img) => {
    const alt = (img.getAttribute("alt") ?? "").trim();
    return alt.length > 0 && alt.length <= 150;
  });
  for (const img of imagesWithAlt) {
    const alt = (img.getAttribute("alt") ?? "").trim();
    const prediction = await predictText("alt", alt);
    if (!prediction) break;
    mlUsed = true;
    options.onTrace?.(`alt-model("${alt.slice(0, 40)}") → ${prediction.label} ${(Math.max(...prediction.probabilities) * 100).toFixed(1)}%`);
    const already = combined.some((f) => f.el === img);
    const confidence = Math.max(...prediction.probabilities);
    if (!already && (prediction.label === "poor" || prediction.label === "missing_info") && confidence >= 0.6) {
      const meta = RULE_INDEX["img-alt-poor"];
      mlFindings.push({
        ruleId: "img-alt-poor",
        wcag: meta.wcag,
        level: meta.level,
        severityRule: meta.severity,
        message: `The alt-text model classified "${alt}" as ${prediction.label} (${(confidence * 100).toFixed(1)}% confidence).`,
        el: img,
        extra: { altText: alt },
      });
    }
  }

  const links = Array.from(doc.querySelectorAll("a[href]"));
  for (const link of links) {
    const text = accessibleName(link);
    if (!text) continue;
    const prediction = await predictText("link", text);
    if (!prediction) break;
    mlUsed = true;
    const confidence = Math.max(...prediction.probabilities);
    options.onTrace?.(`link-model("${text.slice(0, 40)}") → ${prediction.label} ${(confidence * 100).toFixed(1)}%`);
    if (prediction.label === "vague" && confidence >= 0.6) {
      const meta = RULE_INDEX["link-vague"];
      mlFindings.push({
        ruleId: "link-vague",
        wcag: meta.wcag,
        level: meta.level,
        severityRule: meta.severity,
        message: `The link-text model classified "${text}" as vague (${(confidence * 100).toFixed(1)}% confidence).`,
        el: link,
        extra: { linkText: text },
      });
    }
  }

  const everything = [...combined, ...mlFindings];
  mlFindings.forEach((f) => {
    ruleCounts[f.ruleId] = (ruleCounts[f.ruleId] ?? 0) + 1;
  });

  // 4b. severity prediction for every issue
  for (const finding of everything) {
    const element = finding.el;
    const row: SeverityRow = {
      ruleId: finding.ruleId,
      elementType: element?.tagName.toLowerCase() ?? "other",
      inNav: isInNav(element),
      interactive: isInteractive(element),
      position: positionOf(element, allElements),
      contrastGap:
        finding.extra?.ratio !== undefined && finding.extra?.required !== undefined
          ? Math.max(0, finding.extra.required - finding.extra.ratio)
          : 0,
      sameRuleCount: ruleCounts[finding.ruleId] ?? 1,
    };
    const prediction = await predictSeverity(row);
    const detail: MlDetail = { severityFeatures: row };
    let severityMl: Severity | null = null;
    let confidence: number | null = null;
    if (prediction) {
      mlUsed = true;
      severityMl = prediction.label as Severity;
      confidence = Math.max(...prediction.probabilities);
      detail.severityProbs = prediction.probabilities;
      options.onTrace?.(`severity-model(${finding.ruleId}) → ${prediction.label} ${(confidence * 100).toFixed(1)}%`);
    }
    if (finding.extra?.altText !== undefined) {
      const altPrediction = await predictText("alt", finding.extra.altText);
      if (altPrediction) {
        detail.altProbs = altPrediction.probabilities;
        detail.altLabel = altPrediction.label;
      }
    }
    if (finding.extra?.linkText !== undefined) {
      const linkPrediction = await predictText("link", finding.extra.linkText);
      if (linkPrediction) {
        detail.linkProbs = linkPrediction.probabilities;
        detail.linkLabel = linkPrediction.label;
      }
    }

    drafts.push({
      rule_id: finding.ruleId,
      wcag_criterion: finding.wcag,
      wcag_level: finding.level,
      selector: element ? cssPath(element) : "html",
      snippet: snippetOf(element),
      message: finding.message,
      severity_rule: finding.severityRule,
      severity_ml: severityMl,
      ml_confidence: confidence,
      ml_detail: detail,
      status: "open",
    });
  }

  rendered?.dispose();
  emit("ml", "ML inference", mlUsed ? `${drafts.length} issues scored by the models` : "Models not trained yet — rule severity used", 0.85);
  await nextFrame();

  // ---- 5. Score --------------------------------------------------------
  emit("scoring", "Scoring", "Applying the weighted severity formula", 0.9);
  const score = computeScore(drafts, elementCount);
  const durationMs = Math.round(performance.now() - started);
  emit("done", "Done", `Score ${score}/100 in ${durationMs} ms`, 1);

  return { issues: drafts, elementCount, durationMs, score, stages, mlUsed };
}
