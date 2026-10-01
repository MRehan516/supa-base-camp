/**
 * Deterministic WCAG 2.1 rule checks.
 *
 * Every check reads the parsed DOM and returns findings that point at a live
 * element. No result here involves machine learning — the ML layer only adds
 * judgement on top (alt-text quality, link clarity, severity ranking).
 */

import type { Finding, Severity, WcagLevel } from "../types";
import { contrastRatio, flatten, parseColour, type Rgb } from "./colour";

export type WcagPrinciple = "Perceivable" | "Operable" | "Understandable" | "Robust";

export type IssueCategory =
  | "images"
  | "forms"
  | "structure"
  | "language"
  | "links"
  | "contrast"
  | "aria"
  | "keyboard"
  | "media"
  | "tables"
  | "document";

export const CATEGORY_LABEL: Record<IssueCategory, string> = {
  images: "Images & alt text",
  forms: "Forms & labels",
  structure: "Headings & landmarks",
  language: "Language",
  links: "Links & buttons",
  contrast: "Colour contrast",
  aria: "ARIA usage",
  keyboard: "Keyboard access",
  media: "Time-based media",
  tables: "Data tables",
  document: "Document metadata",
};

/** Short code prefix used to build issue IDs such as IMG-003. */
export const CATEGORY_CODE: Record<IssueCategory, string> = {
  images: "IMG", forms: "FRM", structure: "STR", language: "LNG", links: "LNK", contrast: "CON",
  aria: "ARI", keyboard: "KBD", media: "MED", tables: "TBL", document: "DOC",
};

export interface RuleMeta {
  id: string;
  wcag: string;
  level: WcagLevel;
  title: string;
  /** Why the problem matters to users. */
  why: string;
  /** The exact condition that makes the rule trigger. */
  trigger: string;
  severity: Severity;
  fixable: boolean;
  category: IssueCategory;
  /** True when the rule is a heuristic or the fix needs a person's judgement. */
  humanReview: boolean;
  /** "rule" = deterministic DOM check; "model" = advisory finding raised only by an ML model. */
  source: "rule" | "model";
}

/** WCAG principle derived from the first digit of the success criterion. */
export function principleOf(wcag: string): WcagPrinciple {
  const first = wcag.trim().charAt(0);
  if (first === "1") return "Perceivable";
  if (first === "2") return "Operable";
  if (first === "3") return "Understandable";
  return "Robust";
}

type RuleRow = Omit<RuleMeta, "source"> & { source?: RuleMeta["source"] };

