/**
 * Bundled training data.
 *
 * HONESTY NOTE (shown in the UI as well): these datasets are generated from
 * documented templates plus hand-written curated examples. They are a
 * synthetic + curated corpus, not scraped production data. The label logic is
 * written out below and mirrored on the /datasets page so it can be audited.
 */

import type { SeverityRow } from "../types";
import { RULE_IDS } from "../audit/rules";

/** Deterministic PRNG so every run trains on exactly the same split. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TextExample {
  text: string;
  label: string;
  origin: "template" | "curated" | "user";
}

export const ALT_CLASSES = ["missing_info", "poor", "good", "decorative_ok"] as const;
export type AltClass = (typeof ALT_CLASSES)[number];

export const LINK_CLASSES = ["vague", "descriptive"] as const;
export type LinkClass = (typeof LINK_CLASSES)[number];

export const ALT_LABEL_RULES = [
  "missing_info — the string carries no human meaning: empty, a file name, a bare id or number, 'untitled'.",
  "poor — a real word but no information: generic nouns ('image', 'graph'), or a 1-3 word vague phrase.",
  "good — names the subject and the point of the image, usually 5+ words with concrete nouns or numbers.",
  "decorative_ok — describes an ornamental asset that legitimately carries no content (spacer, divider, texture).",
];

export const LINK_LABEL_RULES = [
  "vague — the text works only next to its surroundings: 'click here', 'read more', 'this link', 'here', bare URLs.",
  "descriptive — the text names the destination or the action: 'Download the 2024 annual report (PDF)'.",
];

export const SEVERITY_LABEL_RULES = [
  "Base impact per rule follows the WCAG failure impact table (blocker = 3.0, serious = 2.0, moderate = 1.2, minor = 0.5).",
  "+0.6 when the element is interactive, +0.4 when it sits inside navigation, +0.3 when it is in the first 20% of the page.",
  "+ up to 0.9 proportional to how far a contrast ratio falls below the required ratio.",
  "+0.15 per additional occurrence of the same rule on the page, capped at +0.6.",
  "Gaussian noise (σ = 0.35) is added before thresholding at 3.0 / 2.0 / 1.0, so the model must learn the pattern rather than copy a lookup table.",
];

// ---------------------------------------------------------------------------
// Model 1 — alt-text quality
// ---------------------------------------------------------------------------

const SUBJECTS = [
  "a red tractor", "two engineers", "a lecture hall", "the campus library", "a wind turbine",
  "a circuit board", "a nurse", "a street market", "a bridge under construction", "a lab bench",
  "a coffee roaster", "a child reading", "a rescue dog", "a rice field", "a solar farm",
];
const ACTIONS = [
  "ploughing a field", "reviewing a blueprint", "listening to a seminar", "shelving returned books",
  "turning above a hillside", "being soldered by hand", "checking a patient's chart",
  "selling mangoes at dawn", "being lifted into place by a crane", "running a titration",
  "weighing green beans", "holding a picture book", "waiting at a shelter gate",
  "being harvested by hand", "tracking the afternoon sun",
];
const CHART_TEMPLATES = [
  "Bar chart showing {a} rising from {x} to {y} percent between 2019 and 2024",
  "Line graph of {a} falling from {x} to {y} over twelve months",
  "Pie chart where {a} makes up {x} percent of the total",
  "Scatter plot comparing {a} against rainfall across {x} districts",
  "Table screenshot listing {a} for {x} regions with a {y} percent average",
];
const CHART_SUBJECTS = ["monthly sales", "enrolment", "power output", "defect rate", "rainfall", "page load time"];

const GENERIC_WORDS = [
  "image", "photo", "picture", "graphic", "img", "pic", "graph", "chart", "icon", "logo",
  "screenshot", "figure", "thumbnail", "banner", "media", "photograph", "illustration",
];
const VAGUE_PHRASES = [
  "an image", "some photo", "a picture here", "product photo", "team photo", "nice view",
  "our office", "click image", "photo of it", "image of image", "picture 1", "photo again",
  "cool graphic", "the chart", "a graph", "screenshot of page", "the logo", "main banner",
];
const FILE_LIKE = [
  "IMG_{n}.jpg", "photo{n}.png", "DSC0{n}.JPEG", "screenshot-{n}.png", "asset_{n}.svg",
  "upload_{n}.webp", "{n}", "image-{n}", "untitled-{n}", "file{n}.gif",
];
const DECORATIVE = [
  "decorative divider", "spacer pixel", "background texture", "ornamental flourish",
  "blank separator", "decorative corner swirl", "thin rule line", "gradient backdrop",
  "decorative dot pattern", "empty placeholder shape",
];

const CURATED_ALT: TextExample[] = [
  { text: "", label: "missing_info", origin: "curated" },
  { text: "photo123.jpg", label: "missing_info", origin: "curated" },
  { text: "untitled", label: "missing_info", origin: "curated" },
  { text: "image", label: "poor", origin: "curated" },
  { text: "graph", label: "poor", origin: "curated" },
  { text: "Bar chart showing 2023 sales rising from 40 to 70 percent", label: "good", origin: "curated" },
  { text: "Portrait of Dr Amina Rao, head of the accessibility lab", label: "good", origin: "curated" },
  { text: "Screenshot of the checkout page with the error message highlighted in red", label: "good", origin: "curated" },
  { text: "decorative divider", label: "decorative_ok", origin: "curated" },
  { text: "spacer pixel", label: "decorative_ok", origin: "curated" },
];

/** Build the alt-text dataset (~1,550 rows, four classes). */
export function buildAltDataset(): TextExample[] {
  const rnd = mulberry32(20260401);
  const rows: TextExample[] = [...CURATED_ALT];
  const pick = <T,>(list: T[]): T => list[Math.floor(rnd() * list.length)];

  // good — descriptive sentences (subject + action, or a data-chart description)
  for (let i = 0; i < 380; i++) {
    rows.push({
      text: `${pick(SUBJECTS)} ${pick(ACTIONS)}`.replace(/^a /, "A "),
      label: "good",
      origin: "template",
    });
  }
  for (let i = 0; i < 140; i++) {
    const template = pick(CHART_TEMPLATES);
    rows.push({
      text: template
        .replace("{a}", pick(CHART_SUBJECTS))
        .replace("{x}", String(10 + Math.floor(rnd() * 80)))
        .replace("{y}", String(10 + Math.floor(rnd() * 80))),
      label: "good",
      origin: "template",
    });
  }

  // poor — generic nouns and short vague phrases
  for (let i = 0; i < 220; i++) {
    const word = pick(GENERIC_WORDS);
    rows.push({ text: rnd() > 0.5 ? word : `${word} ${Math.floor(rnd() * 9) + 1}`, label: "poor", origin: "template" });
  }
  for (let i = 0; i < 230; i++) {
    rows.push({ text: pick(VAGUE_PHRASES), label: "poor", origin: "template" });
  }

  // missing_info — file names, ids, empty strings
  for (let i = 0; i < 300; i++) {
    rows.push({
      text: pick(FILE_LIKE).replace("{n}", String(1000 + Math.floor(rnd() * 8999))),
      label: "missing_info",
      origin: "template",
    });
  }
  for (let i = 0; i < 50; i++) {
    rows.push({ text: rnd() > 0.5 ? "" : " ", label: "missing_info", origin: "template" });
  }

  // decorative_ok
  for (let i = 0; i < 240; i++) {
    const base = pick(DECORATIVE);
    rows.push({ text: rnd() > 0.7 ? `${base} ${Math.floor(rnd() * 5) + 1}` : base, label: "decorative_ok", origin: "template" });
  }

  return shuffle(rows, mulberry32(7));
}

