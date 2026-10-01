/**
 * AccessLens Audit Score.
 *
 * A project-defined metric that summarises detected issues. It is NOT a
 * certification of WCAG compliance.
 *
 * score = 100 * (1 - penalty), where
 *   penalty = Σ(weight(severity)) / (weightCeiling * log2(elements + 2))
 *
 * The weights below encode WCAG impact: a blocker costs 10× a cosmetic issue.
 * Dividing by log2(elementCount) normalises for page size, so a 40-element
 * page and a 4000-element page with the same issue density score alike.
 * The result is clamped to 0..100 and rounded to an integer.
 *
 * Only deterministic rule findings count. Advisory findings raised solely by
 * an ML model (detection_source = "model") are shown but never scored, so a
 * model prediction can never lower the score on its own.
 */

import type { Issue, Severity } from "../types";

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 10,
  serious: 6,
  moderate: 3,
  minor: 1,
};

export const WEIGHT_CEILING = 12;

type Scorable = Pick<Issue, "severity_rule" | "severity_ml"> & { detection_source?: "rule" | "model" };

export function severityOf(issue: Pick<Issue, "severity_rule" | "severity_ml">): Severity {
  return (issue.severity_ml ?? issue.severity_rule) as Severity;
}

export function isScored(issue: Scorable): boolean {
  return issue.detection_source !== "model";
}

export function computeScore(issues: Scorable[], elementCount: number): number {
  const scored = issues.filter(isScored);
  if (elementCount <= 0) return scored.length === 0 ? 100 : 0;
  const penaltySum = scored.reduce((total, issue) => total + SEVERITY_WEIGHT[severityOf(issue)], 0);
  const normaliser = WEIGHT_CEILING * Math.log2(elementCount + 2);
  const penalty = Math.min(1, penaltySum / normaliser);
  return Math.max(0, Math.min(100, Math.round(100 * (1 - penalty))));
}

export function scoreBand(score: number): { label: string; tone: "pass" | "warn" | "fail" } {
  if (score >= 85) return { label: "Good", tone: "pass" };
  if (score >= 60) return { label: "Needs work", tone: "warn" };
  return { label: "Poor", tone: "fail" };
}

export function countBySeverity(
  issues: Array<Pick<Issue, "severity_rule" | "severity_ml">>,
): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  issues.forEach((issue) => {
    counts[severityOf(issue)] += 1;
  });
  return counts;
}
