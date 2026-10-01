/**
 * Service layer.
 *
 * The UI never talks to the database directly — it calls these services, which
 * mirror the REST contract documented on the Methodology page:
 *
 *   POST   /api/audits                 AuditService.create
 *   GET    /api/audits                 AuditService.list
 *   GET    /api/audits/:id             AuditService.get
 *   DELETE /api/audits/:id             AuditService.remove
 *   POST   /api/audits/:id/remediate   RemediationService.apply
 *   POST   /api/ml/alt-text/predict    MlService.predictAlt
 *   POST   /api/ml/link-text/predict   MlService.predictLink
 *   POST   /api/ml/train/:model        MlService.train
 *   GET    /api/ml/models              MlService.list
 *   GET    /api/stats                  StatsService.dashboard
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  AfterIssue,
  Audit,
  AuditWithIssues,
  FixVerification,
  Issue,
  IssueStatus,
  RemediatedPage,
  Severity,
} from "./types";
import { ISSUE_STATUSES } from "./types";
import { runPipeline, type DraftIssue, type PipelineOptions } from "./audit/pipeline";
import { applyFixes, generateFixes, type FixPlan } from "./audit/remediate";
import { computeScore, countBySeverity, severityOf } from "./audit/scoring";
import {
  MODEL_NAMES,
  type ModelKind,
  type ModelMetrics,
  type TrainedModel,
  predictFixSuccess,
  predictText,
  trainModel,
  type EpochPoint,
} from "./ml/engine";

function fail(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

/** Service-layer input limits (validated before anything reaches the database). */
export const LIMITS = { htmlBytes: 2_000_000, projectName: 120, suggestion: 500, datasetText: 300 };

function validateHtml(html: string): void {
  if (!html.trim()) throw new Error("There is no HTML to audit.");
  if (new Blob([html]).size > LIMITS.htmlBytes) {
    throw new Error(`The HTML is larger than ${(LIMITS.htmlBytes / 1_000_000).toFixed(0)} MB. Audit a smaller page or a single template.`);
  }
}

let traceSink: ((line: string) => void) | null = null;
/** Verification mode: every database write and model call is echoed here. */
export function setTraceSink(sink: ((line: string) => void) | null): void {
  traceSink = sink;
}
function trace(line: string): void {
  traceSink?.(line);
}

function toAfterIssue(issue: DraftIssue): AfterIssue {
  return {
    rule_id: issue.rule_id,
    selector: issue.selector,
    message: issue.message,
    severity: severityOf(issue),
    detection_source: issue.detection_source ?? "rule",
  };
}

// ---------------------------------------------------------------------------
// Audits
// ---------------------------------------------------------------------------

