import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { BarList, DonutBreakdown, TrendChart } from "@/components/charts";
import { Breadcrumbs, EmptyState, PageHeader, Panel, Stat } from "@/components/primitives";
import { AuditService, StatsService } from "@/lib/services";
import { useApp } from "@/lib/app-context";
import { ALL_MODEL_KINDS, MODEL_NAMES } from "@/lib/ml/engine";
import { RULE_INDEX } from "@/lib/audit/rules";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — AccessLens" },
      { name: "description", content: "Audit totals, average score, severity breakdown, score trend and model status." },
      { property: "og:title", content: "Dashboard — AccessLens" },
      { property: "og:description", content: "Live statistics computed from every audit stored in the database." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const router = useRouter();
  const { models, hydrated } = useApp();
  const [clearing, setClearing] = useState(false);
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => StatsService.dashboard() });

  const clearData = async () => {
    if (!window.confirm("Delete every audit, project, prediction log and saved example? This cannot be undone.")) return;
    setClearing(true);
    try {
      await AuditService.clearAll();
      await stats.refetch();
      toast.success("All stored audit data deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not clear the data.");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-8">
      <Breadcrumbs trail={[{ label: "Home", to: "/" }, { label: "Dashboard" }]} />
      <PageHeader
        eyebrow="Section 01"
        title="Dashboard"
        description="Every figure here is aggregated from the audits stored in the database."
        actions={
          <>
            <Link to="/audit" className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
              New audit
            </Link>
            <button
              type="button"
              onClick={() => void clearData()}
              disabled={clearing}
              className="rounded-sm border border-destructive px-4 py-2 text-sm text-destructive disabled:opacity-60"
            >
              {clearing ? "Clearing…" : "Clear data"}
            </button>
          </>
        }
      />

      {stats.isLoading ? <p className="text-sm text-muted-foreground">Loading statistics…</p> : null}
      {stats.isError ? (
        <p className="text-sm text-destructive">
          {stats.error instanceof Error ? stats.error.message : "Could not load statistics."}
        </p>
      ) : null}

      {stats.data ? (
        stats.data.totalAudits === 0 ? (
          <EmptyState
            title="No audits yet"
            description="Run your first audit — paste HTML, upload a file, or load one of the four bundled sample pages."
            action={
              <Link to="/audit" className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
                Run the first audit
              </Link>
            }
          />
        ) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Link to="/history" className="panel block p-5 hover:bg-muted">
                <Stat label="Audits stored" value={stats.data.totalAudits} hint="Open history" />
              </Link>
              <div className="panel p-5">
                <Stat label="Average score" value={`${stats.data.averageScore}/100`} hint="Weighted severity formula" />
              </div>
              <div className="panel p-5">
                <Stat label="Issues found" value={stats.data.totalIssues} hint="Across all audits" />
              </div>
              <Link to="/ml-lab" className="panel block p-5 hover:bg-muted">
                <Stat
                  label="Models trained"
                  value={`${Object.keys(models).length}/3`}
                  hint={hydrated ? "Open the ML Lab" : "Checking browser storage…"}
                />
              </Link>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel label="Severity" title="Issues by severity">
                <DonutBreakdown
                  items={[
                    { label: "critical", value: stats.data.bySeverity.critical, colour: "var(--critical)" },
                    { label: "serious", value: stats.data.bySeverity.serious, colour: "var(--serious)" },
                    { label: "moderate", value: stats.data.bySeverity.moderate, colour: "var(--moderate)" },
                    { label: "minor", value: stats.data.bySeverity.minor, colour: "var(--minor)" },
                  ]}
                />
                <p className="mt-4 text-xs text-muted-foreground">
                  Severity is the model's prediction where a model was trained, otherwise the rule's
                  own severity.
                </p>
              </Panel>

              <Panel label="Trend" title="Score over time">
                <TrendChart points={stats.data.trend} label="Accessibility score for each audit in order" />
              </Panel>
            </div>

            <Panel label="Rules" title="Most frequent findings">
              <BarList
                items={stats.data.topRules.map((row) => ({
                  label: RULE_INDEX[row.rule]?.title ?? row.rule,
                  value: row.count,
                }))}
              />
            </Panel>
          </>
        )
      ) : null}

      <div className="grid gap-5 md:grid-cols-3">
        {ALL_MODEL_KINDS.map((kind) => {
          const model = models[kind];
          return (
            <Link key={kind} to="/ml-lab" className="panel block p-5 hover:bg-muted">
              <p className="label-caps">{kind} model</p>
              <h2 className="mt-1 text-lg">{MODEL_NAMES[kind]}</h2>
              {model ? (
                <dl className="metric mt-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">val accuracy</dt>
                    <dd>{(model.metrics.accuracy * 100).toFixed(2)}%</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">macro F1</dt>
                    <dd>{model.metrics.macroF1.toFixed(3)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">trained</dt>
                    <dd>{new Date(model.trainedAt).toLocaleString()}</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Not trained in this browser yet — open the ML Lab to train it.
                </p>
              )}
            </Link>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => void router.invalidate()}
        className="rounded-sm border border-border px-4 py-2 text-sm hover:bg-muted"
      >
        Refresh page data
      </button>
    </div>
  );
}
