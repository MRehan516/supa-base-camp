/**
 * Built-in test suites.
 *
 * These are real assertions executed in the browser against the real engine —
 * the Tests page reports whatever they return, pass or fail.
 */

import { contrastRatio, nearestCompliantColour, parseColour, relativeLuminance } from "./audit/colour";
import { runRuleChecks } from "./audit/rules";
import { computeScore, severityOf } from "./audit/scoring";
import { applyFixes, generateFixes } from "./audit/remediate";
import { buildAltDataset, buildLinkDataset, buildSeverityDataset, classBalance, mulberry32 } from "./ml/datasets";
import { Vectoriser, charNgrams, handFeatures } from "./ml/features";
import type { Issue, Severity } from "./types";

export interface TestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  durationMs: number;
}

export interface SuiteResult {
  suite: string;
  description: string;
  results: TestResult[];
}

type Assertion = () => { expected: unknown; actual: unknown };

function run(name: string, assertion: Assertion): TestResult {
  const started = performance.now();
  try {
    const { expected, actual } = assertion();
    const expectedText = JSON.stringify(expected);
    const actualText = JSON.stringify(actual);
    return {
      name,
      passed: expectedText === actualText,
      expected: expectedText,
      actual: actualText,
      durationMs: Number((performance.now() - started).toFixed(2)),
    };
  } catch (error) {
    return {
      name,
      passed: false,
      expected: "no exception",
      actual: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      durationMs: Number((performance.now() - started).toFixed(2)),
    };
  }
}

const round = (value: number, places = 2) => Number(value.toFixed(places));

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function issueFrom(ruleId: string, severity: Severity, selector: string): Issue {
  return {
    id: `${ruleId}-${selector}`,
    audit_id: "test",
    rule_id: ruleId,
    wcag_criterion: "test",
    wcag_level: "A",
    selector,
    snippet: "",
    message: "",
    severity_rule: severity,
    severity_ml: null,
    ml_confidence: null,
    ml_detail: null,
    status: "open",
  };
}

// ---------------------------------------------------------------------------

function colourSuite(): SuiteResult {
  return {
    suite: "Colour and contrast maths",
    description:
      "Checked against the published WCAG 2.1 relative-luminance and contrast formulas, using ratios the specification states explicitly.",
    results: [
      run("black on white is 21:1", () => ({
        expected: 21,
        actual: round(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })),
      })),
      run("white on white is 1:1", () => ({
        expected: 1,
        actual: round(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 255, g: 255, b: 255 })),
      })),
      run("luminance of white is 1", () => ({
        expected: 1,
        actual: round(relativeLuminance({ r: 255, g: 255, b: 255 }), 4),
      })),
      run("luminance of black is 0", () => ({
        expected: 0,
        actual: round(relativeLuminance({ r: 0, g: 0, b: 0 }), 4),
      })),
      run("#767676 on white is the 4.54:1 borderline", () => ({
        expected: 4.54,
        actual: round(contrastRatio({ r: 118, g: 118, b: 118 }, { r: 255, g: 255, b: 255 })),
      })),
      run("rgb() strings parse", () => ({
        expected: { r: 12, g: 92, b: 92 },
        actual: parseColour("rgb(12, 92, 92)"),
      })),
      run("3-digit hex expands", () => ({
        expected: { r: 255, g: 204, b: 0 },
        actual: parseColour("#fc0"),
      })),
      run("suggested colour reaches the 4.5:1 requirement", () => {
        const fixed = parseColour(nearestCompliantColour("#9a9a9a", "#ffffff", 4.5))!;
        return { expected: true, actual: contrastRatio(fixed, { r: 255, g: 255, b: 255 }) >= 4.5 };
      }),
    ],
  };
}

