import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Breadcrumbs, EmptyState, PageHeader, Panel, SeverityBadge } from "@/components/primitives";
import { AuditService } from "@/lib/services";
import { scoreBand } from "@/lib/audit/scoring";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Audit history — AccessLens" },
      { name: "description", content: "Every stored audit with its score, issue count, source and timestamp." },
      { property: "og:title", content: "Audit history — AccessLens" },
      { property: "og:description", content: "Search, sort, reopen or delete any audit kept in the database." },
    ],
  }),
  component: History,
});

type SortKey = "created_at" | "score" | "issues";

function History() {
  const audits = useQuery({ queryKey: ["audits"], queryFn: () => AuditService.list() });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("created_at");
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = (audits.data ?? []).filter((row) =>
      search.trim() ? (row.project?.name ?? "").toLowerCase().includes(search.toLowerCase()) : true,
    );
    return [...list].sort((a, b) => {
      if (sort === "score") return b.score - a.score;
      if (sort === "issues") return b.issue_count - a.issue_count;
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });
  }, [audits.data, search, sort]);

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete the audit for "${name}" and all of its issues?`)) return;
    setBusy(id);
    try {
      await AuditService.remove(id);
      await audits.refetch();
      toast.success("Audit deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the audit.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-8">
      <Breadcrumbs trail={[{ label: "Home", to: "/" }, { label: "History" }]} />
      <PageHeader
        eyebrow="Section 06"
        title="Audit history"
        description="Audits are stored in the database, so they survive a page reload and are shared across tabs."
        actions={
          <Link to="/audit" className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
            New audit
          </Link>
        }
      />

      <Panel>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div>
            <label htmlFor="history-search" className="label-caps block">
              Search by page name
            </label>
            <input
              id="history-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="mt-2 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="history-sort" className="label-caps block">
              Sort by
            </label>
            <select
              id="history-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="mt-2 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="created_at">Newest first</option>
              <option value="score">Highest score</option>
              <option value="issues">Most issues</option>
            </select>
          </div>
        </div>

        {audits.isLoading ? <p className="mt-6 text-sm text-muted-foreground">Loading audits…</p> : null}
        {audits.isError ? (
          <p className="mt-6 text-sm text-destructive">
            {audits.error instanceof Error ? audits.error.message : "Could not load the history."}
          </p>
        ) : null}

        {audits.data && rows.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title={audits.data.length === 0 ? "No audits stored yet" : "Nothing matches that search"}
              description={
                audits.data.length === 0
                  ? "Run an audit and it will appear here with its score and findings."
                  : "Try a different page name."
              }
              action={
                <Link to="/audit" className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
                  Run an audit
                </Link>
              }
            />
          </div>
        ) : null}

        {rows.length > 0 ? (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="label-caps mb-2 text-left">{rows.length} stored audits</caption>
              <thead>
                <tr className="rule-line border-b text-left">
                  <th scope="col" className="py-2 pr-4">Page</th>
                  <th scope="col" className="py-2 pr-4">Score</th>
                  <th scope="col" className="py-2 pr-4">Issues</th>
                  <th scope="col" className="py-2 pr-4">Elements</th>
                  <th scope="col" className="py-2 pr-4">Source</th>
                  <th scope="col" className="py-2 pr-4">When</th>
                  <th scope="col" className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const band = scoreBand(row.score);
                  return (
                    <tr key={row.id} className="border-b border-border align-top">
                      <td className="py-3 pr-4">
                        <Link to="/audit/$id" params={{ id: row.id }} className="underline underline-offset-4">
                          {row.project?.name ?? "Untitled page"}
                        </Link>
                      </td>
                      <td className="metric py-3 pr-4">
                        {row.score}
                        <span className="ml-2 text-xs text-muted-foreground">{band.label}</span>
                      </td>
                      <td className="metric py-3 pr-4">{row.issue_count}</td>
                      <td className="metric py-3 pr-4">{row.element_count}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{row.project?.source_type ?? "—"}</td>
                      <td className="metric py-3 pr-4 text-xs text-muted-foreground">
                        {new Date(row.created_at ?? Date.now()).toLocaleString()}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            to="/remediate/$id"
                            params={{ id: row.id }}
                            className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted"
                          >
                            Fix
                          </Link>
                          <button
                            type="button"
                            onClick={() => void remove(row.id, row.project?.name ?? "Untitled page")}
                            disabled={busy === row.id}
                            className="rounded-sm border border-destructive px-2 py-1 text-xs text-destructive disabled:opacity-60"
                          >
                            {busy === row.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>

      <p className="text-xs text-muted-foreground">
        Severity shown inside an audit uses the model's prediction when a model was trained at audit
        time. <SeverityBadge severity="critical" /> findings are always listed first in the export.
      </p>
    </div>
  );
}
