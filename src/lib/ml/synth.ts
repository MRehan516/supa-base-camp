/**
 * Synthetic page generator for Model 4 (issue type) and Model 5 (fix success).
 *
 * HONESTY NOTE: the pages are generated from documented templates with a
 * seeded PRNG — they are synthetic, not real-world websites. The LABELS,
 * however, are not hand-assigned:
 *
 *  - Issue-type labels are the category of the deterministic rule that fired
 *    when the real rule engine ran on the generated page.
 *  - Fix-success labels come from actually applying the generated fix (with a
 *    controlled suggestion variant) and re-running the real rule engine: the
 *    label is "resolved" only when the same rule no longer fires on the same
 *    element.
 *
 * Runs in the browser only (needs DOMParser).
 */

import type { Issue, Severity } from "../types";
import { RULE_INDEX, cssPath, runRuleChecks, snippetOf } from "../audit/rules";
import { applyFixes, generateFixes } from "../audit/remediate";
import { mulberry32 } from "./datasets";
import { handFeatures } from "./features";

type Rnd = () => number;
const pick = <T,>(rnd: Rnd, list: T[]): T => list[Math.floor(rnd() * list.length)];
const num = (rnd: Rnd, lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const NOUNS = ["library", "campus", "results", "timetable", "canteen", "hostel", "lab", "placement", "event", "seminar", "sports", "admissions"];
const WORDS = ["Notice", "Update", "Report", "Gallery", "Schedule", "Overview", "Contact", "Archive"];
const CAPTIONS = [
  "Students testing the new braille signage",
  "The renovated reading room on the second floor",
  "Volunteers at the annual blood donation camp",
  "Final-year robotics team with their rover",
  "Rainwater harvesting tank behind the hostel",
];

/** One fragment generator per defect family. Each returns HTML for <body>. */
const FRAGMENTS: ((rnd: Rnd, i: number) => string)[] = [
  // images
  (rnd) => `<img src="/img/${pick(rnd, NOUNS)}-${num(rnd, 1, 99)}.jpg">`,
  (rnd) => `<figure><img src="/img/${pick(rnd, NOUNS)}.png"><figcaption>${pick(rnd, CAPTIONS)}</figcaption></figure>`,
  (rnd) => `<img src="/img/photo.jpg" alt="${pick(rnd, ["image", "photo", "picture", "icon", "graphic"])}">`,
  (rnd) => { const n = num(rnd, 1000, 9999); return `<img src="/u/IMG_${n}.jpg" alt="IMG_${n}">`; },
  (rnd) => `<img src="/img/${pick(rnd, NOUNS)}-hero.jpg" alt="">`,
  // forms
  (rnd, i) => `<form><input type="text" id="f${i}" name="${pick(rnd, NOUNS)}"></form>`,
  (rnd, i) => `<form><input type="email" id="e${i}" placeholder="Your ${pick(rnd, ["email", "college email", "work email"])}"></form>`,
  (rnd, i) => `<form><select id="s${i}"><option>${pick(rnd, NOUNS)}</option></select></form>`,
  // links / buttons
  (rnd) => `<a href="/${pick(rnd, NOUNS)}"><img src="/i/arrow.svg" alt=""></a>`,
  (rnd) => `<a href="/${pick(rnd, NOUNS)}/${num(rnd, 1, 40)}"></a>`,
  (rnd) => `<button type="button"><svg width="12" height="12"></svg></button>`,
  (rnd) => `<button class="${pick(rnd, NOUNS)}-btn"></button>`,
  // structure
  (rnd) => `<h2>${pick(rnd, WORDS)}</h2><h4>${pick(rnd, NOUNS)} details</h4>`,
  (rnd) => `<h3>${pick(rnd, WORDS)} ${pick(rnd, NOUNS)}</h3><h5>More</h5>`,
  // tables
  (rnd) => `<table><tr><td>${pick(rnd, NOUNS)}</td><td>${num(rnd, 1, 99)}</td></tr><tr><td>${pick(rnd, NOUNS)}</td><td>${num(rnd, 1, 99)}</td></tr></table>`,
  // aria
  (rnd) => `<div role="${pick(rnd, ["buton", "nav-bar", "clickable", "card", "dropdown"])}">${pick(rnd, WORDS)}</div>`,
  (rnd) => `<span role="checkbox" tabindex="0">${pick(rnd, NOUNS)}</span>`,
  (rnd) => `<div aria-hidden="true"><a href="/${pick(rnd, NOUNS)}">${pick(rnd, WORDS)}</a></div>`,
  // keyboard
  (rnd) => `<div onclick="go()">${pick(rnd, WORDS)}</div>`,
  (rnd) => `<a href="/${pick(rnd, NOUNS)}" tabindex="${num(rnd, 1, 5)}">${pick(rnd, WORDS)}</a>`,
  (rnd) => `<span role="button">${pick(rnd, WORDS)}</span>`,
  // clean content (no defect) so the pages are not all-defect
  (rnd) => `<p>${pick(rnd, CAPTIONS)}.</p>`,
  (rnd) => `<img src="/img/${pick(rnd, NOUNS)}.jpg" alt="${pick(rnd, CAPTIONS)}">`,
  (rnd) => `<a href="/${pick(rnd, NOUNS)}">Read the ${pick(rnd, NOUNS)} ${pick(rnd, WORDS).toLowerCase()}</a>`,
];

export function synthPage(seed: number): string {
  const rnd = mulberry32(seed);
  const parts: string[] = [];
  const count = num(rnd, 3, 7);
  for (let i = 0; i < count; i++) parts.push(pick(rnd, FRAGMENTS)(rnd, seed * 10 + i));
  const lang = rnd() < 0.7 ? ' lang="en"' : "";
  const title = rnd() < 0.75 ? `<title>${pick(rnd, WORDS)} — ${pick(rnd, NOUNS)}</title>` : "";
  const main = rnd() < 0.6;
  const h1 = rnd() < 0.7 ? `<h1>${pick(rnd, WORDS)}</h1>` : "";
  const body = `${h1}${parts.join("\n")}`;
  return `<!DOCTYPE html><html${lang}><head><meta charset="utf-8">${title}</head><body>${main ? `<main>${body}</main>` : body}</body></html>`;
}

export interface SynthIssue {
  page: number;
  issue: Issue;
  tag: string;
}

/** Run the real rule engine over a synthetic page and wrap findings as issues. */
export function synthIssues(page: number, html: string): SynthIssue[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return runRuleChecks(doc).map((finding, i) => ({
    page,
    tag: finding.el?.tagName.toLowerCase() ?? "html",
    issue: {
      id: `p${page}-i${i}`,
      audit_id: `synthetic-${page}`,
      rule_id: finding.ruleId,
      wcag_criterion: finding.wcag,
      wcag_level: finding.level,
      selector: finding.el ? cssPath(finding.el) : "html",
      snippet: snippetOf(finding.el),
      message: finding.message,
      severity_rule: finding.severityRule as Severity,
      severity_ml: null,
      ml_confidence: null,
      ml_detail: null,
      status: "open",
    },
  }));
}

export const DOCUMENT_TAGS = new Set(["html", "head", "body", "style", "meta"]);

// ---------------------------------------------------------------------------
// Model 4 — issue type from the element snippet
// ---------------------------------------------------------------------------

export const ISSUE_TYPE_CLASSES = ["images", "forms", "structure", "links", "tables", "aria", "keyboard"] as const;

export interface IssueTypeExample {
  text: string;
  label: string;
  group: string;
}

export function buildIssueTypeDataset(pages = 420): IssueTypeExample[] {
  const rows: IssueTypeExample[] = [];
  for (let p = 0; p < pages; p++) {
    synthIssues(p, synthPage(5000 + p)).forEach(({ issue, tag }) => {
      if (DOCUMENT_TAGS.has(tag)) return;
      const category = RULE_INDEX[issue.rule_id]?.category ?? "";
      if (!(ISSUE_TYPE_CLASSES as readonly string[]).includes(category)) return;
      rows.push({ text: issue.snippet, label: category, group: `page-${p}` });
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Model 5 — fix success
// ---------------------------------------------------------------------------

export const FIX_SUCCESS_CLASSES = ["resolved", "not_resolved"] as const;

/** Rules the fix-success model has training data for (DOM-only, re-auditable without rendering). */
export const FIX_MODEL_RULES = [
  "img-alt-missing", "img-alt-empty-meaningful", "img-alt-filename", "img-alt-poor",
  "input-label-missing", "input-placeholder-only", "link-empty", "button-empty",
  "html-lang-missing", "doc-title-missing", "landmark-main-missing", "heading-skip",
  "table-caption-missing", "table-th-missing", "tabindex-positive", "click-handler-non-interactive",
  "aria-role-invalid", "aria-required-attr", "aria-hidden-focusable", "interactive-role-not-focusable",
  "heading-missing-h1",
];
export const FIX_METHODS = ["replace-element", "set-html-lang", "insert-title", "insert-viewport", "insert-main"];

export interface FixSuccessInput {
  ruleId: string;
  method: string;
  suggestion: string;
  defaultSuggestion: string;
  heuristicConfidence: number;
  needsReview: boolean;
}

export const FIX_FEATURE_GROUPS = ["rule_id", "method", "suggestion_text", "edited", "heuristic_confidence", "needs_review"] as const;

export function fixSuccessFeatures(input: FixSuccessInput): number[] {
  const rule = FIX_MODEL_RULES.map((id) => (id === input.ruleId ? 1 : 0));
  const method = FIX_METHODS.map((m) => (m === input.method ? 1 : 0));
  const text = handFeatures(input.suggestion).values;
  return [
    ...rule,
    ...method,
    ...text,
    input.suggestion.trim() === input.defaultSuggestion.trim() ? 0 : 1,
    Math.max(0, Math.min(1, input.heuristicConfidence)),
    input.needsReview ? 1 : 0,
  ];
}

export function fixFeatureGroupIndices(): Record<string, number[]> {
  const r = FIX_MODEL_RULES.length;
  const m = FIX_METHODS.length;
  const t = handFeatures("x").values.length;
  const base = r + m + t;
  return {
    rule_id: Array.from({ length: r }, (_, i) => i),
    method: Array.from({ length: m }, (_, i) => r + i),
    suggestion_text: Array.from({ length: t }, (_, i) => r + m + i),
    edited: [base],
    heuristic_confidence: [base + 1],
    needs_review: [base + 2],
  };
}

export interface FixSuccessExample {
  input: FixSuccessInput;
  label: string;
  group: string;
}

/** Suggestion variants that simulate what a developer might type. */
function variants(rnd: Rnd, suggestion: string): string[] {
  const out = [suggestion];
  out.push("");
  out.push(pick(rnd, ["image", "photo", "click here", "icon", "x"]));
  out.push(pick(rnd, [`IMG_${num(rnd, 1000, 9999)}`, "h9", "notarole", "   "]));
  out.push(pick(rnd, CAPTIONS));
  return out;
}

/** Real check: does the same rule still fire on the same element after the fix? */
export function stillFires(html: string, ruleId: string, selector: string): boolean {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return runRuleChecks(doc).some(
    (finding) => finding.ruleId === ruleId && (finding.el ? cssPath(finding.el) : "html") === selector,
  );
}

export function buildFixSuccessDataset(pages = 160): FixSuccessExample[] {
  const rows: FixSuccessExample[] = [];
  const rnd = mulberry32(777);
  for (let p = 0; p < pages; p++) {
    const html = synthPage(9000 + p);
    const issues = synthIssues(p, html).map((s) => s.issue).filter((i) => FIX_MODEL_RULES.includes(i.rule_id));
    const fixes = generateFixes(html, issues);
    fixes.forEach((fix) => {
      const issue = issues.find((i) => i.id === fix.issueId)!;
      variants(rnd, fix.suggestion).forEach((value) => {
        const result = applyFixes(html, [fix], { [fix.issueId]: value });
        const resolved = result.applied.length === 1 && !stillFires(result.html, issue.rule_id, issue.selector);
        rows.push({
          input: {
            ruleId: issue.rule_id,
            method: fix.method,
            suggestion: value,
            defaultSuggestion: fix.suggestion,
            heuristicConfidence: fix.confidence,
            needsReview: fix.needsReview,
          },
          label: resolved ? "resolved" : "not_resolved",
          group: `page-${p}`,
        });
      });
    });
  }
  return rows;
}