// ---------------------------------------------------------------------------
// Model 2 — link-text clarity
// ---------------------------------------------------------------------------

const VAGUE_LINKS = [
  "click here", "here", "read more", "more", "learn more", "this link", "link", "click",
  "continue", "see more", "details", "info", "download", "go", "next", "more info",
  "click this", "read this", "find out more", "tap here", "open", "view", "see here",
  "https://example.com/page?id=48211", "www.example.com/a/b/c", "...", ">>",
];
const LINK_NOUNS = [
  "the 2024 annual report", "our refund policy", "the accessibility statement",
  "the enrolment form", "the campus map", "the exam timetable", "the library catalogue",
  "the hostel application", "the fee structure", "last year's results",
  "the placement brochure", "the syllabus for semester five", "the lab safety guide",
];
const LINK_VERBS = ["Download", "Read", "Open", "Review", "Print", "Browse", "Compare", "Submit"];
const LINK_SUFFIX = ["(PDF, 2 MB)", "", "for 2025", "in a new tab", "as a spreadsheet"];

const CURATED_LINKS: TextExample[] = [
  { text: "click here", label: "vague", origin: "curated" },
  { text: "read more", label: "vague", origin: "curated" },
  { text: "Download the 2024 annual report (PDF, 2 MB)", label: "descriptive", origin: "curated" },
  { text: "Open the exam timetable for 2025", label: "descriptive", origin: "curated" },
  { text: "Contact the accessibility office", label: "descriptive", origin: "curated" },
];