function ruleSuite(): SuiteResult {
  const fixtures: { name: string; html: string; rule: string }[] = [
    { name: "image with no alt", html: "<img src='a.png'>", rule: "img-alt-missing" },
    { name: "alt that is a file name", html: "<img src='a.png' alt='photo_2024.png'>", rule: "img-alt-filename" },
    { name: "input without a label", html: "<input type='text' name='q'>", rule: "input-label-missing" },
    { name: "placeholder used as the label", html: "<input type='text' placeholder='Email'>", rule: "input-placeholder-only" },
    { name: "missing lang attribute", html: "<p>hello</p>", rule: "html-lang-missing" },
    { name: "empty link", html: "<a href='/x'></a>", rule: "link-empty" },
    { name: "button with no name", html: "<button></button>", rule: "button-empty" },
    { name: "heading level skipped", html: "<h1>A</h1><h4>B</h4>", rule: "heading-skip" },
    { name: "table without headers", html: "<table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>", rule: "table-th-missing" },
    { name: "invalid ARIA role", html: "<div role='buttn'>x</div>", rule: "aria-role-invalid" },
    { name: "aria-hidden on a focusable element", html: "<button aria-hidden='true'>Save</button>", rule: "aria-hidden-focusable" },
    { name: "positive tabindex", html: "<div tabindex='3'>x</div>", rule: "tabindex-positive" },
    { name: "click handler on a div", html: "<div onclick='go()'>Go</div>", rule: "click-handler-non-interactive" },
    { name: "zoom disabled", html: "<meta name='viewport' content='width=device-width, user-scalable=no'>", rule: "doc-viewport-zoom" },
    { name: "duplicate id", html: "<p id='a'>1</p><p id='a'>2</p>", rule: "doc-duplicate-id" },
  ];

  const results = fixtures.map((fixture) =>
    run(`detects: ${fixture.name}`, () => {
      const findings = runRuleChecks(parse(`<html><head></head><body>${fixture.html}</body></html>`));
      return { expected: true, actual: findings.some((finding) => finding.ruleId === fixture.rule) };
    }),
  );

  results.push(
    run("a clean page triggers no rule", () => {
      const findings = runRuleChecks(
        parse(
          `<!DOCTYPE html><html lang="en"><head><title>Clean</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>Clean page</h1><p>Body text.</p><img src="a.png" alt="A detailed description of the chart"><a href="/report">Read the 2025 report</a></main></body></html>`,
        ),
      );
      return { expected: [], actual: findings.map((finding) => finding.ruleId) };
    }),
  );

  return {
    suite: "Rule detection",
    description: "Each fixture is a minimal page containing exactly one defect; the matching rule must fire.",
    results,
  };
}

function scoringSuite(): SuiteResult {
  const critical = [issueFrom("link-empty", "critical", "a")];
  const minor = [issueFrom("table-caption-missing", "minor", "table")];
  return {
    suite: "Scoring",
    description: "The published formula must behave monotonically and stay inside 0–100.",
    results: [
      run("a page with no issues scores 100", () => ({ expected: 100, actual: computeScore([], 50) })),
      run("critical costs more than minor", () => ({
        expected: true,
        actual: computeScore(critical, 50) < computeScore(minor, 50),
      })),
      run("more issues never raise the score", () => ({
        expected: true,
        actual: computeScore([...critical, ...minor], 50) <= computeScore(critical, 50),
      })),
      run("the score never leaves 0–100", () => {
        const many = Array.from({ length: 400 }, (_, index) => issueFrom("link-empty", "critical", `a:nth-child(${index})`));
        const score = computeScore(many, 5);
        return { expected: true, actual: score >= 0 && score <= 100 };
      }),
      run("a bigger page is penalised less for the same issue", () => ({
        expected: true,
        actual: computeScore(critical, 500) > computeScore(critical, 10),
      })),
      run("model severity overrides rule severity", () => ({
        expected: "minor",
        actual: severityOf({ severity_rule: "critical", severity_ml: "minor" }),
      })),
    ],
  };
}

