import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Breadcrumbs, EmptyState, PageHeader, Panel, ScoreGauge, Stat } from "@/components/primitives";
import { AuditService, downloadFile } from "@/lib/services";

export const Route = createFileRoute("/compare/$id")({
  head: () => ({
    meta: [
      { title: "Before vs after — AccessLens" },
      { name: "description", content: "Compare the original page with the remediated page: score change, remaining issues, HTML diff and live previews." },
      { property: "og:title", content: "Before vs after — AccessLens" },
      { property: "og:description", content: "The improvement is measured by re-running the identical audit pipeline." },
    ],
  }),
  component: Compare,
});

function Compare() {
  const { id } = useParams({ from: "/compare/$id" });
  const audit = useQuery({ queryKey: ["audit", id], queryFn: () => AuditService.get(id) });
  const [view, setView] = useState<"code" | "preview">("code");

  if (audit.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!audit.data || !audit.data.remediated)
    return (
      <EmptyState
        title="Nothing to compare yet"
        description="Apply at least one fix to this audit and the before/after comparison will appear here."
        action={
          <Link to="/remediate/$id" params={{ id }} className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
            Generate fixes
          </Link>
        }
      />
    );

  const data = audit.data;
  const after = data.remediated!;
  const delta = after.score_after - data.score;
  const issuesBefore = data.issues.length;
  const removed = issuesBefore - after.issues_after;

  return (
    <div className="space-y-8">
      <Breadcrumbs
        trail={[
          { label: "Home", to: "/" },
          { label: "History", to: "/history" },
          { label: data.project?.name ?? "Audit" },
          { label: "Before vs after" },
        ]}
      />
      <PageHeader
        eyebrow="Section 05"
        title="Before vs after"
        description="The fixed HTML was put through the identical pipeline, so these two scores are directly comparable."
        actions={
          <>
            <button
              type="button"
              onClick={() => downloadFile(`fixed-${data.id}.html`, after.html_fixed, "text/html")}
              className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              Download fixed HTML
            </button>
            <Link
              to="/audit/$id"
              params={{ id: data.id }}
              className="rounded-sm border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              Back to findings
            </Link>
          </>
        }
      />

      <div className="grid gap-5 md:grid-cols-4">
        <Panel label="Before" className="flex flex-col items-center">
          <ScoreGauge score={data.score} size={140} />
        </Panel>
        <Panel label="After" className="flex flex-col items-center">
          <ScoreGauge score={after.score_after} size={140} />
        </Panel>
        <Panel label="Change">
          <Stat
            label="Score change"
            value={`${delta >= 0 ? "+" : ""}${delta}`}
            hint={delta > 0 ? "Measured improvement" : delta === 0 ? "No measured change" : "The score went down"}
          />
          <div className="mt-4">
            <Stat label="Issues removed" value={removed} hint={`${issuesBefore} → ${after.issues_after}`} />
          </div>
        </Panel>
        <Panel label="Timing">
          <Stat label="Fixed at" value={new Date(after.created_at).toLocaleTimeString()} />
          <div className="mt-4">
            <Stat label="Remaining issues" value={after.issues_after} hint="Found by the re-audit" />
          </div>
        </Panel>
      </div>

      <Panel
        label="Comparison"
        title={view === "code" ? "HTML side by side" : "Rendered previews"}
        actions={
          <div role="tablist" aria-label="Comparison view" className="flex gap-1">
            {(
              [
                { id: "code", label: "HTML" },
                { id: "preview", label: "Preview" },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                role="tab"
                type="button"
                aria-selected={view === item.id}
                onClick={() => setView(item.id)}
                className={
                  view === item.id
                    ? "rounded-sm bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                    : "rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-muted"
                }
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      >
        {view === "code" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="label-caps">Original</p>
              <pre className="mt-2 max-h-[28rem] overflow-auto rounded-sm bg-muted p-3 font-[family-name:var(--font-mono)] text-xs">
                {data.html_source}
              </pre>
            </div>
            <div>
              <p className="label-caps">Remediated</p>
              <pre className="mt-2 max-h-[28rem] overflow-auto rounded-sm bg-muted p-3 font-[family-name:var(--font-mono)] text-xs">
                {after.html_fixed}
              </pre>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <figure>
              <figcaption className="label-caps mb-2">Original render</figcaption>
              <iframe
                title="Original page preview"
                srcDoc={data.html_source}
                sandbox=""
                className="h-[28rem] w-full border border-border bg-white"
              />
            </figure>
            <figure>
              <figcaption className="label-caps mb-2">Remediated render</figcaption>
              <iframe
                title="Remediated page preview"
                srcDoc={after.html_fixed}
                sandbox=""
                className="h-[28rem] w-full border border-border bg-white"
              />
            </figure>
          </div>
        )}
        <p className="mt-4 text-sm text-muted-foreground">
          Both previews run in a sandboxed frame with scripts disabled, which is also how the
          contrast stage resolves colours during an audit.
        </p>
      </Panel>
    </div>
  );
}