export const AuditService = {
  async create(
    projectName: string,
    html: string,
    sourceType: string,
    options: PipelineOptions = {},
  ): Promise<{ auditId: string; score: number; issueCount: number }> {
    validateHtml(html);
    const name = (projectName || "Untitled page").trim().slice(0, LIMITS.projectName);
    const source = ["paste", "upload", "sample"].includes(sourceType) ? sourceType : "paste";

    const result = await runPipeline(html, {
      ...options,
      onTrace: (line) => {
        trace(line);
        options.onTrace?.(line);
      },
    });

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({ name, source_type: source })
      .select("id")
      .single();
    fail("Could not save the project", projectError);
    trace(`db.insert projects → ${project!.id}`);

    const { data: audit, error: auditError } = await supabase
      .from("audits")
      .insert({
        project_id: project!.id,
        html_source: html,
        score: result.score,
        element_count: result.elementCount,
        duration_ms: result.durationMs,
      })
      .select("id")
      .single();
    fail("Could not save the audit", auditError);
    trace(`db.insert audits → ${audit!.id}`);

    if (result.issues.length) {
      const rows = result.issues.map((issue) => ({ ...issue, audit_id: audit!.id }));
      const { error: issuesError } = await supabase.from("issues").insert(rows as never);
      fail("Could not save the issues", issuesError);
      trace(`db.insert issues → ${rows.length} rows`);

      const logs: { model_kind: string; audit_id: string; input_text: string; probabilities: number[]; predicted_label: string }[] = [];
      result.issues.forEach((issue) => {
        const d = issue.ml_detail;
        if (d?.severityProbs) {
          logs.push({ model_kind: "severity", audit_id: audit!.id, input_text: `${issue.rule_id} @ ${issue.selector}`, probabilities: d.severityProbs, predicted_label: issue.severity_ml ?? "" });
        }
        if (d?.typeProbs) {
          logs.push({ model_kind: "issueType", audit_id: audit!.id, input_text: issue.snippet.slice(0, 200), probabilities: d.typeProbs, predicted_label: d.typeLabel ?? "" });
        }
        if (d?.altProbs) {
          logs.push({ model_kind: "alt", audit_id: audit!.id, input_text: String(issue.evidence?.values?.alt ?? ""), probabilities: d.altProbs, predicted_label: d.altLabel ?? "" });
        }
        if (d?.linkProbs) {
          logs.push({ model_kind: "link", audit_id: audit!.id, input_text: String(issue.evidence?.values?.linkText ?? ""), probabilities: d.linkProbs, predicted_label: d.linkLabel ?? "" });
        }
      });
      if (logs.length) {
        const { error: logError } = await supabase.from("prediction_logs").insert(logs);
        fail("Could not save the prediction log", logError);
        trace(`db.insert prediction_logs → ${logs.length} rows`);
      }
    }

    return { auditId: audit!.id, score: result.score, issueCount: result.issues.length };
  },

  async list(): Promise<(Audit & { project: { name: string; source_type: string } | null; issue_count: number })[]> {
    const { data, error } = await supabase
      .from("audits")
      .select("*, projects(name, source_type), issues(id)")
      .order("created_at", { ascending: false });
    fail("Could not load audits", error);
    return (data ?? []).map((row: Record<string, unknown>) => ({
      ...(row as unknown as Audit),
      project: (row.projects as { name: string; source_type: string } | null) ?? null,
      issue_count: ((row.issues as unknown[]) ?? []).length,
    }));
  },

  async get(id: string): Promise<AuditWithIssues | null> {
    const { data, error } = await supabase
      .from("audits")
      .select("*, projects(id, name, source_type), issues(*, fixes(*)), remediated_pages(*)")
      .eq("id", id)
      .maybeSingle();
    fail("Could not load the audit", error);
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const remediated = ((row.remediated_pages as RemediatedPage[]) ?? []).sort(
      (a, b) => (a.created_at < b.created_at ? 1 : -1),
    );
    const issues = ((row.issues as Issue[]) ?? []).map((issue) => ({
      ...issue,
      fixes: (issue.fixes ?? []).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    }));
    return {
      ...(row as unknown as Audit),
      issues: issues.sort((a, b) =>
        (a.issue_code ?? "") && (b.issue_code ?? "")
          ? (a.issue_code ?? "").localeCompare(b.issue_code ?? "")
          : a.rule_id.localeCompare(b.rule_id),
      ),
      project: (row.projects as AuditWithIssues["project"]) ?? null,
      remediated: remediated[0] ?? null,
    };
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("audits").delete().eq("id", id);
    fail("Could not delete the audit", error);
    trace(`db.delete audits/${id}`);
  },

  async clearAll(): Promise<void> {
    for (const table of ["prediction_logs", "audits", "projects", "dataset_examples"] as const) {
      const { error } = await supabase.from(table).delete().not("id", "is", null);
      fail(`Could not clear ${table}`, error);
      trace(`db.delete ${table} (all rows)`);
    }
  },
};

// ---------------------------------------------------------------------------
// Remediation
// ---------------------------------------------------------------------------

export interface FixOutcome {
  issueId: string;
  ruleId: string;
  selector: string;
  applied: boolean;
  predicted: number | null;
  verification: FixVerification;
  detail: string;
}

/**
 * Decide what the real re-audit says about one applied fix.
 *  - not_resolved: the same rule still fires on the same element (or the fix could not be applied)
 *  - partially_resolved: the rule stopped firing but a different rule now fires on that element
 *  - resolved: neither
 */
export function verifyFix(
  issue: Pick<Issue, "rule_id" | "selector">,
  applied: boolean,
  before: Pick<AfterIssue, "rule_id" | "selector">[],
  after: Pick<AfterIssue, "rule_id" | "selector" | "message">[],
): { verification: FixVerification; detail: string } {
  if (!applied) return { verification: "not_resolved", detail: "The fix could not be applied to the element (selector not found)." };
  const same = after.find((a) => a.rule_id === issue.rule_id && a.selector === issue.selector);
  if (same) return { verification: "not_resolved", detail: `Re-audit still reports this rule: ${same.message}` };
  const beforeHere = new Set(before.filter((b) => b.selector === issue.selector).map((b) => b.rule_id));
  const introduced = after.filter((a) => a.selector === issue.selector && !beforeHere.has(a.rule_id));
  if (introduced.length) {
    return { verification: "partially_resolved", detail: `Original rule cleared, but the re-audit now reports ${introduced.map((i) => i.rule_id).join(", ")} on the same element.` };
  }
  return { verification: "resolved", detail: "Re-audit no longer reports this rule on this element." };
}

