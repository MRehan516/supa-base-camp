import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Breadcrumbs, EmptyState, PageHeader, Panel, SectionLabel, SeverityBadge } from "@/components/primitives";
import { RULE_INDEX } from "@/lib/audit/rules";
import { severityOf } from "@/lib/audit/scoring";
import { AuditService, RemediationService, downloadFile, type FixOutcome } from "@/lib/services";
import type { FixPlan } from "@/lib/audit/remediate";
import type { Issue, PipelineStage } from "@/lib/types";

export const Route = createFileRoute("/remediate/$id")({
  head: () => ({
    meta: [
      { title: "Fix issues — AccessLens" },
      { name: "description", content: "Review each generated fix: apply, edit, reject or mark reviewed, then verify it with a real re-audit." },
      { property: "og:title", content: "Fix issues — AccessLens" },
      { property: "og:description", content: "Predicted fix success next to the actual re-audit verification." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Remediate,
});

type Decision = "apply" | "reject" | "undecided";

const VERIFY_LABEL: Record<FixOutcome["verification"], string> = {
  resolved: "Resolved",
  not_resolved: "Not resolved",
  partially_resolved: "Partially resolved",
};

function Remediate() {
  const { id } = useParams({ from: "/remediate/$id" });
  const queryClient = useQueryClient();
  const audit = useQuery({ queryKey: ["audit", id], queryFn: () => AuditService.get(id) });

  const [decision, setDecision] = useState<Record<string, Decision>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [predictions, setPredictions] = useState<Record<string, number | null>>({});
  const [applying, setApplying] = useState(false);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [outcomes, setOutcomes] = useState<FixOutcome[] | null>(null);

  const actionable = (issue: Issue) => !["verified", "rejected"].includes(issue.status);

  const fixes = useMemo<FixPlan[]>(() => {
    if (!audit.data) return [];
    return RemediationService.generate(audit.data.html_source, audit.data.issues.filter(actionable));
  }, [audit.data]);

  const issueById = useMemo(
    () => Object.fromEntries((audit.data?.issues ?? []).map((issue) => [issue.id, issue])) as Record<string, Issue>,
    [audit.data],
  );

  useEffect(() => {
    if (fixes.length === 0) return;
    setDecision(Object.fromEntries(fixes.map((fix) => [fix.issueId, fix.needsReview ? "undecided" : "apply"])));
  }, [fixes]);

  // Fix-success model predictions; recomputed when a suggestion is edited.
  useEffect(() => {
    if (!fixes.length) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void RemediationService.predict(fixes, issueById, overrides).then((p) => {
        if (!cancelled) setPredictions(p);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fixes, issueById, overrides]);

  const chosen = fixes.filter((fix) => decision[fix.issueId] === "apply");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["audit", id] });

  const apply = async () => {
    if (!audit.data || chosen.length === 0) {
      toast.error("Mark at least one fix as Apply.");
      return;
    }
    setApplying(true);
    setStages([]);
    try {
      const result = await RemediationService.apply(audit.data, chosen, overrides, predictions, {
        onStage: (stage) => setStages((prev) => [...prev, stage]),
      });
      setOutcomes(result.outcomes);
      const resolved = result.outcomes.filter((o) => o.verification === "resolved").length;
      toast.success(`Re-audit finished: ${resolved} of ${result.outcomes.length} fixes verified as resolved.`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply the fixes.");
    } finally {
      setApplying(false);
    }
  };

  const reject = async (fix: FixPlan) => {
    const issue = issueById[fix.issueId];
    if (!issue) return;
    try {
      await RemediationService.reject(issue, fix);
      toast.success("Fix rejected and recorded.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reject the fix.");
    }
  };

  const markReviewed = async (issueId: string) => {
    try {
      await RemediationService.markReviewed(issueId);
      toast.success("Marked as reviewed.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the issue.");
    }
  };

  if (audit.isLoading) return <p className="text-sm text-muted-foreground">Loading the audit…</p>;
  if (!audit.data)
    return (
      <EmptyState
        title="That audit no longer exists"
        description="Run a new audit to generate fixes."
        action={
          <Link to="/audit" className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
            New audit
          </Link>
        }
      />
    );

  const data = audit.data;
  const unfixable = data.issues.filter((issue) => actionable(issue) && !fixes.some((fix) => fix.issueId === issue.id));

  return (
    <div className="space-y-8">
      <Breadcrumbs
        trail={[
          { label: "Home", to: "/" },
          { label: "History", to: "/history" },
          { label: data.project?.name ?? "Audit", to: "/history" },
          { label: "Fix issues" },
        ]}
      />
      <PageHeader
        eyebrow="Section 04"
        title="Fix issues"
        description="Decide on each fix, then AccessLens builds the remediated HTML and re-runs the real audit. Only the re-audit decides whether a fix worked — the model's prediction is shown for comparison."
        actions={
          <>
            <button
              type="button"
              onClick={() => void apply()}
              disabled={applying || chosen.length === 0}
              className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {applying ? "Applying & re-auditing…" : `Apply ${chosen.length} & re-audit`}
            </button>
            {data.remediated ? (
              <Link to="/compare/$id" params={{ id: data.id }} className="rounded-sm border border-border px-4 py-2 text-sm hover:bg-muted">
                Before / after
              </Link>
            ) : null}
          </>
        }
      />

      {stages.length > 0 ? (
        <Panel label="Re-audit" title="Pipeline running on the remediated HTML">
          <ol className="metric space-y-1 text-xs" aria-live="polite">
            {stages.map((stage, index) => (
              <li key={`${stage.stage}-${index}`} className="flex gap-3">
                <span className="w-12 text-right text-muted-foreground">{stage.at}ms</span>
                <span className="w-24">{stage.label}</span>
                <span className="text-muted-foreground">{stage.detail}</span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      {outcomes ? (
        <Panel label="Verification" title="Predicted vs actual, per fix">
          <div className="overflow-x-auto">
            <table className="metric w-full text-xs">
              <thead>
                <tr className="rule-line border-b text-left">
                  <th scope="col" className="py-2 pr-3">issue</th>
                  <th scope="col" className="py-2 pr-3">predicted</th>
                  <th scope="col" className="py-2 pr-3">actual (re-audit)</th>
                  <th scope="col" className="py-2">detail</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((o) => (
                  <tr key={o.issueId} className="border-b border-border align-top">
                    <td className="py-2 pr-3">{issueById[o.issueId]?.issue_code || o.ruleId}</td>
                    <td className="py-2 pr-3">
                      {o.predicted === null ? "no prediction" : `${o.predicted >= 0.5 ? "Likely to resolve" : "Unlikely to resolve"} (${(o.predicted * 100).toFixed(1)}%)`}
                    </td>
                    <td className={`py-2 pr-3 ${o.verification === "resolved" ? "text-pass" : o.verification === "not_resolved" ? "text-destructive" : ""}`}>
                      {VERIFY_LABEL[o.verification]}
                    </td>
                    <td className="py-2 text-muted-foreground">{o.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link to="/compare/$id" params={{ id: data.id }} className="mt-4 inline-block text-sm underline underline-offset-4">
            Open the before/after comparison
          </Link>
        </Panel>
      ) : null}

      {fixes.length === 0 ? (
        <EmptyState
          title="No open automatic fixes"
          description="Every fixable finding is verified or rejected, or the remaining findings need a human decision."
          action={
            <Link to="/audit/$id" params={{ id: data.id }} className="rounded-sm border border-border px-4 py-2 text-sm">
              Back to results
            </Link>
          }
        />
      ) : (
        <ul className="space-y-5">
          {fixes.map((fix) => {
            const issue = issueById[fix.issueId];
            const meta = issue ? RULE_INDEX[issue.rule_id] : undefined;
            const value = overrides[fix.issueId] ?? fix.suggestion;
            const choice = decision[fix.issueId] ?? "undecided";
            const predicted = predictions[fix.issueId];
            const set = (d: Decision) => setDecision((prev) => ({ ...prev, [fix.issueId]: d }));
            return (
              <li key={fix.issueId} className="panel p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="metric text-xs text-muted-foreground">{issue?.issue_code || "—"} · {issue?.status}</p>
                    <h2 className="text-base">{meta?.title ?? issue?.rule_id ?? "Fix"}</h2>
                    <p className="metric mt-1 truncate text-xs text-muted-foreground">{fix.selector}</p>
                  </div>
                  {issue ? <SeverityBadge severity={severityOf(issue)} /> : null}
                  {fix.needsReview ? (
                    <span className="metric rounded-sm bg-serious px-2 py-0.5 text-[0.6875rem] uppercase tracking-wider text-serious-foreground">
                      needs human review
                    </span>
                  ) : null}
                  {issue?.reviewed_at ? <span className="label-caps">reviewed</span> : null}
                </div>

                <p className="mt-3 text-sm text-muted-foreground">{fix.explanation}</p>

                <dl className="metric mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div className="flex justify-between gap-2 border-b border-border py-1">
                    <dt className="text-muted-foreground">heuristic confidence (rule-based)</dt>
                    <dd>{(fix.confidence * 100).toFixed(0)}%</dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-border py-1">
                    <dt className="text-muted-foreground">fix-success model</dt>
                    <dd>
                      {predicted === undefined
                        ? "…"
                        : predicted === null
                          ? "no prediction (model untrained or rule not covered)"
                          : `${predicted >= 0.5 ? "Likely to resolve" : "Unlikely to resolve"} · ${(predicted * 100).toFixed(1)}%`}
                    </dd>
                  </div>
                </dl>

                {editing[fix.issueId] ? (
                  <div className="mt-4">
                    <label htmlFor={`value-${fix.issueId}`} className="label-caps block">
                      {fix.suggestionLabel}
                    </label>
                    <input
                      id={`value-${fix.issueId}`}
                      value={value}
                      maxLength={500}
                      onChange={(event) => setOverrides((prev) => ({ ...prev, [fix.issueId]: event.target.value }))}
                      className="mt-2 w-full rounded-sm border border-input bg-background px-3 py-2 font-[family-name:var(--font-mono)] text-sm"
                    />
                  </div>
                ) : null}

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <SectionLabel>Original code</SectionLabel>
                    <pre className="mt-1 overflow-x-auto rounded-sm bg-muted p-3 font-[family-name:var(--font-mono)] text-xs">
                      {fix.before || "(whole document)"}
                    </pre>
                  </div>
                  <div>
                    <SectionLabel>Proposed replacement</SectionLabel>
                    <pre className="mt-1 overflow-x-auto rounded-sm bg-muted p-3 font-[family-name:var(--font-mono)] text-xs">
                      {fix.suggestion ? fix.after.split(fix.suggestion).join(value) : fix.after}
                    </pre>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label={`Decision for ${issue?.issue_code ?? "fix"}`}>
                  <button type="button" aria-pressed={choice === "apply"} onClick={() => set(choice === "apply" ? "undecided" : "apply")}
                    className={choice === "apply" ? "rounded-sm bg-primary px-3 py-1.5 text-xs text-primary-foreground" : "rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-muted"}>
                    {choice === "apply" ? "✓ Apply fix" : "Apply fix"}
                  </button>
                  <button type="button" aria-pressed={Boolean(editing[fix.issueId])} onClick={() => setEditing((prev) => ({ ...prev, [fix.issueId]: !prev[fix.issueId] }))}
                    className="rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-muted">
                    {editing[fix.issueId] ? "Done editing" : "Edit fix"}
                  </button>
                  <button type="button" onClick={() => void reject(fix)} className="rounded-sm border border-destructive px-3 py-1.5 text-xs text-destructive">
                    Reject fix
                  </button>
                  <button type="button" onClick={() => void markReviewed(fix.issueId)} disabled={Boolean(issue?.reviewed_at)}
                    className="rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
                    {issue?.reviewed_at ? "Reviewed" : "Mark reviewed"}
                  </button>
                  <span className="metric ml-auto text-xs text-muted-foreground">method: {fix.method}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {unfixable.length > 0 ? (
        <Panel label="Not automatable" title={`${unfixable.length} findings need a person`}>
          <ul className="space-y-2 text-sm">
            {unfixable.map((issue) => (
              <li key={issue.id} className="flex flex-wrap items-center gap-3">
                <SeverityBadge severity={severityOf(issue)} />
                <span className="metric text-xs">{issue.issue_code}</span>
                <span>{RULE_INDEX[issue.rule_id]?.title ?? issue.rule_id}</span>
                <span className="metric text-xs text-muted-foreground">{issue.selector}</span>
                <button type="button" onClick={() => void markReviewed(issue.id)} disabled={Boolean(issue.reviewed_at)} className="rounded-sm border border-border px-2 py-1 text-xs disabled:opacity-50">
                  {issue.reviewed_at ? "Reviewed" : "Mark reviewed"}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">
            These cannot be fixed safely by rewriting HTML — they need content decisions such as recording
            captions, adding keyboard handlers, or choosing which duplicate id to keep.
          </p>
        </Panel>
      ) : null}

      <button
        type="button"
        onClick={() => downloadFile(`original-${data.id}.html`, data.html_source, "text/html")}
        className="rounded-sm border border-border px-4 py-2 text-sm hover:bg-muted"
      >
        Download the original HTML
      </button>
    </div>
  );
}
