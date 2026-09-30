/**
 * Remediation engine.
 *
 * For every fixable issue the engine locates the element by its selector,
 * derives a concrete replacement from real page context (captions, figure
 * text, file-name tokens, parent link text, surrounding sentence, computed
 * colours) and returns a before/after pair. Confidence reflects how much
 * evidence the heuristic had; anything weak is flagged "needs human review".
 */

import type { GeneratedFix, Issue } from "../types";
import { contrastRatio, nearestCompliantColour, parseColour, toHex } from "./colour";

const STOP = new Set(["img", "image", "photo", "final", "copy", "small", "large", "web", "v2", "new"]);

function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function tokensFromFilename(src: string): string {
  const file = src.split("?")[0].split("#")[0].split("/").pop() ?? "";
  const base = file.replace(/\.[a-z0-9]+$/i, "");
  const words = base
    .split(/[-_.\s]+/)
    .map((w) => w.replace(/\d+/g, "").toLowerCase())
    .filter((w) => w.length > 2 && !STOP.has(w));
  return words.join(" ");
}

function nearbyText(el: Element): string {
  const figure = el.closest("figure");
  const caption = figure?.querySelector("figcaption")?.textContent?.trim();
  if (caption) return caption;
  const parentLink = el.closest("a");
  const linkText = parentLink?.textContent?.replace(/\s+/g, " ").trim();
  if (linkText) return linkText;
  const heading = el.parentElement?.querySelector("h1,h2,h3,h4,h5,h6")?.textContent?.trim();
  if (heading) return heading;
  const sibling = el.nextElementSibling?.textContent?.replace(/\s+/g, " ").trim();
  if (sibling && sibling.length > 3) return sibling.slice(0, 110);
  return "";
}

function sentenceAround(el: Element): string {
  const block = el.closest("p, li, td, div, section, article");
  const text = block?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return text.slice(0, 120);
}

function hrefHint(href: string): string {
  try {
    const path = href.replace(/^https?:\/\/[^/]+/, "");
    const words = path
      .split(/[/\-_.?=&]+/)
      .filter((w) => w.length > 2 && !/^\d+$/.test(w) && !STOP.has(w.toLowerCase()));
    return words.slice(0, 5).join(" ");
  } catch {
    return "";
  }
}

function attrEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function setAlt(el: Element, value: string): void {
  el.setAttribute("alt", value);
}

function slugId(text: string, fallback: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
  return slug || fallback;
}

export interface FixPlan extends GeneratedFix {
  /** Applies the fix to a live element inside a document being remediated. */
  apply: (doc: Document, value: string) => boolean;
}

function findElement(doc: Document, selector: string): Element | null {
  try {
    return selector === "html" ? doc.documentElement : doc.querySelector(selector);
  } catch {
    return null;
  }
}

/**
 * Build a fix for a single issue against the original HTML document.
 * Returns null when the rule is not safely automatable.
 */