/** Build the link-text dataset (~880 rows, binary). */
export function buildLinkDataset(): TextExample[] {
  const rnd = mulberry32(19990707);
  const rows: TextExample[] = [...CURATED_LINKS];
  const pick = <T,>(list: T[]): T => list[Math.floor(rnd() * list.length)];

  for (let i = 0; i < 420; i++) {
    const base = pick(VAGUE_LINKS);
    rows.push({ text: rnd() > 0.85 ? base.toUpperCase() : base, label: "vague", origin: "template" });
  }
  for (let i = 0; i < 455; i++) {
    const suffix = pick(LINK_SUFFIX);
    rows.push({
      text: `${pick(LINK_VERBS)} ${pick(LINK_NOUNS)}${suffix ? ` ${suffix}` : ""}`,
      label: "descriptive",
      origin: "template",
    });
  }
  return shuffle(rows, mulberry32(11));
}

// ---------------------------------------------------------------------------
// Model 3 — issue severity
// ---------------------------------------------------------------------------

const BASE_IMPACT: Record<string, number> = {
  "img-alt-missing": 3.0,
  "img-alt-empty-meaningful": 2.0,
  "img-alt-filename": 2.0,
  "img-alt-long": 0.5,
  "img-alt-poor": 1.2,
  "input-label-missing": 3.0,
  "input-placeholder-only": 2.0,
  "heading-missing-h1": 1.2,
  "heading-multiple-h1": 0.5,
  "heading-skip": 1.2,
  "heading-empty": 1.2,
  "html-lang-missing": 2.0,
  "link-empty": 3.0,
  "button-empty": 3.0,
  "link-vague": 1.2,
  "contrast-insufficient": 2.0,
  "landmark-main-missing": 1.2,
  "landmark-duplicate-unlabelled": 0.5,
  "table-th-missing": 2.0,
  "table-caption-missing": 0.5,
  "aria-role-invalid": 2.0,
  "aria-hidden-focusable": 3.0,
  "aria-required-attr": 2.0,
  "tabindex-positive": 1.2,
  "click-handler-non-interactive": 3.0,
  "mouse-only-handler": 2.0,
  "interactive-role-not-focusable": 2.0,
  "focus-outline-removed": 2.0,
  "media-captions-missing": 2.0,
  "doc-title-missing": 2.0,
  "doc-duplicate-id": 1.2,
  "doc-viewport-zoom": 2.0,
};

export const ELEMENT_TYPES = [
  "img", "input", "select", "textarea", "a", "button", "div", "span", "table", "video", "audio",
  "h1", "h2", "h3", "p", "nav", "html", "head", "body", "other",
];

function gaussian(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-9);
  const v = Math.max(rnd(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Documented WCAG-impact scoring used to label the severity training rows. */
export function severityImpactScore(row: SeverityRow, noise = 0): number {
  let score = BASE_IMPACT[row.ruleId] ?? 1.2;
  if (row.interactive) score += 0.6;
  if (row.inNav) score += 0.4;
  if (row.position < 0.2) score += 0.3;
  if (row.contrastGap > 0) score += Math.min(0.9, row.contrastGap * 0.35);
  score += Math.min(0.6, Math.max(0, row.sameRuleCount - 1) * 0.15);
  return score + noise;
}

export function labelFromImpact(score: number): "critical" | "serious" | "moderate" | "minor" {
  if (score >= 3.0) return "critical";
  if (score >= 2.0) return "serious";
  if (score >= 1.0) return "moderate";
  return "minor";
}

export interface SeverityExample {
  row: SeverityRow;
  label: string;
}

/** Build the severity dataset (1,200 rows with label noise). */
export function buildSeverityDataset(count = 1200): SeverityExample[] {
  const rnd = mulberry32(20240915);
  const rows: SeverityExample[] = [];
  for (let i = 0; i < count; i++) {
    const ruleId = RULE_IDS[Math.floor(rnd() * RULE_IDS.length)];
    const contrast = ruleId === "contrast-insufficient" ? rnd() * 3.5 : 0;
    const row: SeverityRow = {
      ruleId,
      elementType: ELEMENT_TYPES[Math.floor(rnd() * (ELEMENT_TYPES.length - 1))],
      inNav: rnd() < 0.3,
      interactive: rnd() < 0.4,
      position: rnd(),
      contrastGap: contrast,
      sameRuleCount: 1 + Math.floor(rnd() * 8),
    };
    const score = severityImpactScore(row, gaussian(rnd) * 0.35);
    rows.push({ row, label: labelFromImpact(score) });
  }
  return rows;
}

export function shuffle<T>(items: T[], rnd: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function classBalance(labels: string[]): Record<string, number> {
  return labels.reduce<Record<string, number>>((acc, label) => {
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});
}
