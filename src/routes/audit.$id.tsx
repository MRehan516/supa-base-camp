import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { DonutBreakdown } from "@/components/charts";
import {
  Breadcrumbs,
  EmptyState,
  PageHeader,
  Panel,
  ProbabilityBars,
  ScoreGauge,
  SectionLabel,
  SeverityBadge,
  Stat,
} from "@/components/primitives";
import { RULE_INDEX } from "@/lib/audit/rules";
import { countBySeverity, scoreBand, severityOf } from "@/lib/audit/scoring";
import { AuditService, ReportService, downloadFile } from "@/lib/services";
import { SEVERITIES, type Issue, type Severity } from "@/lib/types";
import { SEVERITY_CLASSES } from "@/lib/ml/engine";

export const Route = createFileRoute("/audit/$id")({
  head: () => ({
    meta: [
      { title: "Audit results — AccessLens" },
      { name: "description", content: "Score, severity breakdown and every WCAG finding with its rule evidence and model probabilities." },
      { property: "og:title", content: "Audit results — AccessLens" },
      { property: "og:description", content: "Each finding shows its snippet, WCAG criterion and the model's raw output." },
    ],
  }),
  component: AuditResults,
});

function AuditResults() {
  const { id } = useParams({ from: "/audit/$id" });
  const audit = useQuery({ queryKey: ["audit", id], queryFn: () => AuditService.get(id) });

  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [level, setLevel] = useState<string>("all");
  const [rule, setRule] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const issues = audit.data?.issues ?? [];
  const filtered = useMemo(
    () =>
      issues.filter((issue) => {
        if (severity !== "all" && severityOf(issue) !== severity) return false;
        if (level !== "all" && issue.wcag_level !== level) return false;
        if (rule !== "all" && issue.rule_id !== rule) return false;
        if (status !== "all" && issue.status !== status) return false;
        if (search.trim()) {
          const needle = search.toLowerCase();
          const hay = `${issue.rule_id} ${issue.selector} ${issue.message} ${issue.snippet}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      }),
    [issues, severity, level, rule, status, search],
  );

  if (audit.isLoading) return <p className="text-sm text-muted-foreground">Loading the audit…</p>;
  if (audit.isError)
    return (
      <p className="text-sm text-destructive">
        {audit.error instanceof Error ? audit.error.message : "Could not load this audit."}
      </p>
    );
  if (!audit.data)
    return (
      <EmptyState
        title="That audit no longer exists"
        description="It may have been deleted from the history page."
        action={
          <Link to="/audit" className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
            Run a new audit
          </Link>
        }
      />
    );

  const data = audit.data;
  const counts = countBySeverity(issues);
  const band = scoreBand(data.score);
  const ruleIds = Array.from(new Set(issues.map((issue) => issue.rule_id))).sort();

  return (
    <div className="space-y-8">
      <Breadcrumbs
        trail={[{ label: "Home", to: "/" }, { label: "History", to: "/history" }, { label: data.project?.name ?? "Audit" }]}
      />
      <PageHeader
        eyebrow="Section 03"
        title={data.project?.name ?? "Audit results"}
        description={`Audited ${new Date(data.created_at ?? Date.now()).toLocaleString()} · ${data.element_count.toLocaleString()} elements parsed · pipeline took ${data.duration_ms} ms.`}
        actions={
          <>
            <Link
              to="/remediate/$id"
              params={{ id: data.id }}
              className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              Fix issues
            </Link>
            <button
              type="button"
              onClick={() => downloadFile(`audit-${data.id}.json`, ReportService.toJson(data), "application/json")}
              className="rounded-sm border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              Export JSON
            </button>
            <button
              type="button"
              onClick={() => downloadFile(`audit-${data.id}.csv`, ReportService.toCsv(data), "text/csv")}
              className="rounded-sm border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              Export CSV
            </button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[auto_1fr_1fr]">
        <Panel label="Score" className="flex flex-col items-center">
          <ScoreGauge score={data.score} />
          <p className="mt-2 text-sm">{band.label}</p>
          {data.remediated ? (
            <Link
              to="/compare/$id"
              params={{ id: data.id }}
              className="mt-3 text-sm underline underline-offset-4"
            >
              Compare with the fixed version ({data.remediated.score_after}/100)
            </Link>
          ) : null}
        </Panel>
        <Panel label="Severity" title="Breakdown">
          <DonutBreakdown
            items={SEVERITIES.map((item) => ({
              label: item,
              value: counts[item],
              colour: `var(--${item})`,
            }))}
          />
        </Panel>
        <Panel label="Summary">
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Issues" value={issues.length} />
            <Stat label="Elements" value={data.element_count} />
            <Stat label="Rules triggered" value={ruleIds.length} />
            <Stat
              label="Model-ranked"
              value={issues.filter((issue) => issue.severity_ml).length}
              hint="Severity from the model"
            />
          </div>
        </Panel>
      </div>

      <Panel label="Findings" title={`${filtered.length} of ${issues.length} findings shown`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Filter label="Severity" value={severity} onChange={(value) => setSeverity(value as Severity | "all")} options={["all", ...SEVERITIES]} />
          <Filter label="WCAG level" value={level} onChange={setLevel} options={["all", "A", "AA", "AAA"]} />
          <Filter label="Rule" value={rule} onChange={setRule} options={["all", ...ruleIds]} />
          <Filter label="Status" value={status} onChange={setStatus} options={["all", "open", "fixed"]} />
          <div>
            <label htmlFor="issue-search" className="label-caps block">
              Search
            </label>
            <input
              id="issue-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="selector, message…"
              className="mt-2 w-full rounded-sm border border-input bg-background px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            {issues.length === 0
              ? "No issues were found on this page — the rule checks all passed."
              : "No findings match these filters."}
          </p>
        ) : (
          <ul className="mt-6 divide-y divide-border">
            {filtered.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                expanded={open === issue.id}
                onToggle={() => setOpen(open === issue.id ? null : issue.id)}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  const id = `filter-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div>
      <label htmlFor={id} className="label-caps block">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-sm border border-input bg-background px-2 py-1.5 text-sm"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function IssueRow({ issue, expanded, onToggle }: { issue: Issue; expanded: boolean; onToggle: () => void }) {
  const meta = RULE_INDEX[issue.rule_id];
  const severity = severityOf(issue);
  return (
    <li className="py-4">
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-start gap-4 text-left">
        <SeverityBadge severity={severity} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="block text-base">{meta?.title ?? issue.rule_id}</span>
          <span className="metric mt-1 block truncate text-xs text-muted-foreground">{issue.selector}</span>
        </span>
        <span className="label-caps shrink-0">
          {issue.wcag_level} · {issue.status}
        </span>
        <span aria-hidden="true" className="shrink-0 text-muted-foreground">
          {expanded ? "–" : "+"}
        </span>
      </button>

      {expanded ? (
        <div className="mt-4 grid gap-5 pl-0 sm:pl-[4.5rem] lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <SectionLabel>WCAG criterion</SectionLabel>
              <p className="mt-1 text-sm">{issue.wcag_criterion}</p>
            </div>
            <div>
              <SectionLabel>What the rule found</SectionLabel>
              <p className="mt-1 text-sm">{issue.message}</p>
            </div>
            {meta ? (
              <div>
                <SectionLabel>Why it matters</SectionLabel>
                <p className="mt-1 text-sm text-muted-foreground">{meta.why}</p>
              </div>
            ) : null}
            <div>
              <SectionLabel>Snippet</SectionLabel>
              <pre className="mt-1 overflow-x-auto rounded-sm bg-muted p-3 font-[family-name:var(--font-mono)] text-xs">
                {issue.snippet || "(element not serialisable)"}
              </pre>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-6">
              <div>
                <SectionLabel>Rule severity</SectionLabel>
                <p className="mt-1">
                  <SeverityBadge severity={issue.severity_rule} />
                </p>
              </div>
              <div>
                <SectionLabel>Model severity</SectionLabel>
                <p className="mt-1">
                  {issue.severity_ml ? (
                    <SeverityBadge severity={issue.severity_ml} />
                  ) : (
                    <span className="text-sm text-muted-foreground">model not available at audit time</span>
                  )}
                </p>
              </div>
              {issue.ml_confidence != null ? (
                <div>
                  <SectionLabel>Confidence</SectionLabel>
                  <p className="metric mt-1 text-sm">{(issue.ml_confidence * 100).toFixed(2)}%</p>
                </div>
              ) : null}
            </div>

            {issue.ml_detail?.severityProbs ? (
              <div>
                <SectionLabel>Severity probabilities (raw output)</SectionLabel>
                <div className="mt-2">
                  <ProbabilityBars
                    classes={SEVERITY_CLASSES}
                    probabilities={issue.ml_detail.severityProbs}
                    highlight={issue.severity_ml ?? undefined}
                  />
                </div>
              </div>
            ) : null}

            {issue.ml_detail?.altProbs ? (
              <div>
                <SectionLabel>Alt-text model ({issue.ml_detail.altLabel})</SectionLabel>
                <div className="mt-2">
                  <ProbabilityBars
                    classes={["missing_info", "poor", "good", "decorative_ok"]}
                    probabilities={issue.ml_detail.altProbs}
                    highlight={issue.ml_detail.altLabel}
                  />
                </div>
              </div>
            ) : null}

            {issue.ml_detail?.linkProbs ? (
              <div>
                <SectionLabel>Link-text model ({issue.ml_detail.linkLabel})</SectionLabel>
                <div className="mt-2">
                  <ProbabilityBars
                    classes={["vague", "descriptive"]}
                    probabilities={issue.ml_detail.linkProbs}
                    highlight={issue.ml_detail.linkLabel}
                  />
                </div>
              </div>
            ) : null}

            {issue.ml_detail?.severityFeatures ? (
              <div>
                <SectionLabel>Features fed to the severity model</SectionLabel>
                <dl className="metric mt-2 grid grid-cols-2 gap-1 text-xs">
                  {Object.entries(issue.ml_detail.severityFeatures).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-2 border-b border-border py-1">
                      <dt className="text-muted-foreground">{key}</dt>
                      <dd>{typeof value === "number" ? value.toFixed(3) : String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}