const RULE_ROWS: RuleRow[] = [
  { id: "img-alt-missing", wcag: "1.1.1 Non-text Content", level: "A", category: "images", title: "Image without alt attribute", why: "Screen readers announce the file name or nothing at all.", trigger: "An <img> element has no alt attribute.", severity: "critical", fixable: true, humanReview: true },
  { id: "img-alt-empty-meaningful", wcag: "1.1.1 Non-text Content", level: "A", category: "images", title: "Empty alt on a possibly meaningful image", why: "An empty alt hides the image from assistive technology.", trigger: "alt=\"\" on an image that is not marked decorative (no role=presentation, no aria-hidden, no decorative file name).", severity: "serious", fixable: true, humanReview: true },
  { id: "img-alt-filename", wcag: "1.1.1 Non-text Content", level: "A", category: "images", title: "Alt text is a file name or camera id", why: "File names and ids such as IMG_2938 carry no meaning for the reader.", trigger: "The alt equals the file name, ends in an image extension, or matches a camera-id pattern (IMG_1234, DSC0042).", severity: "serious", fixable: true, humanReview: true },
  { id: "img-alt-long", wcag: "1.1.1 Non-text Content", level: "A", category: "images", title: "Alt text is excessively long", why: "Over ~150 characters belongs in a caption or long description.", trigger: "The alt attribute is longer than 150 characters.", severity: "minor", fixable: true, humanReview: true },
  { id: "img-alt-poor", wcag: "1.1.1 Non-text Content", level: "A", category: "images", title: "Potentially uninformative alt text", why: "Generic words such as 'image' or 'photo' describe nothing.", trigger: "The alt is a single generic word from a fixed list (image, photo, icon…), or the alt-text model flagged it (advisory).", severity: "moderate", fixable: true, humanReview: true },
  { id: "input-label-missing", wcag: "3.3.2 Labels or Instructions", level: "A", category: "forms", title: "Form control without a label", why: "The user cannot tell what to type into the field.", trigger: "An input, select or textarea has no <label>, aria-label or aria-labelledby.", severity: "critical", fixable: true, humanReview: true },
  { id: "input-placeholder-only", wcag: "3.3.2 Labels or Instructions", level: "A", category: "forms", title: "Placeholder used as the only label", why: "Placeholder text disappears on input and is often unreadable.", trigger: "The control has a placeholder but no label, aria-label or aria-labelledby.", severity: "serious", fixable: true, humanReview: false },
  { id: "heading-missing-h1", wcag: "1.3.1 Info and Relationships", level: "A", category: "structure", title: "Page has no h1", why: "Users who navigate by headings lose the page's main topic.", trigger: "The page contains headings but none is an h1.", severity: "moderate", fixable: true, humanReview: false },
  { id: "heading-multiple-h1", wcag: "1.3.1 Info and Relationships", level: "A", category: "structure", title: "More than one h1", why: "Multiple top-level headings make the outline ambiguous.", trigger: "More than one h1 element exists; every h1 after the first is reported.", severity: "minor", fixable: false, humanReview: true },
  { id: "heading-skip", wcag: "1.3.1 Info and Relationships", level: "A", category: "structure", title: "Heading level skipped", why: "Jumping h2 to h4 breaks the document outline.", trigger: "A heading is more than one level deeper than the heading before it.", severity: "moderate", fixable: true, humanReview: false },
  { id: "heading-empty", wcag: "1.3.1 Info and Relationships", level: "A", category: "structure", title: "Empty heading", why: "An empty heading is announced with no content.", trigger: "A heading element has no text and no image with alt text.", severity: "moderate", fixable: false, humanReview: true },
  { id: "html-lang-missing", wcag: "3.1.1 Language of Page", level: "A", category: "language", title: "Missing lang on <html>", why: "Screen readers pick the wrong pronunciation rules.", trigger: "The <html> element has no non-empty lang attribute.", severity: "serious", fixable: true, humanReview: false },
  { id: "link-empty", wcag: "2.4.4 Link Purpose (In Context)", level: "A", category: "links", title: "Link with no accessible name", why: "The link is announced only as 'link'.", trigger: "An <a href> has no text, aria-label, aria-labelledby, image alt or title.", severity: "critical", fixable: true, humanReview: true },
  { id: "button-empty", wcag: "4.1.2 Name, Role, Value", level: "A", category: "links", title: "Button with no accessible name", why: "The control cannot be identified or voice-operated.", trigger: "A button (or role=button) has no text, aria-label, aria-labelledby, value or title.", severity: "critical", fixable: true, humanReview: true },
  { id: "link-vague", wcag: "2.4.4 Link Purpose (In Context)", level: "A", category: "links", title: "Potentially vague link text (model, advisory)", why: "'Click here' out of context tells the user nothing.", trigger: "Raised only by the link-text model when it predicts 'vague' with ≥ 60% probability. Advisory — not a deterministic WCAG failure.", severity: "moderate", fixable: true, humanReview: true, source: "model" },
  { id: "contrast-insufficient", wcag: "1.4.3 Contrast (Minimum)", level: "AA", category: "contrast", title: "Text contrast below the WCAG minimum", why: "Low-vision users cannot read the text.", trigger: "Rendered text colour vs. its flattened background is below 4.5:1 (normal) or 3:1 (large text).", severity: "serious", fixable: true, humanReview: false },
  { id: "landmark-main-missing", wcag: "1.3.1 Info and Relationships", level: "A", category: "structure", title: "No main landmark", why: "Users cannot skip straight to the primary content.", trigger: "No <main> element and no role=main.", severity: "moderate", fixable: true, humanReview: false },
  { id: "landmark-duplicate-unlabelled", wcag: "1.3.1 Info and Relationships", level: "A", category: "structure", title: "Duplicate landmark without a label", why: "Two navigations sound identical in the landmark list.", trigger: "Two or more nav/aside/form/section elements exist and this one has no accessible name.", severity: "minor", fixable: true, humanReview: true },
  { id: "table-th-missing", wcag: "1.3.1 Info and Relationships", level: "A", category: "tables", title: "Data table without header cells", why: "Cell values are read without their column meaning.", trigger: "A table not marked role=presentation contains no <th>.", severity: "serious", fixable: true, humanReview: true },
  { id: "table-caption-missing", wcag: "1.3.1 Info and Relationships", level: "A", category: "tables", title: "Table without a caption", why: "The table's purpose is not announced.", trigger: "A data table has no <caption>.", severity: "minor", fixable: true, humanReview: true },
  { id: "aria-role-invalid", wcag: "4.1.2 Name, Role, Value", level: "A", category: "aria", title: "Invalid ARIA role", why: "An unknown role is ignored, losing the intended semantics.", trigger: "A role value is not in the WAI-ARIA 1.2 role list.", severity: "serious", fixable: true, humanReview: true },
  { id: "aria-hidden-focusable", wcag: "4.1.2 Name, Role, Value", level: "A", category: "aria", title: "aria-hidden on a focusable element", why: "Keyboard users land on an element the screen reader ignores.", trigger: "aria-hidden=\"true\" is set on, or wraps, an enabled focusable element.", severity: "critical", fixable: true, humanReview: false },
  { id: "aria-required-attr", wcag: "4.1.2 Name, Role, Value", level: "A", category: "aria", title: "Missing required ARIA attribute", why: "Widget roles need their state attributes to be usable.", trigger: "A widget role (checkbox, slider, combobox…) lacks a required state attribute.", severity: "serious", fixable: true, humanReview: true },
  { id: "tabindex-positive", wcag: "2.4.3 Focus Order", level: "A", category: "keyboard", title: "Positive tabindex", why: "It forces an unnatural, unpredictable focus order.", trigger: "tabindex is greater than 0.", severity: "moderate", fixable: true, humanReview: false },
  { id: "click-handler-non-interactive", wcag: "2.1.1 Keyboard", level: "A", category: "keyboard", title: "Click handler on a non-interactive element", why: "The action is unreachable by keyboard.", trigger: "A non-interactive element has onclick but lacks a role and a tabindex.", severity: "critical", fixable: true, humanReview: true },
  { id: "mouse-only-handler", wcag: "2.1.1 Keyboard", level: "A", category: "keyboard", title: "Mouse-only event handler", why: "Behaviour bound only to mouse events is unavailable to keyboard users.", trigger: "An element has onmouseover/onmousedown/ondblclick but no onkeydown, onkeyup or onfocus equivalent.", severity: "serious", fixable: false, humanReview: true },
  { id: "interactive-role-not-focusable", wcag: "2.1.1 Keyboard", level: "A", category: "keyboard", title: "Interactive role that cannot receive focus", why: "A custom control the keyboard cannot reach cannot be operated.", trigger: "An element with an interactive role (button, link, checkbox, tab…) is not natively focusable and has no tabindex.", severity: "serious", fixable: true, humanReview: true },
  { id: "focus-outline-removed", wcag: "2.4.7 Focus Visible", level: "AA", category: "keyboard", title: "Focus outline removed without replacement (static check)", why: "Keyboard users cannot see which element has focus.", trigger: "A stylesheet rule targeting :focus sets outline to none/0 without a box-shadow or border replacement, or a focusable element has an inline outline:none. Rendered focus styles need manual verification.", severity: "serious", fixable: false, humanReview: true },
  { id: "media-captions-missing", wcag: "1.2.2 Captions (Prerecorded)", level: "A", category: "media", title: "Media without a captions track", why: "Deaf and hard-of-hearing users lose the content.", trigger: "A <video> or <audio> element has no <track kind=captions|subtitles>.", severity: "serious", fixable: false, humanReview: true },
  { id: "doc-title-missing", wcag: "2.4.2 Page Titled", level: "A", category: "document", title: "Missing document title", why: "Tabs, history and screen readers have nothing to announce.", trigger: "The document has no non-empty <title>.", severity: "serious", fixable: true, humanReview: true },
  { id: "doc-duplicate-id", wcag: "4.1.1 Parsing", level: "A", category: "document", title: "Duplicate id value", why: "Label and ARIA references resolve to the wrong element.", trigger: "The same id value appears on more than one element.", severity: "moderate", fixable: false, humanReview: true },
  { id: "doc-viewport-zoom", wcag: "1.4.4 Resize Text", level: "AA", category: "document", title: "Zoom disabled in the viewport meta", why: "Users who need to zoom cannot.", trigger: "The viewport meta contains user-scalable=no or maximum-scale=1.", severity: "serious", fixable: true, humanReview: false },
];

