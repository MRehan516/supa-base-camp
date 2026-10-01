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
import type { Audit, AuditWithIssues, Issue, RemediatedPage, Severity } from "./types";
import { runPipeline, type PipelineOptions } from "./audit/pipeline";
import { applyFixes, generateFixes, type FixPlan } from "./audit/remediate";
import { computeScore, countBySeverity, severityOf } from "./audit/scoring";
import {
  MODEL_NAMES,
  type ModelKind,
  type ModelMetrics,
  type TrainedModel,
  predictText,
  trainAltModel,
  trainLinkModel,
  trainSeverityModel,
  type EpochPoint,
} from "./ml/engine";

function fail(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

let traceSink: ((line: string) => void) | null = null;
/** Verification mode: every database write and model call is echoed here. */
export function setTraceSink(sink: ((line: string) => void) | null): void {
  traceSink = sink;
}
function trace(line: string): void {
  traceSink?.(line);
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
    if (!html.trim()) throw new Error("There is no HTML to audit.");

    const result = await runPipeline(html, {
      ...options,
      onTrace: (line) => {
        trace(line);
        options.onTrace?.(line);
      },
    });

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({ name: projectName || "Untitled page", source_type: sourceType })
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

      const logs = result.issues
        .filter((issue) => issue.ml_detail?.severityProbs)
        .map((issue) => ({
          model_kind: "severity",
          audit_id: audit!.id,
          input_text: `${issue.rule_id} @ ${issue.selector}`,
          probabilities: issue.ml_detail!.severityProbs,
          predicted_label: issue.severity_ml ?? "",
        }));
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
      .select("*, projects(id, name, source_type), issues(*), remediated_pages(*)")
      .eq("id", id)
      .maybeSingle();
    fail("Could not load the audit", error);
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const remediated = ((row.remediated_pages as RemediatedPage[]) ?? []).sort(
      (a, b) => (a.created_at < b.created_at ? 1 : -1),
    );
    return {
      ...(row as unknown as Audit),
      issues: ((row.issues as Issue[]) ?? []).sort((a, b) =>
        a.rule_id === b.rule_id ? a.selector.localeCompare(b.selector) : a.rule_id.localeCompare(b.rule_id),
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

export const RemediationService = {
  generate(html: string, issues: Issue[]): FixPlan[] {
    return generateFixes(html, issues);
  },

  /** Apply the selected fixes, re-audit the fixed HTML and store both. */
  async apply(
    audit: AuditWithIssues,
    fixes: FixPlan[],
    overrides: Record<string, string>,
    options: PipelineOptions = {},
  ): Promise<{ remediated: RemediatedPage; html: string }> {
    if (!fixes.length) throw new Error("Select at least one fix to apply.");
    const { html, applied, failed } = applyFixes(audit.html_source, fixes, overrides);
    trace(`remediation: ${applied.length} applied, ${failed.length} could not be applied`);

    const reaudit = await runPipeline(html, options);

    const { data, error } = await supabase
      .from("remediated_pages")
      .insert({
        audit_id: audit.id,
        html_fixed: html,
        score_after: reaudit.score,
        issues_after: reaudit.issues.length,
      })
      .select("*")
      .single();
    fail("Could not save the remediated page", error);
    trace(`db.insert remediated_pages → ${data!.id}`);

    if (applied.length) {
      const rows = applied.map((fix) => ({
        issue_id: fix.issueId,
        before_html: fix.before,
        after_html: fix.after,
        method: fix.method,
        confidence: fix.confidence,
        applied: true,
      }));
      const { error: fixError } = await supabase.from("fixes").insert(rows);
      fail("Could not save the fixes", fixError);
      trace(`db.insert fixes → ${rows.length} rows`);

      const ids = applied.map((fix) => fix.issueId);
      const { error: statusError } = await supabase.from("issues").update({ status: "fixed" }).in("id", ids);
      fail("Could not update issue status", statusError);
    }

    return { remediated: data as RemediatedPage, html };
  },
};

// ---------------------------------------------------------------------------
// ML
// ---------------------------------------------------------------------------

export const MlService = {
  async train(kind: ModelKind, onEpoch?: (point: EpochPoint) => void): Promise<TrainedModel> {
    trace(`ml.train ${kind} started`);
    const model =
      kind === "alt"
        ? await trainAltModel(onEpoch)
        : kind === "link"
          ? await trainLinkModel(onEpoch)
          : await trainSeverityModel(onEpoch);
    await MlService.record(model);
    trace(`ml.train ${kind} finished — val accuracy ${(model.metrics.accuracy * 100).toFixed(2)}%`);
    return model;
  },

  async record(model: TrainedModel): Promise<void> {
    const { data, error } = await supabase
      .from("ml_models")
      .insert({
        name: MODEL_NAMES[model.kind],
        kind: model.kind,
        version: `v${model.metrics.epochs}-${model.metrics.featureDim}`,
        metrics: model.metrics as never,
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