export const RemediationService = {
  generate(html: string, issues: Issue[]): FixPlan[] {
    return generateFixes(html, issues);
  },

  /** Fix-success model predictions (null when untrained or the rule is outside its coverage). */
  async predict(fixes: FixPlan[], issues: Record<string, Issue>, overrides: Record<string, string>): Promise<Record<string, number | null>> {
    const out: Record<string, number | null> = {};
    for (const fix of fixes) {
      const issue = issues[fix.issueId];
      const value = overrides[fix.issueId] ?? fix.suggestion;
      const prediction = issue
        ? await predictFixSuccess({
            ruleId: issue.rule_id,
            method: fix.method,
            suggestion: value,
            defaultSuggestion: fix.suggestion,
            heuristicConfidence: fix.confidence,
            needsReview: fix.needsReview,
          })
        : null;
      out[fix.issueId] = prediction ? prediction.probabilities[prediction.classes.indexOf("resolved")] : null;
    }
    return out;
  },

  async setStatus(issueIds: string[], status: IssueStatus): Promise<void> {
    if (!ISSUE_STATUSES.includes(status)) throw new Error(`Unknown status "${status}".`);
    if (!issueIds.length) return;
    const { error } = await supabase.from("issues").update({ status } as never).in("id", issueIds);
    fail("Could not update issue status", error);
    trace(`db.update issues.status=${status} → ${issueIds.length} rows`);
  },

  async markReviewed(issueId: string): Promise<void> {
    const { error } = await supabase.from("issues").update({ reviewed_at: new Date().toISOString() } as never).eq("id", issueId);
    fail("Could not mark the issue as reviewed", error);
    trace(`db.update issues.reviewed_at → ${issueId}`);
  },

  async reject(issue: Issue, fix: FixPlan): Promise<void> {
    const { error } = await supabase.from("fixes").insert({
      issue_id: issue.id,
      before_html: fix.before,
      after_html: fix.after,
      method: fix.method,
      confidence: fix.confidence,
      applied: false,
      status: "rejected",
    } as never);
    fail("Could not record the rejection", error);
    await RemediationService.setStatus([issue.id], "rejected");
  },

  /** Apply the selected fixes, re-run the real audit, verify each fix and store everything. */
  async apply(
    audit: AuditWithIssues,
    fixes: FixPlan[],
    overrides: Record<string, string>,
    predictions: Record<string, number | null>,
    options: PipelineOptions = {},
  ): Promise<{ remediated: RemediatedPage; html: string; outcomes: FixOutcome[] }> {
    if (!fixes.length) throw new Error("Select at least one fix to apply.");
    const clean: Record<string, string> = {};
    Object.entries(overrides).forEach(([key, value]) => {
      clean[key] = value.slice(0, LIMITS.suggestion);
    });
    const { html, applied, failed } = applyFixes(audit.html_source, fixes, clean);
    trace(`remediation: ${applied.length} applied, ${failed.length} could not be applied`);

    const reaudit = await runPipeline(html, options);
    const afterIssues = reaudit.issues.map(toAfterIssue);
    const before = audit.issues.map((i) => ({ rule_id: i.rule_id, selector: i.selector }));

    const { data, error } = await supabase
      .from("remediated_pages")
      .insert({
        audit_id: audit.id,
        html_fixed: html,
        score_after: reaudit.score,
        issues_after: reaudit.issues.length,
        after_issues: afterIssues,
        element_count: reaudit.elementCount,
      } as never)
      .select("*")
      .single();
    fail("Could not save the remediated page", error);
    const page = data as unknown as RemediatedPage;
    trace(`db.insert remediated_pages → ${page.id}`);

    const issueById = Object.fromEntries(audit.issues.map((i) => [i.id, i]));
    const outcomes: FixOutcome[] = [...applied.map((f) => ({ f, ok: true })), ...failed.map((f) => ({ f, ok: false }))].map(({ f, ok }) => {
      const issue = issueById[f.issueId];
      const v = verifyFix(issue, ok, before, afterIssues);
      return {
        issueId: f.issueId,
        ruleId: issue.rule_id,
        selector: issue.selector,
        applied: ok,
        predicted: predictions[f.issueId] ?? null,
        verification: v.verification,
        detail: v.detail,
      };
    });

    const allFixes = [...applied, ...failed];
    const rows = allFixes.map((fix) => {
      const outcome = outcomes.find((o) => o.issueId === fix.issueId)!;
      const original = fixes.find((f) => f.issueId === fix.issueId);
      return {
        issue_id: fix.issueId,
        before_html: fix.before,
        after_html: fix.after.replace(original?.suggestion ?? "", fix.suggestion),
        method: fix.method,
        confidence: fix.confidence,
        applied: outcome.applied,
        status: outcome.applied ? "applied" : "failed",
        edited: Boolean(original && original.suggestion !== fix.suggestion),
        predicted_success: outcome.predicted,
        verification: outcome.verification,
        remediated_page_id: page.id,
      };
    });
    const { error: fixError } = await supabase.from("fixes").insert(rows as never);
    fail("Could not save the fixes", fixError);
    trace(`db.insert fixes → ${rows.length} rows`);

    const verified = outcomes.filter((o) => o.verification === "resolved").map((o) => o.issueId);
    const review = outcomes.filter((o) => o.verification !== "resolved").map((o) => o.issueId);
    await RemediationService.setStatus(verified, "verified");
    await RemediationService.setStatus(review, "needs_review");

    const fixLogs = outcomes
      .filter((o) => o.predicted !== null)
      .map((o) => ({
        model_kind: "fixSuccess",
        audit_id: audit.id,
        input_text: `${o.ruleId} @ ${o.selector} → actual ${o.verification}`,
        probabilities: [o.predicted!, 1 - o.predicted!],
        predicted_label: o.predicted! >= 0.5 ? "resolved" : "not_resolved",
      }));
    if (fixLogs.length) {
      const { error: logError } = await supabase.from("prediction_logs").insert(fixLogs);
      fail("Could not save the fix predictions", logError);
    }

    return { remediated: page, html, outcomes };
  },
};

