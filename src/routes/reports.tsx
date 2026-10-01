import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { DonutBreakdown } from "@/components/charts";
import { Breadcrumbs, EmptyState, PageHeader, Panel, ScoreGauge, SeverityBadge, Stat } from "@/components/primitives";
import { RULE_INDEX } from "@/lib/audit/rules";
import { countBySeverity, severityOf } from "@/lib/audit/scoring";
import { AuditService, ReportService, downloadFile } from "@/lib/services";
import { SEVERITIES } from "@/lib/types";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — AccessLens" },
      { name: "description", content: "Build a printable WCAG report for any stored audit and export it as JSON or CSV." },
      { property: "og:title", content: "Reports — AccessLens" },
      { property: "og:description", content: "Printable findings report with the score recomputed from the stored issues." },
    ],
  }),
  component: Reports,
});

function Reports() {
  const audits = useQuery({ queryKey: ["audits"], queryFn: () => AuditService.list() });
  const [selected, setSelected] = useState<string>("");
  const detail = useQuery({
    queryKey: ["audit", selected],
    queryFn: () => AuditService.get(selected),
    enabled: Boolean(selected),
  });

  const data = detail.data;

  return (
    <div className="space-y-8">
      <Breadcrumbs trail={[{ label: "Home", to: "/" }, { label: "Reports" }]} />
      <PageHeader
        eyebrow="Section 09"
        title="Reports"
        description="Choose an audit to produce a report you can print or hand in. The score is recomputed from the stored issues as a cross-check."
        actions={
          data ? (
            <>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground"
              >
                Print report
              </button>
              <button
                type="button"
                onClick={() => downloadFile(`report-${data.id}.json`, ReportService.toJson(data), "application/json")}
                className="rounded-sm border border-border px-4 py-2 text-sm hover:bg-muted"
              >
                JSON
              </button>
              <button
                type="button"
                onClick={() => downloadFile(`report-${data.id}.csv`, ReportService.toCsv(data), "text/csv")}
                className="rounded-sm border border-border px-4 py-2 text-sm hover:bg-muted"
              >
                CSV
              </button>
            </>
          ) : null
        }
      />

      <Panel label="Select" title="Stored audits" className="print:hidden">
        {audits.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {audits.data && audits.data.length === 0 ? (
          <EmptyState
            title="No audits to report on"
            description="Run an audit first and it becomes available here."
            action={
              <Link to="/audit" className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
                Run an audit
              </Link>
            }
          />
        ) : null}
        {audits.data && audits.data.length > 0 ? (
          <div>
            <label htmlFor="report-audit" className="label-caps block">
              Audit
            </label>
            <select
              id="report-audit"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              className="mt-2 w-full max-w-xl rounded-sm border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Choose an audit…</option>
              {audits.data.map((row) => (
                <option key={row.id} value={row.id}>
                  {(row.project?.name ?? "Untitled page")} — {row.score}/100, {row.issue_count} issues,{" "}
                  {new Date(row.created_at ?? Date.now()).toLocaleString()}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </Panel>

      {data ? (
        <article className="space-y-8">
          <Panel label="Report" title={data.project?.name ?? "Audit report"}>
            <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
              <div className="flex flex-col items-center">
                <ScoreGauge score={data.score} />
                <button
                  type="button"
                  onClick={() => {
                    const recomputed = ReportService.recomputeScore(data);
                    toast[recomputed === data.score ? "success" : "error"](
                      recomputed === data.score
                        ? `Recomputed score matches the stored score (${recomputed}).`
                        : `Recomputed ${recomputed}, stored ${data.score}.`,
                    );
                  }}
                  className="mt-3 rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-muted print:hidden"
                >
                  Recompute score from stored issues
                </button>
              </div>
              <dl className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                <Stat label="Issues" value={data.issues.length} />
                <Stat label="Elements parsed" value={data.element_count} />
                <Stat label="Pipeline time" value={`${data.duration_ms} ms`} />
                <Stat label="Source" value={data.project?.source_type ?? "—"} />
                <Stat label="Audited" value={new Date(data.created_at ?? Date.now()).toLocaleDateString()} />
                <Stat
                  label="After fixes"
                  value={data.remediated ? `${data.remediated.score_after}/100` : "not remediated"}
                />
              </dl>
            </div>
          </Panel>

          <Panel label="Summary" title="Findings by severity">
            <DonutBreakdown
              items={SEVERITIES.map((severity) => ({
                label: severity,
                value: countBySeverity(data.issues)[severity],
                colour: `var(--${severity})`,
              }))}
            />
          </Panel>

          <Panel label="Detail" title="All findings">
            {data.issues.length === 0 ? (
              <p className="text-sm text-muted-foreground">No findings were recorded for this page.</p>
            ) : (
              <ol className="space-y-5">
                {data.issues.map((issue, index) => (
                  <li key={issue.id} className="rule-line border-b pb-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="section-number">{String(index + 1).padStart(2, "0")}</span>
                      <SeverityBadge severity={severityOf(issue)} />
                      <h3 className="text-base">{RULE_INDEX[issue.rule_id]?.title ?? issue.rule_id}</h3>
                      <span className="label-caps">{issue.wcag_criterion}</span>
                    </div>
                    <p className="metric mt-2 text-xs text-muted-foreground">{issue.selector}</p>
                    <p className="mt-2 text-sm">{issue.message}</p>
                    {RULE_INDEX[issue.rule_id] ? (
                      <p className="mt-1 text-sm text-muted-foreground">{RULE_INDEX[issue.rule_id]!.why}</p>
                    ) : null}
                    {issue.snippet ? (
                      <pre className="mt-2 overflow-x-auto rounded-sm bg-muted p-2 font-[family-name:var(--font-mono)] text-xs">
                        {issue.snippet}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel label="Method" title="How these numbers were produced">
            <p className="max-w-prose text-sm text-muted-foreground">
              Findings come from {Object.keys(RULE_INDEX).length} deterministic WCAG 2.1 rule checks run
              against the parsed document, plus contrast ratios computed from colours the browser
              resolved. Severity is the severity model's prediction where a model was trained at audit
              time, otherwise the rule's documented severity. The score formula is printed on the
              Methodology page.
            </p>
          </Panel>
        </article>
      ) : null}
    </div>
  );
}