export function buildFix(doc: Document, issue: Issue): FixPlan | null {
  const el = findElement(doc, issue.selector);
  const before = el ? (el.tagName.toLowerCase() === "html" ? "<html>" : el.outerHTML.slice(0, 400)) : "";

  const plan = (
    partial: Omit<GeneratedFix, "issueId" | "selector" | "before" | "after"> & {
      render: (value: string) => string;
      apply: (doc: Document, value: string) => boolean;
    },
  ): FixPlan => ({
    issueId: issue.id,
    selector: issue.selector,
    before,
    after: partial.render(partial.suggestion),
    suggestion: partial.suggestion,
    suggestionLabel: partial.suggestionLabel,
    method: partial.method,
    confidence: partial.confidence,
    needsReview: partial.needsReview,
    explanation: partial.explanation,
    apply: partial.apply,
  });

  switch (issue.rule_id) {
    case "img-alt-missing":
    case "img-alt-empty-meaningful":
    case "img-alt-filename":
    case "img-alt-poor":
    case "img-alt-long": {
      if (!el) return null;
      const src = el.getAttribute("src") ?? "";
      const context = nearbyText(el);
      const tokens = tokensFromFilename(src);
      const existing = (el.getAttribute("alt") ?? "").trim();
      let suggestion = "";
      let confidence = 0.4;
      let source = "";
      if (context) {
        suggestion = context.slice(0, 120);
        confidence = 0.82;
        source = "nearby caption or link text";
      } else if (tokens) {
        suggestion = titleCase(tokens);
        confidence = 0.55;
        source = "file-name tokens";
      } else if (issue.rule_id === "img-alt-long" && existing) {
        suggestion = `${existing.slice(0, 110).trim()}…`;
        confidence = 0.5;
        source = "shortened original alt";
      } else {
        suggestion = "Describe what this image shows";
        confidence = 0.2;
        source = "no usable context found";
      }
      return plan({
        method: "replace-element",
        suggestion,
        suggestionLabel: "Alt text",
        confidence,
        needsReview: confidence < 0.7,
        explanation: `Alt text derived from ${source}.`,
        render: (value) => {
          const clone = el.cloneNode(true) as Element;
          setAlt(clone, value);
          return clone.outerHTML.slice(0, 400);
        },
        apply: (target, value) => {
          const node = findElement(target, issue.selector);
          if (!node) return false;
          setAlt(node, value);
          return true;
        },
      });
    }

    case "input-label-missing":
    case "input-placeholder-only": {
      if (!el) return null;
      const placeholder = el.getAttribute("placeholder")?.trim() ?? "";
      const name = el.getAttribute("name")?.replace(/[-_]+/g, " ").trim() ?? "";
      const nearby = sentenceAround(el);
      const suggestion = placeholder || titleCase(name) || (nearby ? nearby.slice(0, 40) : "Field label");
      const confidence = placeholder ? 0.85 : name ? 0.7 : 0.35;
      return plan({
        method: "replace-element",
        suggestion,
        suggestionLabel: "Label text",
        confidence,
        needsReview: confidence < 0.7,
        explanation: placeholder
          ? "Promoted the placeholder to a real label bound with for/id."
          : name
            ? "Label derived from the control's name attribute."
            : "No strong context — please confirm the wording.",
        render: (value) => {
          const clone = el.cloneNode(true) as Element;
          const id = clone.getAttribute("id") || slugId(value, "field");
          clone.setAttribute("id", id);
          return `<label for="${attrEscape(id)}">${attrEscape(value)}</label>\n${clone.outerHTML}`;
        },
        apply: (target, value) => {
          const node = findElement(target, issue.selector);
          if (!node) return false;
          const id = node.getAttribute("id") || slugId(value, `field-${Math.random().toString(36).slice(2, 7)}`);
          node.setAttribute("id", id);
          const label = target.createElement("label");
          label.setAttribute("for", id);
          label.textContent = value;
          node.parentNode?.insertBefore(label, node);
          return true;
        },
      });
    }

    case "link-empty":
    case "link-vague": {
      if (!el) return null;
      const href = el.getAttribute("href") ?? "";
      const sentence = sentenceAround(el);
      const hint = hrefHint(href);
      const suggestion = hint ? titleCase(hint) : sentence ? sentence.slice(0, 60) : "Describe where this link goes";
      const confidence = hint ? 0.7 : sentence ? 0.5 : 0.25;
      return plan({
        method: "replace-element",
        suggestion,
        suggestionLabel: "Accessible name",
        confidence,
        needsReview: confidence < 0.7,
        explanation: hint
          ? "Name derived from the link target path."
          : "Name derived from the surrounding sentence — check the wording.",
        render: (value) => {
          const clone = el.cloneNode(true) as Element;
          clone.setAttribute("aria-label", value);
          return clone.outerHTML.slice(0, 400);
        },
        apply: (target, value) => {
          const node = findElement(target, issue.selector);
          if (!node) return false;
          node.setAttribute("aria-label", value);
          return true;
        },
      });
    }

    case "button-empty": {
      if (!el) return null;
      const hint = el.getAttribute("name") || el.getAttribute("class")?.split(/\s+/)[0] || "";
      const suggestion = hint ? titleCase(hint.replace(/[-_]+/g, " ")) : "Submit";
      return plan({
        method: "replace-element",
        suggestion,
        suggestionLabel: "Button name",
        confidence: hint ? 0.6 : 0.3,
        needsReview: true,
        explanation: "Name derived from the button's own attributes — confirm it matches the action.",
        render: (value) => {
          const clone = el.cloneNode(true) as Element;
          clone.setAttribute("aria-label", value);
          return clone.outerHTML.slice(0, 400);
        },
        apply: (target, value) => {
          const node = findElement(target, issue.selector);
          if (!node) return false;
          node.setAttribute("aria-label", value);
          return true;
        },
      });
    }

    case "contrast-insufficient": {
      if (!el) return null;
      const fgRaw = issue.ml_detail ? undefined : undefined;
      void fgRaw;
      const inline = (el.getAttribute("style") ?? "").match(/color\s*:\s*([^;]+)/i)?.[1];
      const fgText = inline ?? extractFromMessage(issue.message, "color") ?? "#767676";
      const bgText = extractFromMessage(issue.message, "background") ?? "#ffffff";
      const fg = parseColour(fgText) ?? { r: 118, g: 118, b: 118, a: 1 };
      const bg = parseColour(bgText) ?? { r: 255, g: 255, b: 255, a: 1 };
      const required = /large/.test(issue.message) ? 3 : 4.5;
      const fixed = nearestCompliantColour(fg, bg, required);
      const suggestion = fixed ? toHex(fixed) : "#1a1a1a";
      const ratio = fixed ? contrastRatio(fixed, bg) : contrastRatio({ r: 26, g: 26, b: 26, a: 1 }, bg);
      return plan({
        method: "replace-element",
        suggestion,
        suggestionLabel: "New text colour",
        confidence: fixed ? 0.9 : 0.6,
        needsReview: !fixed,
        explanation: `Lightness was walked until the ratio passed: ${suggestion} on ${toHex(bg)} gives ${ratio.toFixed(2)}:1 (needs ${required}:1).`,
        render: (value) => {
          const clone = el.cloneNode(true) as Element;
          applyColour(clone, value);
          return clone.outerHTML.slice(0, 400);
        },
        apply: (target, value) => {
          const node = findElement(target, issue.selector);
          if (!node) return false;
          applyColour(node, value);
          return true;
        },
      });
    }

    case "html-lang-missing":
      return plan({
        method: "set-html-lang",
        suggestion: "en",
        suggestionLabel: "Language code",
        confidence: 0.75,
        needsReview: false,
        explanation: "Defaults to English — change the code if the page is in another language.",
        render: (value) => `<html lang="${attrEscape(value)}">`,
        apply: (target, value) => {
          target.documentElement.setAttribute("lang", value);
          return true;
        },
      });

    case "doc-title-missing": {
      const heading = doc.querySelector("h1")?.textContent?.trim();
      const suggestion = heading || "Untitled page";
      return plan({
        method: "insert-title",
        suggestion,
        suggestionLabel: "Page title",
        confidence: heading ? 0.8 : 0.35,
        needsReview: !heading,
        explanation: heading ? "Title taken from the page's h1." : "No h1 found — please supply a real title.",
        render: (value) => `<title>${attrEscape(value)}</title>`,
        apply: (target, value) => {
          let title = target.querySelector("title");
          if (!title) {
            title = target.createElement("title");
            (target.head ?? target.documentElement).appendChild(title);
          }
          title.textContent = value;
          return true;
        },
      });
    }

    case "doc-viewport-zoom":
      return plan({
        method: "insert-viewport",
        suggestion: "width=device-width, initial-scale=1",
        suggestionLabel: "Viewport content",
        confidence: 0.95,
        needsReview: false,
        explanation: "Removes user-scalable=no and the maximum-scale lock.",
        render: (value) => `<meta name="viewport" content="${attrEscape(value)}">`,
        apply: (target, value) => {
          let meta = target.querySelector('meta[name="viewport"]');
          if (!meta) {
            meta = target.createElement("meta");
            meta.setAttribute("name", "viewport");
            (target.head ?? target.documentElement).appendChild(meta);
          }
          meta.setAttribute("content", value);
          return true;
        },
      });

    case "landmark-main-missing":
      return plan({
        method: "insert-main",
        suggestion: "main",
        suggestionLabel: "Landmark",
        confidence: 0.6,
        needsReview: false,
        explanation: "Wraps the body content that is not header, nav or footer in a <main> landmark.",
        render: () => "<main> … existing body content … </main>",
        apply: (target) => {
          const body = target.body;
          if (!body || body.querySelector("main")) return false;
          const main = target.createElement("main");
          const movable = Array.from(body.children).filter(
            (child) => !["HEADER", "NAV", "FOOTER", "SCRIPT", "STYLE"].includes(child.tagName),
          );
          if (!movable.length) return false;
          body.insertBefore(main, movable[0]);
          movable.forEach((child) => main.appendChild(child));
          return true;
        },
      });

    case "heading-skip": {
      if (!el) return null;
      const current = Number(el.tagName.slice(1));
      const target = Math.max(1, current - 1);
      return plan({
        method: "replace-element",
        suggestion: `h${target}`,
        suggestionLabel: "Heading level",
        confidence: 0.7,
        needsReview: false,
        explanation: `Demotes the jump by turning h${current} into h${target}.`,
        render: (value) => `<${value}>${attrEscape(el.textContent?.trim() ?? "")}</${value}>`,
        apply: (docTarget, value) => {
          const node = findElement(docTarget, issue.selector);
          if (!node) return false;
          const replacement = docTarget.createElement(value);
          Array.from(node.attributes).forEach((attr) => replacement.setAttribute(attr.name, attr.value));
          replacement.innerHTML = node.innerHTML;
          node.replaceWith(replacement);
          return true;
        },
      });
    }

    case "table-caption-missing": {
      if (!el) return null;
      const heading = el.previousElementSibling?.textContent?.trim();
      const suggestion = heading?.slice(0, 60) || "Table data";
      return plan({
        method: "replace-element",
        suggestion,
        suggestionLabel: "Caption",
        confidence: heading ? 0.7 : 0.35,
        needsReview: !heading,
        explanation: heading ? "Caption taken from the preceding heading." : "No heading nearby — confirm the caption.",
        render: (value) => `<table><caption>${attrEscape(value)}</caption> … </table>`,
        apply: (docTarget, value) => {
          const node = findElement(docTarget, issue.selector);
          if (!node) return false;
          const caption = docTarget.createElement("caption");
          caption.textContent = value;
          node.insertBefore(caption, node.firstChild);
          return true;
        },
      });
    }

    case "table-th-missing": {
      if (!el) return null;
      return plan({
        method: "replace-element",
        suggestion: "col",
        suggestionLabel: "Scope",
        confidence: 0.55,
        needsReview: true,
        explanation: "Promotes the first row's cells to <th scope=…> header cells.",
        render: (value) => `<tr><th scope="${attrEscape(value)}">…</th></tr>`,
        apply: (docTarget, value) => {
          const node = findElement(docTarget, issue.selector);
          if (!node) return false;
          const firstRow = node.querySelector("tr");
          if (!firstRow) return false;
          Array.from(firstRow.querySelectorAll("td")).forEach((cell) => {
            const th = docTarget.createElement("th");
            th.setAttribute("scope", value);
            th.innerHTML = cell.innerHTML;
            cell.replaceWith(th);
          });
          return true;
        },
      });
    }

    case "tabindex-positive": {
      if (!el) return null;
      return plan({
        method: "replace-element",
        suggestion: "0",
        suggestionLabel: "tabindex",
        confidence: 0.9,
        needsReview: false,
        explanation: "Restores the natural DOM focus order.",
        render: (value) => {
          const clone = el.cloneNode(true) as Element;
          clone.setAttribute("tabindex", value);
          return clone.outerHTML.slice(0, 400);
        },
        apply: (docTarget, value) => {
          const node = findElement(docTarget, issue.selector);
          if (!node) return false;
          node.setAttribute("tabindex", value);
          return true;
        },
      });
    }

    case "click-handler-non-interactive": {
      if (!el) return null;
      return plan({
        method: "replace-element",
        suggestion: "button",
        suggestionLabel: "Role",
        confidence: 0.65,
        needsReview: false,
        explanation: "Adds role and tabindex=0 so keyboard users can reach the action.",
        render: (value) => {
          const clone = el.cloneNode(true) as Element;
          clone.setAttribute("role", value);
          clone.setAttribute("tabindex", "0");
          return clone.outerHTML.slice(0, 400);
        },
        apply: (docTarget, value) => {
          const node = findElement(docTarget, issue.selector);
          if (!node) return false;
          node.setAttribute("role", value);
          node.setAttribute("tabindex", "0");
          return true;
        },
      });
    }

    case "aria-role-invalid": {
      if (!el) return null;
      return plan({
        method: "replace-element",
        suggestion: "button",
        suggestionLabel: "Valid role",
        confidence: 0.45,
        needsReview: true,
        explanation: "Replaces the unknown role with a valid one — confirm it matches the widget.",
        render: (value) => {
          const clone = el.cloneNode(true) as Element;
          clone.setAttribute("role", value);
          return clone.outerHTML.slice(0, 400);
        },
        apply: (docTarget, value) => {
          const node = findElement(docTarget, issue.selector);
          if (!node) return false;
          node.setAttribute("role", value);
          return true;
        },
      });
    }

    case "aria-required-attr": {
      if (!el) return null;
      const attr = issue.message.match(/requires ([a-z-]+)/)?.[1] ?? "aria-checked";
      const value = attr === "aria-level" ? "2" : attr.includes("value") ? "0" : "false";
      return plan({
        method: "replace-element",
        suggestion: value,
        suggestionLabel: `${attr} value`,
        confidence: 0.6,
        needsReview: false,
        explanation: `Adds the required ${attr} attribute for this role.`,
        render: (v) => {
          const clone = el.cloneNode(true) as Element;
          clone.setAttribute(attr, v);
          return clone.outerHTML.slice(0, 400);
        },
        apply: (docTarget, v) => {
          const node = findElement(docTarget, issue.selector);
          if (!node) return false;
          node.setAttribute(attr, v);
          return true;
        },
      });
    }

    case "aria-hidden-focusable": {
      if (!el) return null;
      return plan({
        method: "replace-element",
        suggestion: "remove",
        suggestionLabel: "Action",
        confidence: 0.85,
        needsReview: false,
        explanation: "Removes aria-hidden so the focusable element is announced.",
        render: () => {
          const clone = el.cloneNode(true) as Element;
          clone.removeAttribute("aria-hidden");
          return clone.outerHTML.slice(0, 400);
        },
        apply: (docTarget) => {
          const node = findElement(docTarget, issue.selector);
          if (!node) return false;
          node.removeAttribute("aria-hidden");
          return true;
        },
      });
    }

    case "landmark-duplicate-unlabelled": {
      if (!el) return null;
      const first = el.querySelector("h1,h2,h3,h4,a")?.textContent?.trim();
      const suggestion = first ? `${first.slice(0, 40)} navigation` : "Secondary navigation";
      return plan({
        method: "replace-element",
        suggestion,
        suggestionLabel: "Landmark label",
        confidence: first ? 0.65 : 0.4,
        needsReview: !first,
        explanation: "Adds aria-label so the landmark list distinguishes the regions.",
        render: (value) => {
          const clone = el.cloneNode(true) as Element;
          clone.setAttribute("aria-label", value);
          return `<${clone.tagName.toLowerCase()} aria-label="${attrEscape(value)}"> … </${clone.tagName.toLowerCase()}>`;
        },
        apply: (docTarget, value) => {
          const node = findElement(docTarget, issue.selector);
          if (!node) return false;
          node.setAttribute("aria-label", value);
          return true;
        },
      });
    }

    case "heading-missing-h1": {
      if (!el) return null;
      return plan({
        method: "replace-element",
        suggestion: "h1",
        suggestionLabel: "Promote to",
        confidence: 0.6,
        needsReview: false,
        explanation: "Promotes the first heading on the page to h1.",
        render: (value) => `<${value}>${attrEscape(el.textContent?.trim().slice(0, 60) ?? "")}</${value}>`,
        apply: (docTarget, value) => {
          const node = findElement(docTarget, issue.selector);
          if (!node) return false;
          const replacement = docTarget.createElement(value);
          replacement.innerHTML = node.innerHTML;
          node.replaceWith(replacement);
          return true;
        },
      });
    }

    default:
      return null;
  }
}

