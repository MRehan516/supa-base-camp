/**
 * AccessLens shared domain types.
 * Used by the audit engine, the ML engine, the service layer and the UI.
 */

export type Severity = "critical" | "serious" | "moderate" | "minor";

export const SEVERITIES: Severity[] = ["critical", "serious", "moderate", "minor"];

export type WcagLevel = "A" | "AA" | "AAA";

/** Tabular feature source for the severity model (Model 3). */
export interface SeverityRow {
  ruleId: string;
  elementType: string;
  inNav: boolean;
  interactive: boolean;
  /** 0..1 — vertical position of the element in document order. */
  position: number;
  /** How far the contrast ratio is below the required ratio (0 when not a contrast issue). */
  contrastGap: number;
  /** How many issues of the same rule exist on the page. */
  sameRuleCount: number;
}

/** A raw rule-check result, still attached to a live DOM element. */
export interface Finding {
  ruleId: string;
  wcag: string;
  level: WcagLevel;
  message: string;
  severityRule: Severity;
  el: Element | null;
  /** Extra values a rule computed (alt text, link text, contrast numbers…). */
  extra?: {
    altText?: string;
    linkText?: string;
    ratio?: number;
    required?: number;
    fg?: string;
    bg?: string;
    largeText?: boolean;
    suggestion?: string;
  };
}

export interface MlDetail {
  severityProbs?: number[];
  severityFeatures?: SeverityRow;
  altProbs?: number[];
  altLabel?: string;
  linkProbs?: number[];
  linkLabel?: string;
  /** Issue-type model output over the snippet (supporting evidence only). */
  typeProbs?: number[];
  typeClasses?: string[];
  typeLabel?: string;
}

/** Concrete evidence recorded for a finding at detection time. */
export interface IssueEvidence {
  tag: string;
  trigger: string;
  values?: Record<string, string | number | boolean>;
}

export type IssueStatus = "open" | "suggested" | "applied" | "verified" | "rejected" | "needs_review";
export const ISSUE_STATUSES: IssueStatus[] = ["open", "suggested", "applied", "verified", "rejected", "needs_review"];

/** A persisted issue (shape matches the `issues` table). */
export interface Issue {
  id: string;
  audit_id: string;
  rule_id: string;
  wcag_criterion: string;
  wcag_level: string;
  selector: string;
  snippet: string;
  message: string;
  severity_rule: Severity;
  severity_ml: Severity | null;
  ml_confidence: number | null;
  ml_detail: MlDetail | null;
  status: string;
  issue_code?: string;
  wcag_principle?: string;
  category?: string;
  auto_fixable?: boolean;
  human_review?: boolean;
  evidence?: IssueEvidence | null;
  detection_source?: "rule" | "model";
  reviewed_at?: string | null;
  created_at?: string;
}

/** A compact issue record kept for a re-audit (remediated_pages.after_issues). */
export interface AfterIssue {
  rule_id: string;
  selector: string;
  message: string;
  severity: Severity;
  detection_source: "rule" | "model";
}

export interface Audit {
  id: string;
  project_id: string | null;
  html_source: string;
  score: number;
  element_count: number;
  duration_ms: number;
  created_at: string;
}

export interface AuditWithIssues extends Audit {
  issues: Issue[];
  project?: { id: string; name: string; source_type: string } | null;
  remediated?: RemediatedPage | null;
}

export interface RemediatedPage {
  id: string;
  audit_id: string;
  html_fixed: string;
  score_after: number;
  issues_after: number;
  after_issues?: AfterIssue[];
  element_count?: number;
  created_at: string;
}

export type FixVerification = "resolved" | "not_resolved" | "partially_resolved";

export interface FixRecord {
  id: string;
  issue_id: string;
  before_html: string;
  after_html: string;
  method: string;
  confidence: number;
  applied: boolean;
  status: string;
  edited: boolean;
  predicted_success: number | null;
  verification: FixVerification | null;
  remediated_page_id: string | null;
  created_at: string;
}

export type FixMethod =
  | "replace-element"
  | "set-html-lang"
  | "insert-title"
  | "insert-viewport"
  | "insert-main";

export interface GeneratedFix {
  issueId: string;
  selector: string;
  method: FixMethod;
  before: string;
  after: string;
  /** The editable part of the fix (alt text, label text, colour…). */
  suggestion: string;
  suggestionLabel: string;
  confidence: number;
  needsReview: boolean;
  explanation: string;
}

/** Progress event emitted by the audit pipeline. */
export interface PipelineStage {
  stage: "parsing" | "rules" | "contrast" | "ml" | "scoring" | "saving" | "done";
  label: string;
  detail: string;
  at: number;
  progress: number;
}