// ---------------------------------------------------------------------------
// ML
// ---------------------------------------------------------------------------

export const MlService = {
  async train(kind: ModelKind, onEpoch?: (point: EpochPoint) => void): Promise<TrainedModel> {
    trace(`ml.train ${kind} started`);
    const model = await trainModel(kind, onEpoch);
    await MlService.record(model);
    trace(`ml.train ${kind} finished — test accuracy ${(model.metrics.accuracy * 100).toFixed(2)}%`);
    return model;
  },

  async record(model: TrainedModel): Promise<void> {
    const { data, error } = await supabase
      .from("ml_models")
      .insert({
        name: MODEL_NAMES[model.kind],
        kind: model.kind,
        version: `v${model.metrics.epochs}-${model.metrics.featureDim}`,
        metrics: JSON.parse(JSON.stringify(model.metrics)),
      })
      .select("id")
      .single();
    fail("Could not save the model record", error);
    trace(`db.insert ml_models → ${data!.id}`);

    const { error: runError } = await supabase.from("training_runs").insert({
      model_id: data!.id,
      loss_history: model.history.map((p) => p.loss),
      acc_history: model.history.map((p) => p.acc),
      val_loss_history: model.history.map((p) => p.valLoss),
      val_acc_history: model.history.map((p) => p.valAcc),
      epochs: model.metrics.epochs,
      train_size: model.metrics.trainSize,
      val_size: model.metrics.valSize,
      duration_ms: model.metrics.durationMs,
    });
    fail("Could not save the training run", runError);
    trace("db.insert training_runs → 1 row");
  },

  async listRecords(): Promise<
    { id: string; name: string; kind: string; version: string; metrics: ModelMetrics; trained_at: string }[]
  > {
    const { data, error } = await supabase
      .from("ml_models")
      .select("*")
      .order("trained_at", { ascending: false });
    fail("Could not load model records", error);
    return (data ?? []) as never;
  },

  async predictAlt(text: string) {
    return predictText("alt", text);
  },

  async predictLink(text: string) {
    return predictText("link", text);
  },

  async logPrediction(kind: ModelKind, text: string, label: string, probabilities: number[]): Promise<void> {
    const { error } = await supabase.from("prediction_logs").insert({
      model_kind: kind,
      input_text: text,
      probabilities,
      predicted_label: label,
    });
    fail("Could not save the prediction", error);
    trace(`db.insert prediction_logs → ${kind} "${text.slice(0, 30)}" = ${label}`);
  },

  async recentPredictions(limit = 40) {
    const { data, error } = await supabase
      .from("prediction_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    fail("Could not load prediction logs", error);
    return (data ?? []) as {
      id: string;
      model_kind: string;
      input_text: string;
      predicted_label: string;
      probabilities: number[];
      created_at: string;
    }[];
  },
};

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

export const DatasetService = {
  async list(): Promise<{ id: string; dataset: string; text: string; label: string; created_at: string }[]> {
    const { data, error } = await supabase
      .from("dataset_examples")
      .select("*")
      .order("created_at", { ascending: false });
    fail("Could not load your examples", error);
    return (data ?? []) as never;
  },

  async add(dataset: string, text: string, label: string): Promise<void> {
    if (!text.trim() && dataset !== "alt") throw new Error("Enter the text for the example.");
    const { error } = await supabase.from("dataset_examples").insert({ dataset, text, label });
    fail("Could not save the example", error);
    trace(`db.insert dataset_examples → ${dataset}/${label}`);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("dataset_examples").delete().eq("id", id);
    fail("Could not delete the example", error);
  },
};

// ---------------------------------------------------------------------------
// Stats and export
// ---------------------------------------------------------------------------

export interface DashboardStats {
  totalAudits: number;
  averageScore: number;
  totalIssues: number;
  bySeverity: Record<Severity, number>;
  trend: { date: string; score: number }[];
  topRules: { rule: string; count: number }[];
}

export const StatsService = {
  async dashboard(): Promise<DashboardStats> {
    const { data, error } = await supabase
      .from("audits")
      .select("id, score, created_at, issues(rule_id, severity_rule, severity_ml)")
      .order("created_at", { ascending: true });
    fail("Could not load dashboard statistics", error);

    const audits = (data ?? []) as unknown as {
      id: string;
      score: number;
      created_at: string;
      issues: Pick<Issue, "rule_id" | "severity_rule" | "severity_ml">[];
    }[];

    const allIssues = audits.flatMap((audit) => audit.issues ?? []);
    const ruleCounts = allIssues.reduce<Record<string, number>>((acc, issue) => {
      acc[issue.rule_id] = (acc[issue.rule_id] ?? 0) + 1;
      return acc;
    }, {});

    return {
      totalAudits: audits.length,
      averageScore: audits.length
        ? Math.round(audits.reduce((sum, audit) => sum + audit.score, 0) / audits.length)
        : 0,
      totalIssues: allIssues.length,
      bySeverity: countBySeverity(allIssues),
      trend: audits.map((audit) => ({ date: audit.created_at, score: audit.score })),
      topRules: Object.entries(ruleCounts)
        .map(([rule, count]) => ({ rule, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    };
  },
};

export const ReportService = {
  toJson(audit: AuditWithIssues): string {
    return JSON.stringify(
      {
        audit: {
          id: audit.id,
          created_at: audit.created_at,
          score: audit.score,
          element_count: audit.element_count,
          duration_ms: audit.duration_ms,
          project: audit.project?.name ?? null,
        },
        issues: audit.issues,
      },
      null,
      2,
    );
  },

  toCsv(audit: AuditWithIssues): string {
    const header = ["rule_id", "wcag_criterion", "level", "selector", "severity_rule", "severity_ml", "ml_confidence", "message"];
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = audit.issues.map((issue) =>
      [
        issue.rule_id,
        issue.wcag_criterion,
        issue.wcag_level,
        issue.selector,
        issue.severity_rule,
        issue.severity_ml ?? "",
        issue.ml_confidence?.toFixed(4) ?? "",
        issue.message,
      ]
        .map(escape)
        .join(","),
    );
    return [header.join(","), ...lines].join("\n");
  },

  /** Recompute the score from the stored issues — used by the built-in tests. */
  recomputeScore(audit: AuditWithIssues): number {
    return computeScore(audit.issues, audit.element_count);
  },

  severityOf,
};

export function downloadFile(name: string, content: string, type = "text/plain"): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
