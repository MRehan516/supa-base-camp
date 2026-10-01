import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Breadcrumbs, EmptyState, PageHeader, Panel, SectionLabel, SeverityBadge } from "@/components/primitives";
import { RULE_INDEX } from "@/lib/audit/rules";
import { severityOf } from "@/lib/audit/scoring";
import { AuditService, RemediationService, downloadFile } from "@/lib/services";
import type { FixPlan } from "@/lib/audit/remediate";
import type { PipelineStage } from "@/lib/types";

export const Route = createFileRoute("/remediate/$id")({
  head: () => ({
    meta: [
      { title: "Fix issues — AccessLens" },
      { name: "description", content: "Review each generated fix, edit the suggested text, apply the selected fixes and re-audit the page." },
      { property: "og:title", content: "Fix issues — AccessLens" },
      { property: "og:description", content: "Every fix shows its before/after HTML, its evidence and its confidence." },
    ],
  }),
  component: Remediate,
});

function Remediate() {
  const { id } = useParams({ from: "/remediate/$id" });
  const navigate = useNavigate();
  const audit = useQuery({ queryKey: ["audit", id], queryFn: () => AuditService.get(id) });

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [stages, setStages] = useState<PipelineStage[]>([]);

  const fixes = useMemo<FixPlan[]>(() => {
    if (!audit.data) return [];
    const open = audit.data.issues.filter((issue) => issue.status !== "fixed");
    return RemediationService.generate(audit.data.html_source, open);
  }, [audit.data]);

  // Pre-select every confident fix once the plans exist.
  useEffect(() => {
    if (fixes.length === 0) return;
    setSelected(Object.fromEntries(fixes.map((fix) => [fix.issueId, !fix.needsReview])));
  }, [fixes]);

  const issueById = useMemo(
    () => Object.fromEntries((audit.data?.issues ?? []).map((issue) => [issue.id, issue])),
    [audit.data],
  );

  const chosen = fixes.filter((fix) => selected[fix.issueId]);

  const apply = async () => {
    if (!audit.data) return;
    if (chosen.length === 0) {
      toast.error("Select at least one fix to apply.");
      return;
    }
    setApplying(true);
    setStages([]);
    try {
      const result = await RemediationService.apply(audit.data, chosen, overrides, {
        onStage: (stage) => setStages((prev) => [...prev, stage]),
      });
      toast.success(
        `Applied ${chosen.length} fixes — score moved from ${audit.data.score} to ${result.remediated.score_after}.`,
      );
      void navigate({ to: "/compare/$id", params: { id: audit.data.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply the fixes.");
      setApplying(false);
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
  const unfixable = data.issues.filter(
    (issue) => issue.status !== "fixed" && !fixes.some((fix) => fix.issueId === issue.id),
  );

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
        description="Each fix below was derived from the real page: captions, nearby text, link targets and resolved colours. Edit anything before applying."
        actions={
          <>
            <button
              type="button"
              onClick={() => void apply()}
              disabled={applying || chosen.length === 0}
              className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {applying ? "Applying & re-auditing…" : `Apply ${chosen.length} selected & re-audit`}
            </button>
            <button
              type="button"
              onClick={() => setSelected(Object.fromEntries(fixes.map((fix) => [fix.issueId, true])))}
              className="rounded-sm border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setSelected({})}
              className="rounded-sm border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              Select none
            </button>
          </>
        }
      />

      {stages.length > 0 ? (
        <Panel label="Re-audit" title="Pipeline running on the fixed HTML">
          <ol className="metric space-y-1 text-xs" aria-live="polite">
            {stages.map((stage, index) => (
              <li key={`${stage.stage}-${index}`} className="flex gap-3">
                <span className="w-12 text-right text-muted-foreground">{stage.at}ms</span>
                <span className="w-20">{stage.label}</span>
                <span className="text-muted-foreground">{stage.detail}</span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      {fixes.length === 0 ? (
        <EmptyState
          title="No automatic fixes for this page"
          description="Either every finding is already fixed, or the remaining findings need a human decision (for example recording captions for a video)."
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
            return (
              <li key={fix.issueId} className="panel p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <input
                    id={`fix-${fix.issueId}`}
                    type="checkbox"
                    checked={Boolean(selected[fix.issueId])}
                    onChange={(event) =>
                      setSelected((prev) => ({ ...prev, [fix.issueId]: event.target.checked }))
                    }
                    className="mt-1.5 size-4"
                  />
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`fix-${fix.issueId}`} className="block text-base">
                      {meta?.title ?? issue?.rule_id ?? "Fix"}
                    </label>
                    <p className="metric mt-1 truncate text-xs text-muted-foreground">{fix.selector}</p>
                  </div>
                  {issue ? <SeverityBadge severity={severityOf(issue)} /> : null}
                  <span className="metric text-xs text-muted-foreground">
                    confidence {(fix.confidence * 100).toFixed(0)}%
                  </span>
                  {fix.needsReview ? (
                    <span className="metric rounded-sm bg-serious px-2 py-0.5 text-[0.6875rem] uppercase tracking-wider text-serious-foreground">
                      needs human review
                    </span>
                  ) : null}
                </div>

                <p className="mt-3 text-sm text-muted-foreground">{fix.explanation}</p>

                <div className="mt-4">
                  <label htmlFor={`value-${fix.issueId}`} className="label-caps block">
                    {fix.suggestionLabel}
                  </label>
                  <input
                    id={`value-${fix.issueId}`}
                    value={value}
                    onChange={(event) =>
                      setOverrides((prev) => ({ ...prev, [fix.issueId]: event.target.value }))
                    }
                    className="mt-2 w-full rounded-sm border border-input bg-background px-3 py-2 font-[family-name:var(--font-mono)] text-sm"
                  />
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <SectionLabel>Before</SectionLabel>
                    <pre className="mt-1 overflow-x-auto rounded-sm bg-muted p-3 font-[family-name:var(--font-mono)] text-xs">
                      {fix.before || "(whole document)"}
                    </pre>
                  </div>
                  <div>
                    <SectionLabel>After</SectionLabel>
                    <pre className="mt-1 overflow-x-auto rounded-sm bg-muted p-3 font-[family-name:var(--font-mono)] text-xs">
                      {fix.after.replace(fix.suggestion, value)}
                    </pre>
                  </div>
                </div>

                <p className="metric mt-3 text-xs text-muted-foreground">method: {fix.method}</p>
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
                <span>{RULE_INDEX[issue.rule_id]?.title ?? issue.rule_id}</span>
                <span className="metric text-xs text-muted-foreground">{issue.selector}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">
            These cannot be fixed safely by rewriting HTML — they need content decisions such as
            recording captions, rewriting a heading, or choosing which duplicate id to keep.
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