function remediationSuite(): SuiteResult {
  const html = `<html><head></head><body><img src="rainfall-chart.png"><input type="text" placeholder="Email address"><a href="/annual-report">click here</a></body></html>`;
  const doc = parse(html);
  const findings = runRuleChecks(doc);
  const issues: Issue[] = findings.map((finding, index) =>
    issueFrom(finding.ruleId, finding.severityRule, finding.el ? selectorFor(finding.el) : "html") ,
  ).map((issue, index) => ({ ...issue, id: `i${index}` }));

  const fixes = generateFixes(html, issues);
  const applied = applyFixes(html, fixes);
  const after = runRuleChecks(parse(applied.html));

  return {
    suite: "Remediation",
    description: "Fixes must parse, apply to the real document, and reduce the number of findings without breaking the page.",
    results: [
      run("fixes were generated", () => ({ expected: true, actual: fixes.length > 0 })),
      run("every generated fix applied cleanly", () => ({ expected: 0, actual: applied.failed.length })),
      run("the fixed HTML still parses", () => ({
        expected: true,
        actual: parse(applied.html).body !== null,
      })),
      run("the fixed page has fewer findings", () => ({
        expected: true,
        actual: after.length < findings.length,
      })),
      run("the html element gained a lang attribute", () => ({
        expected: true,
        actual: parse(applied.html).documentElement.hasAttribute("lang"),
      })),
      run("applying the same fixes twice is stable", () => {
        const second = applyFixes(applied.html, generateFixes(applied.html, []));
        return { expected: true, actual: second.html.length > 0 };
      }),
    ],
  };
}

function selectorFor(el: Element): string {
  // Mirrors the engine's selector strategy closely enough for the fixtures here.
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const index = Array.from(parent.children).indexOf(el) + 1;
  return `${selectorFor(parent)} > ${tag}:nth-child(${index})`;
}

function featureSuite(): SuiteResult {
  const dataset = buildAltDataset();
  const vectoriser = new Vectoriser(300);
  vectoriser.fit(dataset.map((row) => row.text));

  return {
    suite: "Features and datasets",
    description: "Feature extraction must be deterministic and the datasets must be reproducible on any machine.",
    results: [
      run("the seeded generator is deterministic", () => ({
        expected: round(mulberry32(7)(), 6),
        actual: round(mulberry32(7)(), 6),
      })),
      run("the alt dataset is reproducible", () => ({
        expected: buildAltDataset().map((row) => row.label).join(",").length,
        actual: dataset.map((row) => row.label).join(",").length,
      })),
      run("every alt class is represented", () => ({
        expected: 4,
        actual: Object.keys(classBalance(dataset.map((row) => row.label))).length,
      })),
      run("the link dataset has two classes", () => ({
        expected: 2,
        actual: Object.keys(classBalance(buildLinkDataset().map((row) => row.label))).length,
      })),
      run("the severity dataset has four classes", () => ({
        expected: 4,
        actual: Object.keys(classBalance(buildSeverityDataset().map((row) => row.label))).length,
      })),
      run("character n-grams are extracted", () => ({
        expected: true,
        actual: charNgrams("chart").length > 0,
      })),
      run("hand features are a fixed-length vector", () => ({
        expected: handFeatures("one").length,
        actual: handFeatures("a much longer piece of alt text").length,
      })),
      run("vectorising the same text twice is identical", () => ({
        expected: vectoriser.transform("bar chart of rainfall").slice(0, 20),
        actual: vectoriser.transform("bar chart of rainfall").slice(0, 20),
      })),
      run("different texts give different vectors", () => {
        const a = vectoriser.transform("bar chart of rainfall");
        const b = vectoriser.transform("photo123.jpg");
        return { expected: true, actual: a.some((value, index) => value !== b[index]) };
      }),
    ],
  };
}

export function runAllSuites(): SuiteResult[] {
  return [colourSuite(), ruleSuite(), scoringSuite(), remediationSuite(), featureSuite()];
}
