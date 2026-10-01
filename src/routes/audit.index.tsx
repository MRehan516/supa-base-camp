import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Breadcrumbs, PageHeader, Panel, SectionLabel } from "@/components/primitives";
import { SAMPLE_PAGES } from "@/lib/audit/samples";
import { AuditService } from "@/lib/services";
import { useApp } from "@/lib/app-context";
import type { PipelineStage } from "@/lib/types";

export const Route = createFileRoute("/audit/")({
  head: () => ({
    meta: [
      { title: "New audit — AccessLens" },
      { name: "description", content: "Paste HTML, upload an .html file or load a bundled sample page, then run the full audit pipeline." },
      { property: "og:title", content: "New audit — AccessLens" },
      { property: "og:description", content: "Run WCAG rule checks and model inference against any HTML you supply." },
    ],
  }),
  component: NewAudit,
});

type Tab = "paste" | "upload" | "samples";

function NewAudit() {
  const navigate = useNavigate();
  const { models, train, training } = useApp();
  const [tab, setTab] = useState<Tab>("paste");
  const [name, setName] = useState("");
  const [html, setHtml] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const modelsMissing = !models.alt || !models.link || !models.severity || !models.issueType;

  const run = async () => {
    if (!html.trim()) {
      setValidation("Paste some HTML, upload a file, or load a sample page first.");
      return;
    }
    setValidation(null);
    setRunning(true);
    setStages([]);
    try {
      const result = await AuditService.create(name.trim() || "Untitled page", html, tab, {
        onStage: (stage) => setStages((prev) => [...prev, stage]),
      });
      toast.success(`Audit complete — score ${result.score}/100, ${result.issueCount} issues.`);
      void navigate({ to: "/audit/$id", params: { id: result.auditId } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The audit failed.");
      setRunning(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setHtml(text);
    setName(file.name.replace(/\.html?$/i, ""));
    setValidation(null);
    toast.success(`${file.name} loaded (${text.length.toLocaleString()} characters).`);
  };

  const current = stages[stages.length - 1];

  return (
    <div className="space-y-8">
      <Breadcrumbs trail={[{ label: "Home", to: "/" }, { label: "New audit" }]} />
      <PageHeader
        eyebrow="Section 02"
        title="New audit"
        description="The same pipeline runs on all three input methods. Nothing is sent to a third-party service — parsing and inference happen in this browser."
      />

      {modelsMissing ? (
        <div className="panel border-l-4 border-l-serious p-4">
          <p className="text-sm">
            Not every model is trained in this browser yet. The audit still runs — rule severities
            are used instead of predicted ones, and no model-only findings are added.
          </p>
          <button
            type="button"
            onClick={() => void train("severity")}
            disabled={training !== null}
            className="mt-3 rounded-sm border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
          >
            {training ? "Training…" : "Train the severity model now"}
          </button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
        <div className="space-y-5">
          <div role="tablist" aria-label="Input method" className="flex flex-wrap gap-1 border-b border-border">
            {(
              [
                { id: "paste", label: "Paste HTML" },
                { id: "upload", label: "Upload .html file" },
                { id: "samples", label: "Sample sites" },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                role="tab"
                type="button"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={
                  tab === item.id
                    ? "-mb-px border-b-2 border-primary px-4 py-2 text-sm font-medium"
                    : "-mb-px border-b-2 border-transparent px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
                }
              >
                {item.label}
              </button>
            ))}
          </div>

          <div>
            <label htmlFor="audit-name" className="label-caps block">
              Page name
            </label>
            <input
              id="audit-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Campus news article"
              className="mt-2 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          {tab === "paste" ? (
            <div>
              <label htmlFor="audit-html" className="label-caps block">
                Page HTML
              </label>
              <textarea
                id="audit-html"
                value={html}
                onChange={(event) => {
                  setHtml(event.target.value);
                  if (event.target.value.trim()) setValidation(null);
                }}
                rows={16}
                spellCheck={false}
                aria-describedby="audit-html-hint"
                className="mt-2 w-full rounded-sm border border-input bg-background p-3 font-[family-name:var(--font-mono)] text-xs"
                placeholder="<!DOCTYPE html>&#10;<html>…"
              />
              <p id="audit-html-hint" className="mt-2 text-xs text-muted-foreground">
                A fragment works too — it is parsed into a full document before the checks run.
              </p>
            </div>
          ) : null}

          {tab === "upload" ? (
            <div className="panel border-dashed p-6">
              <label htmlFor="audit-file" className="label-caps block">
                HTML file
              </label>
              <input
                id="audit-file"
                ref={fileInput}
                type="file"
                accept=".html,.htm,text/html"
                onChange={(event) => void onFile(event.target.files?.[0])}
                className="mt-2 block w-full text-sm"
              />
              <p className="mt-3 text-xs text-muted-foreground">
                The file is read in the browser with the File API; it is never uploaded anywhere.
              </p>
              {html ? (
                <p className="metric mt-3 text-sm">{html.length.toLocaleString()} characters loaded</p>
              ) : null}
            </div>
          ) : null}

          {tab === "samples" ? (
            <ul className="grid gap-4 sm:grid-cols-2">
              {SAMPLE_PAGES.map((sample) => (
                <li key={sample.id} className="panel p-4">
                  <h2 className="text-lg">{sample.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{sample.summary}</p>
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {sample.problems.map((problem) => (
                      <li key={problem}>— {problem}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => {
                      setHtml(sample.html);
                      setName(sample.name);
                      setValidation(null);
                      toast.success(`${sample.name} loaded — press Run audit.`);
                    }}
                    className="mt-4 rounded-sm border border-border px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    Load sample
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {validation ? (
            <p role="alert" className="text-sm text-destructive">
              {validation}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void run()}
              disabled={running || !html.trim()}
              className="rounded-sm bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {running ? "Running audit…" : "Run audit"}
            </button>
            <button
              type="button"
              onClick={() => {
                setHtml("");
                setName("");
                setStages([]);
                setValidation(null);
                if (fileInput.current) fileInput.current.value = "";
              }}
              className="rounded-sm border border-border px-5 py-2.5 text-sm hover:bg-muted"
            >
              Clear
            </button>
          </div>
        </div>

        <Panel label="Pipeline" title="Live progress">
          <div aria-live="polite" aria-atomic="false">
            {stages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Stage messages appear here while the audit runs. Each line carries the real elapsed
                time and the real count produced by that stage.
              </p>
            ) : (
              <>
                <div className="h-2 w-full bg-muted" role="presentation">
                  <div className="h-2 bg-primary" style={{ width: `${((current?.progress ?? 0) * 100).toFixed(0)}%` }} />
                </div>
                <ol className="metric mt-4 space-y-2 text-xs">
                  {stages.map((stage, index) => (
                    <li key={`${stage.stage}-${index}`} className="flex gap-3">
                      <span className="w-12 shrink-0 text-right text-muted-foreground">{stage.at}ms</span>
                      <span className="w-20 shrink-0">{stage.label}</span>
                      <span className="text-muted-foreground">{stage.detail}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
          <div className="rule-line mt-5 border-t pt-4">
            <SectionLabel>Why no URL field?</SectionLabel>
            <p className="mt-2 text-sm text-muted-foreground">
              A browser cannot read another site's HTML — the same-origin policy blocks it, and no
              proxy is used here. Paste, upload and the bundled samples are the honest alternatives.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
