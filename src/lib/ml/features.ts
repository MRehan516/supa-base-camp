/**
 * Feature extraction.
 *
 * Text models use a hand-written character n-gram TF-IDF vectoriser (n = 2..4)
 * concatenated with hand-engineered numeric features. The tabular severity
 * model uses one-hot encodings plus scaled numerics. Nothing here depends on
 * a library — the maths is visible so it can be explained in a viva.
 */

import type { SeverityRow } from "../types";
import { ELEMENT_TYPES } from "./datasets";
import { RULE_IDS } from "../audit/rules";

const STOPWORDS = new Set([
  "a", "an", "the", "of", "and", "or", "to", "in", "on", "for", "with", "at", "by", "from",
  "is", "are", "was", "this", "that", "it", "as", "be",
]);

export function charNgrams(text: string, minN = 2, maxN = 4): string[] {
  const padded = ` ${text.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const grams: string[] = [];
  for (let n = minN; n <= maxN; n++) {
    for (let i = 0; i + n <= padded.length; i++) {
      grams.push(padded.slice(i, i + n));
    }
  }
  return grams;
}

/** Numeric features that do not need a vocabulary. */
export function handFeatures(text: string): { names: string[]; values: number[] } {
  const trimmed = text.trim();
  const words = trimmed.length ? trimmed.split(/\s+/) : [];
  const lower = trimmed.toLowerCase();
  const digits = (trimmed.match(/\d/g) ?? []).length;
  const stops = words.filter((w) => STOPWORDS.has(w.replace(/[^a-z]/gi, "").toLowerCase())).length;
  const genericWords = ["image", "photo", "picture", "graphic", "icon", "logo", "click", "here", "more", "link"];
  const values = [
    Math.min(1, trimmed.length / 120),
    Math.min(1, words.length / 20),
    /\.(jpe?g|png|gif|svg|webp|avif|bmp)$/i.test(lower) ? 1 : 0,
    genericWords.includes(lower) ? 1 : 0,
    genericWords.some((w) => lower.includes(w)) ? 1 : 0,
    trimmed.length ? digits / trimmed.length : 0,
    words.length ? stops / words.length : 0,
    /^https?:\/\//i.test(lower) || lower.startsWith("www.") ? 1 : 0,
    /[.!?]$/.test(trimmed) ? 1 : 0,
    words.length >= 5 ? 1 : 0,
    trimmed.length === 0 ? 1 : 0,
    /^[a-z]*_?\d+[a-z]*$/i.test(trimmed.replace(/[-.]/g, "")) ? 1 : 0,
  ];
  const names = [
    "length", "word_count", "has_file_ext", "is_generic_word", "contains_generic",
    "digit_ratio", "stopword_ratio", "is_url", "ends_sentence", "five_plus_words",
    "is_empty", "looks_like_id",
  ];
  return { names, values };
}

export interface VectoriserState {
  vocab: string[];
  idf: number[];
  maxFeatures: number;
}

/** Character n-gram TF-IDF vectoriser. */
export class Vectoriser {
  vocab: string[] = [];
  idf: number[] = [];
  index = new Map<string, number>();
  maxFeatures: number;

  constructor(maxFeatures = 600) {
    this.maxFeatures = maxFeatures;
  }

  fit(docs: string[]): this {
    const documentFreq = new Map<string, number>();
    docs.forEach((doc) => {
      new Set(charNgrams(doc)).forEach((gram) => {
        documentFreq.set(gram, (documentFreq.get(gram) ?? 0) + 1);
      });
    });
    this.vocab = [...documentFreq.entries()]
      .filter(([, freq]) => freq >= 2)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, this.maxFeatures)
      .map(([gram]) => gram);
    const total = docs.length || 1;
    this.idf = this.vocab.map((gram) => Math.log((1 + total) / (1 + (documentFreq.get(gram) ?? 0))) + 1);
    this.index = new Map(this.vocab.map((gram, i) => [gram, i]));
    return this;
  }

  /** TF-IDF vector, L2 normalised, followed by the hand-engineered features. */
  transform(text: string): number[] {
    const counts = new Map<number, number>();
    const grams = charNgrams(text);
    grams.forEach((gram) => {
      const i = this.index.get(gram);
      if (i !== undefined) counts.set(i, (counts.get(i) ?? 0) + 1);
    });
    const vector = new Array<number>(this.vocab.length).fill(0);
    let norm = 0;
    counts.forEach((count, i) => {
      const value = (count / Math.max(1, grams.length)) * this.idf[i];
      vector[i] = value;
      norm += value * value;
    });
    if (norm > 0) {
      const inv = 1 / Math.sqrt(norm);
      for (let i = 0; i < vector.length; i++) vector[i] *= inv;
    }
    return [...vector, ...handFeatures(text).values];
  }

  get dimension(): number {
    return this.vocab.length + handFeatures("x").values.length;
  }

  toJSON(): VectoriserState {
    return { vocab: this.vocab, idf: this.idf, maxFeatures: this.maxFeatures };
  }

  static fromJSON(state: VectoriserState): Vectoriser {
    const v = new Vectoriser(state.maxFeatures);
    v.vocab = state.vocab;
    v.idf = state.idf;
    v.index = new Map(state.vocab.map((gram, i) => [gram, i]));
    return v;
  }
}

// ---------------------------------------------------------------------------
// Severity model features (tabular)
// ---------------------------------------------------------------------------

export const SEVERITY_FEATURE_GROUPS = [
  "rule_id", "element_type", "in_nav", "interactive", "position", "contrast_gap", "same_rule_count",
] as const;

export function severityFeatureNames(): string[] {
  return [
    ...RULE_IDS.map((id) => `rule:${id}`),
    ...ELEMENT_TYPES.map((tag) => `element:${tag}`),
    "in_nav",
    "interactive",
    "position",
    "contrast_gap",
    "same_rule_count",
  ];
}

export function severityFeatures(row: SeverityRow): number[] {
  const ruleOneHot = RULE_IDS.map((id) => (id === row.ruleId ? 1 : 0));
  const tag = ELEMENT_TYPES.includes(row.elementType) ? row.elementType : "other";
  const elementOneHot = ELEMENT_TYPES.map((t) => (t === tag ? 1 : 0));
  return [
    ...ruleOneHot,
    ...elementOneHot,
    row.inNav ? 1 : 0,
    row.interactive ? 1 : 0,
    Math.min(1, Math.max(0, row.position)),
    Math.min(1, row.contrastGap / 4),
    Math.min(1, row.sameRuleCount / 10),
  ];
}

/** Which feature indices belong to each named group (for permutation importance). */
export function severityGroupIndices(): Record<string, number[]> {
  const ruleCount = RULE_IDS.length;
  const elementCount = ELEMENT_TYPES.length;
  const base = ruleCount + elementCount;
  return {
    rule_id: Array.from({ length: ruleCount }, (_, i) => i),
    element_type: Array.from({ length: elementCount }, (_, i) => ruleCount + i),
    in_nav: [base],
    interactive: [base + 1],
    position: [base + 2],
    contrast_gap: [base + 3],
    same_rule_count: [base + 4],
  };
}