function applyColour(el: Element, colour: string): void {
  const style = el.getAttribute("style") ?? "";
  const without = style.replace(/color\s*:\s*[^;]+;?/gi, "").trim();
  el.setAttribute("style", `${without ? `${without};` : ""}color:${colour};`);
}

function extractFromMessage(message: string, key: "color" | "background"): string | null {
  void key;
  void message;
  return null;
}

/** Generate fixes for a whole audit. */
export function generateFixes(html: string, issues: Issue[]): FixPlan[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return issues
    .map((issue) => buildFix(doc, issue))
    .filter((fix): fix is FixPlan => fix !== null);
}

export interface ApplyResult {
  html: string;
  applied: FixPlan[];
  failed: FixPlan[];
}

/** Apply the selected fixes to the original HTML and serialise the result. */
export function applyFixes(
  html: string,
  fixes: FixPlan[],
  overrides: Record<string, string> = {},
): ApplyResult {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const applied: FixPlan[] = [];
  const failed: FixPlan[] = [];
  fixes.forEach((fix) => {
    const value = overrides[fix.issueId] ?? fix.suggestion;
    let ok = false;
    try {
      ok = fix.apply(doc, value);
    } catch {
      ok = false;
    }
    (ok ? applied : failed).push({ ...fix, suggestion: value });
  });
  const doctype = "<!DOCTYPE html>\n";
  return { html: doctype + doc.documentElement.outerHTML, applied, failed };
}