export const RULES: RuleMeta[] = RULE_ROWS.map((row) => ({ ...row, source: row.source ?? "rule" }));

export const RULE_INDEX: Record<string, RuleMeta> = Object.fromEntries(
  RULES.map((rule) => [rule.id, rule]),
);

/** All rule ids in a fixed order — also the one-hot order for the severity model. */
export const RULE_IDS = RULES.map((rule) => rule.id);

/** Full WCAG mapping for a rule, the single source used by the pipeline, UI and reports. */
export function wcagMappingOf(ruleId: string) {
  const meta = RULE_INDEX[ruleId];
  if (!meta) return null;
  return {
    criterion: meta.wcag,
    level: meta.level,
    principle: principleOf(meta.wcag),
    category: meta.category,
    categoryLabel: CATEGORY_LABEL[meta.category],
    severity: meta.severity,
    explanation: meta.why,
    trigger: meta.trigger,
    autoFixable: meta.fixable,
    humanReview: meta.humanReview,
    source: meta.source,
  };
}

/** Distinct WCAG criteria the rule catalogue covers. */
export const WCAG_CRITERIA_COVERED = Array.from(new Set(RULES.map((rule) => rule.wcag))).sort();

const VALID_ROLES = new Set([
  "alert", "alertdialog", "application", "article", "banner", "button", "cell", "checkbox",
  "columnheader", "combobox", "complementary", "contentinfo", "definition", "dialog", "directory",
  "document", "feed", "figure", "form", "grid", "gridcell", "group", "heading", "img", "link",
  "list", "listbox", "listitem", "log", "main", "marquee", "math", "menu", "menubar", "menuitem",
  "menuitemcheckbox", "menuitemradio", "navigation", "none", "note", "option", "presentation",
  "progressbar", "radio", "radiogroup", "region", "row", "rowgroup", "rowheader", "scrollbar",
  "search", "searchbox", "separator", "slider", "spinbutton", "status", "switch", "tab", "table",
  "tablist", "tabpanel", "term", "textbox", "timer", "toolbar", "tooltip", "tree", "treegrid",
  "treeitem",
]);

const REQUIRED_ARIA: Record<string, string[]> = {
  checkbox: ["aria-checked"],
  switch: ["aria-checked"],
  radio: ["aria-checked"],
  combobox: ["aria-expanded"],
  slider: ["aria-valuenow"],
  spinbutton: ["aria-valuenow"],
  scrollbar: ["aria-controls", "aria-valuenow"],
  heading: ["aria-level"],
};

const FOCUSABLE = "a[href],button,input,select,textarea,[tabindex],summary,iframe,audio[controls],video[controls]";

const GENERIC_ALT = new Set([
  "image", "images", "img", "photo", "picture", "graphic", "icon", "logo", "banner", "spacer",
  "screenshot", "chart", "graph", "figure", "thumbnail", "untitled", "pic",
]);

/** Build a reasonably stable CSS selector path for an element. */
export function cssPath(el: Element): string {
  if (el.tagName.toLowerCase() === "html") return "html";
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && parts.length < 8) {
    const tag = node.tagName.toLowerCase();
    if (tag === "html") break;
    const id = node.getAttribute("id");
    if (id && /^[A-Za-z][-\w]*$/.test(id)) {
      parts.unshift(`#${id}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
    const index = siblings.indexOf(node) + 1;
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
    node = parent;
  }
  return parts.join(" > ") || el.tagName.toLowerCase();
}

export function snippetOf(el: Element | null): string {
  if (!el) return "";
  const html = el.outerHTML ?? "";
  return html.length > 400 ? `${html.slice(0, 400)}…` : html;
}

export function accessibleName(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const names = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument?.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean);
    if (names.length) return names.join(" ");
  }
  const title = el.getAttribute("title");
  const imgAlt = Array.from(el.querySelectorAll("img[alt]"))
    .map((img) => img.getAttribute("alt")?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text) return text;
  if (imgAlt) return imgAlt;
  if (el.tagName.toLowerCase() === "input") {
    const value = el.getAttribute("value");
    if (value && value.trim()) return value.trim();
  }
  return title?.trim() ?? "";
}

function isDecorative(img: Element): boolean {
  const role = img.getAttribute("role");
  return (
    role === "presentation" ||
    role === "none" ||
    img.getAttribute("aria-hidden") === "true" ||
    /(spacer|divider|pixel|blank|bg|background|decor)/i.test(img.getAttribute("src") ?? "")
  );
}

function fileNameOf(src: string): string {
  const clean = src.split("?")[0].split("#")[0];
  const parts = clean.split("/");
  return parts[parts.length - 1] ?? "";
}

function labelFor(doc: Document, control: Element): boolean {
  const id = control.getAttribute("id");
  if (id) {
    const escaped = id.replace(/["\\]/g, "\\$&");
    if (doc.querySelector(`label[for="${escaped}"]`)) return true;
  }
  return Boolean(control.closest("label"));
}

/** Run every DOM-only rule check against a parsed document. */
export function runRuleChecks(doc: Document): Finding[] {
  const findings: Finding[] = [];
  const push = (
    ruleId: string,
    el: Element | null,
    message: string,
    extra?: Finding["extra"],
  ) => {
    const meta = RULE_INDEX[ruleId];
    findings.push({
      ruleId,
      wcag: meta.wcag,
      level: meta.level,
      severityRule: meta.severity,
      message,
      el,
      extra,
    });
  };

  // ---- Document level -------------------------------------------------
  const html = doc.documentElement;
  const lang = html?.getAttribute("lang");
  if (!lang || !lang.trim()) {
    push("html-lang-missing", html, "The <html> element has no lang attribute.");
  }

  const titleText = doc.querySelector("title")?.textContent?.trim() ?? "";
  if (!titleText) {
    push("doc-title-missing", doc.head ?? html, "The document has no non-empty <title>.");
  }

  const viewport = doc.querySelector('meta[name="viewport"]');
  const viewportContent = viewport?.getAttribute("content") ?? "";
  if (/user-scalable\s*=\s*no/i.test(viewportContent) || /maximum-scale\s*=\s*1(\.0)?\b/i.test(viewportContent)) {
    push("doc-viewport-zoom", viewport, `Viewport meta prevents zooming: "${viewportContent}".`);
  }

  const seen = new Map<string, Element>();
  doc.querySelectorAll("[id]").forEach((el) => {
    const id = el.getAttribute("id") ?? "";
    if (!id) return;
    if (seen.has(id)) {
      push("doc-duplicate-id", el, `The id "${id}" is used more than once.`);
    } else {
      seen.set(id, el);
    }
  });

  // ---- Images ---------------------------------------------------------
  doc.querySelectorAll("img").forEach((img) => {
    const hasAlt = img.hasAttribute("alt");
    const alt = (img.getAttribute("alt") ?? "").trim();
    const src = img.getAttribute("src") ?? "";
    if (!hasAlt) {
      push("img-alt-missing", img, "Image has no alt attribute.", { altText: "" });
      return;
    }
    if (alt === "") {
      if (!isDecorative(img)) {
        push("img-alt-empty-meaningful", img, "Image has an empty alt but does not look decorative.", { altText: "" });
      }
      return;
    }
    const file = fileNameOf(src).toLowerCase();
    if (file && alt.toLowerCase() === file) {
      push("img-alt-filename", img, `Alt text equals the file name ("${alt}").`, { altText: alt });
      return;
    }
    if (/\.(jpe?g|png|gif|svg|webp|avif)$/i.test(alt)) {
      push("img-alt-filename", img, `Alt text looks like a file name ("${alt}").`, { altText: alt });
      return;
    }
    if (alt.length > 150) {
      push("img-alt-long", img, `Alt text is ${alt.length} characters long.`, { altText: alt });
      return;
    }
    if (GENERIC_ALT.has(alt.toLowerCase())) {
      push("img-alt-poor", img, `Alt text is a generic word ("${alt}").`, { altText: alt });
    }
  });

  // ---- Form controls --------------------------------------------------
  doc
    .querySelectorAll('input:not([type="hidden"]), select, textarea')
    .forEach((control) => {
      const type = (control.getAttribute("type") ?? "").toLowerCase();
      if (type === "submit" || type === "button" || type === "reset" || type === "image") return;
      const hasAria =
        Boolean(control.getAttribute("aria-label")?.trim()) ||
        Boolean(control.getAttribute("aria-labelledby")?.trim());
      const hasLabel = labelFor(doc, control);
      const placeholder = control.getAttribute("placeholder")?.trim() ?? "";
      if (!hasAria && !hasLabel) {
        if (placeholder) {
          push("input-placeholder-only", control, `Only a placeholder ("${placeholder}") identifies this field.`, { suggestion: placeholder });
        } else {
          push("input-label-missing", control, "Form control has no label, aria-label or aria-labelledby.");
        }
      }
    });

  // ---- Headings -------------------------------------------------------
  const headings = Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6"));
  const h1s = headings.filter((h) => h.tagName.toLowerCase() === "h1");
  if (headings.length > 0 && h1s.length === 0) {
    push("heading-missing-h1", headings[0], "The page has headings but no h1.");
  }
  if (h1s.length > 1) {
    h1s.slice(1).forEach((h) => push("heading-multiple-h1", h, `The page contains ${h1s.length} h1 elements.`));
  }
  let previousLevel = 0;
  headings.forEach((heading) => {
    const level = Number(heading.tagName.slice(1));
    if ((heading.textContent ?? "").trim() === "" && !heading.querySelector("img[alt]:not([alt=''])")) {
      push("heading-empty", heading, `Empty <${heading.tagName.toLowerCase()}>.`);
    }
    if (previousLevel && level > previousLevel + 1) {
      push(
        "heading-skip",
        heading,
        `Heading level jumps from h${previousLevel} to h${level}.`,
        { suggestion: `h${previousLevel + 1}` },
      );
    }
    previousLevel = level;
  });

  // ---- Links and buttons ---------------------------------------------
  doc.querySelectorAll("a[href]").forEach((link) => {
    const name = accessibleName(link);
    if (!name) {
      push("link-empty", link, "Link has no text or accessible name.");
    }
  });
  doc.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach((button) => {
    const name = accessibleName(button) || (button.getAttribute("value") ?? "").trim();
    if (!name) {
      push("button-empty", button, "Button has no text or accessible name.");
    }
  });

  // ---- Landmarks ------------------------------------------------------
  if (!doc.querySelector('main, [role="main"]')) {
    push("landmark-main-missing", doc.body ?? html, "The page has no <main> landmark.");
  }
  (["nav", "aside", "form", "section"] as const).forEach((tag) => {
    const nodes = Array.from(doc.querySelectorAll(tag));
    if (nodes.length < 2) return;
    nodes.forEach((node) => {
      const labelled =
        Boolean(node.getAttribute("aria-label")?.trim()) ||
        Boolean(node.getAttribute("aria-labelledby")?.trim());
      if (!labelled) {
        push(
          "landmark-duplicate-unlabelled",
          node,
          `There are ${nodes.length} <${tag}> landmarks and this one has no accessible name.`,
          { suggestion: tag === "nav" ? "Secondary navigation" : `${tag} region` },
        );
      }
    });
  });

  // ---- Tables ---------------------------------------------------------
  doc.querySelectorAll("table").forEach((table) => {
    const isLayout = table.getAttribute("role") === "presentation" || table.getAttribute("role") === "none";
    if (isLayout) return;
    if (!table.querySelector("th")) {
      push("table-th-missing", table, "Data table has no <th> header cells.");
    }
    if (!table.querySelector("caption")) {
      push("table-caption-missing", table, "Table has no <caption>.", { suggestion: "Table data" });
    }
  });

  // ---- ARIA -----------------------------------------------------------
  doc.querySelectorAll("[role]").forEach((el) => {
    const roles = (el.getAttribute("role") ?? "").trim().split(/\s+/).filter(Boolean);
    roles.forEach((role) => {
      if (!VALID_ROLES.has(role.toLowerCase())) {
        push("aria-role-invalid", el, `"${role}" is not a valid ARIA role.`, { suggestion: "button" });
      }
    });
    const required = REQUIRED_ARIA[roles[0]?.toLowerCase() ?? ""];
    if (required) {
      const missing = required.filter((attr) => !el.hasAttribute(attr));
      if (missing.length) {
        push(
          "aria-required-attr",
          el,
          `role="${roles[0]}" requires ${missing.join(", ")}.`,
          { suggestion: missing[0] },
        );
      }
    }
  });
  doc.querySelectorAll('[aria-hidden="true"]').forEach((el) => {
    const focusable = el.matches(FOCUSABLE) ? el : el.querySelector(FOCUSABLE);
    if (focusable && !(focusable as HTMLElement).hasAttribute("disabled")) {
      push("aria-hidden-focusable", el, "aria-hidden=\"true\" wraps or is set on a focusable element.");
    }
  });

  // ---- Keyboard -------------------------------------------------------
  doc.querySelectorAll("[tabindex]").forEach((el) => {
    const value = Number(el.getAttribute("tabindex"));
    if (Number.isFinite(value) && value > 0) {
      push("tabindex-positive", el, `tabindex="${value}" forces a manual focus order.`);
    }
  });
  doc.querySelectorAll("[onclick]").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const interactive = ["a", "button", "input", "select", "textarea", "summary"].includes(tag);
    const hasRole = Boolean(el.getAttribute("role"));
    const hasTabindex = el.hasAttribute("tabindex");
    if (!interactive && !(hasRole && hasTabindex)) {
      push("click-handler-non-interactive", el, `<${tag}> has a click handler but no role and no tabindex.`);
    }
  });

  // ---- Media ----------------------------------------------------------
  doc.querySelectorAll("video, audio").forEach((media) => {
    const hasCaptions = Array.from(media.querySelectorAll("track")).some((track) => {
      const kind = (track.getAttribute("kind") ?? "").toLowerCase();
      return kind === "captions" || kind === "subtitles";
    });
    if (!hasCaptions) {
      push("media-captions-missing", media, `<${media.tagName.toLowerCase()}> has no captions or subtitles track.`);
    }
  });

  return findings;
}

const TEXT_TAGS = new Set([
  "P", "SPAN", "A", "LI", "TD", "TH", "H1", "H2", "H3", "H4", "H5", "H6", "BUTTON", "LABEL",
  "STRONG", "EM", "SMALL", "FIGCAPTION", "BLOCKQUOTE", "DT", "DD", "SUMMARY", "CAPTION", "LEGEND",
]);

/**
 * Colour-contrast checks. These need real computed styles, so they run against
 * a document rendered inside a sandboxed iframe.
 */
export function runContrastChecks(rendered: Document): Finding[] {
  const findings: Finding[] = [];
  const view = rendered.defaultView;
  if (!view) return findings;
  const meta = RULE_INDEX["contrast-insufficient"];

  const effectiveBackground = (el: Element): Rgb => {
    let node: Element | null = el;
    let result: Rgb = { r: 255, g: 255, b: 255, a: 1 };
    const stack: Rgb[] = [];
    while (node) {
      const bg = parseColour(view.getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) {
        stack.unshift(bg);
        if (bg.a >= 1) break;
      }
      node = node.parentElement;
    }
    stack.forEach((layer) => {
      result = flatten(layer, result);
    });
    return result;
  };

  rendered.querySelectorAll("body *").forEach((el) => {
    if (!TEXT_TAGS.has(el.tagName)) return;
    const ownText = Array.from(el.childNodes)
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!ownText) return;
    const style = view.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return;

    const bg = effectiveBackground(el);
    const fgRaw = parseColour(style.color);
    if (!fgRaw) return;
    const fg = flatten(fgRaw, bg);
    const ratio = contrastRatio(fg, bg);

    const sizePx = parseFloat(style.fontSize) || 16;
    const weight = Number(style.fontWeight) || 400;
    const largeText = sizePx >= 24 || (sizePx >= 18.66 && weight >= 700);
    const required = largeText ? 3 : 4.5;

    if (ratio < required) {
      findings.push({
        ruleId: "contrast-insufficient",
        wcag: meta.wcag,
        level: meta.level,
        severityRule: meta.severity,
        message: `Contrast ratio ${ratio.toFixed(2)}:1 is below the required ${required}:1 for ${largeText ? "large" : "normal"} text.`,
        el,
        extra: {
          ratio,
          required,
          largeText,
          fg: style.color,
          bg: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
        },
      });
    }
  });

  return findings;
}
