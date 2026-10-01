import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { BarList } from "@/components/charts";
import { Breadcrumbs, PageHeader, Panel, SectionLabel, Stat } from "@/components/primitives";
import {
  ALT_CLASSES,
  ALT_LABEL_RULES,
  LINK_CLASSES,
  LINK_LABEL_RULES,
  SEVERITY_LABEL_RULES,
  buildAltDataset,
  buildLinkDataset,
  buildSeverityDataset,
  classBalance,
} from "@/lib/ml/datasets";
import { DatasetService, downloadFile } from "@/lib/services";

export const Route = createFileRoute("/datasets")({
  head: () => ({
    meta: [
      { title: "Datasets — AccessLens" },
      { name: "description", content: "Browse the labelled training data, the exact labelling rules and the class balance, and add your own examples." },
      { property: "og:title", content: "Datasets — AccessLens" },
      { property: "og:description", content: "Full transparency about what the models learned from." },
    ],
  }),
  component: Datasets,
});

type Which = "alt" | "link" | "severity";

function Datasets() {
  const [which, setWhich] = useState<Which>("alt");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [newText, setNewText] = useState("");
  const [newLabel, setNewLabel] = useState<string>(ALT_CLASSES[0]);
  const [saving, setSaving] = useState(false);

  const alt = useMemo(() => buildAltDataset(), []);
  const link = useMemo(() => buildLinkDataset(), []);
  const severity = useMemo(() => buildSeverityDataset(), []);
  const mine = useQuery({ queryKey: ["dataset-examples"], queryFn: () => DatasetService.list() });

  const rows = useMemo(() => {
    if (which === "severity")
      return severity.map((row) => ({
        text: `${row.row.ruleId} · ${row.row.elementType} · nav=${row.row.inNav} · interactive=${row.row.interactive} · pos=${row.row.position.toFixed(2)} · gap=${row.row.contrastGap.toFixed(2)} · same=${row.row.sameRuleCount}`,
        label: row.label,
      }));
    return (which === "alt" ? alt : link).map((row) => ({ text: row.text, label: row.label }));
  }, [which, alt, link, severity]);

  const filtered = useMemo(
    () =>
      search.trim()
        ? rows.filter((row) => `${row.text} ${row.label}`.toLowerCase().includes(search.toLowerCase()))
        : rows,
    [rows, search],
  );

  const perPage = 25;
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const slice = filtered.slice(page * perPage, page * perPage + perPage);
  const balance = useMemo(() => classBalance(rows.map((row) => row.label)), [rows]);

  const labelOptions =
    which === "alt"
      ? [...ALT_CLASSES]
      : which === "link"
        ? [...LINK_CLASSES]
        : ["critical", "serious", "moderate", "minor"];

  const addExample = async () => {
    setSaving(true);
    try {
      await DatasetService.add(which, newText, newLabel);
      setNewText("");
      await mine.refetch();
      toast.success("Example saved. It is included the next time you train this model.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the example.");
    } finally {
      setSaving(false);
    }
  };

  const labelRules =
    which === "alt" ? ALT_LABEL_RULES : which === "link" ? LINK_LABEL_RULES : SEVERITY_LABEL_RULES;

  return (
    <div className="space-y-8">
      <Breadcrumbs trail={[{ label: "Home", to: "/" }, { label: "Datasets" }]} />
      <PageHeader
        eyebrow="Section 08"
        title="Datasets"
        description="The training data is synthetic and curated, generated deterministically from documented templates. Nothing here is hidden — browse every row."
        actions={
          <button
            type="button"
            onClick={() =>
              downloadFile(
                `${which}-dataset.csv`,
                ["text,label", ...rows.map((row) => `"${row.text.replace(/"/g, '""')}","${row.label}"`)].join("\n"),
                "text/csv",
              )
            }
            className="rounded-sm border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            Export this dataset
          </button>
        }
      />

      <div role="tablist" aria-label="Dataset" className="flex flex-wrap gap-1 border-b border-border">
        {(
          [
            { id: "alt", label: "Alt text" },
            { id: "link", label: "Link text" },
            { id: "severity", label: "Severity (tabular)" },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={which === item.id}
            onClick={() => {
              setWhich(item.id);
              setPage(0);
              setNewLabel(
                item.id === "alt" ? ALT_CLASSES[0] : item.id === "link" ? LINK_CLASSES[0] : "critical",
              );
            }}
            className={
              which === item.id
                ? "-mb-px border-b-2 border-primary px-4 py-2 text-sm font-medium"
                : "-mb-px border-b-2 border-transparent px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Panel label="Composition" title="Class balance">
          <BarList items={Object.entries(balance).map(([label, value]) => ({ label, value }))} />
          <div className="mt-5 grid grid-cols-2 gap-4">
            <Stat label="Total rows" value={rows.length} />
            <Stat label="Classes" value={Object.keys(balance).length} />
          </div>
        </Panel>

        <Panel label="Labelling" title="The exact rules used to label">
          <ul className="space-y-2 text-sm">
            {labelRules.map((rule) => (
              <li key={rule} className="rule-line border-b pb-2 text-muted-foreground">
                {rule}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm">
            {which === "severity"
              ? "The severity labels come from a weighted impact score with Gaussian noise added, so the model has to generalise rather than memorise a lookup table."
              : "Rows are generated from templates with a seeded random number generator, so the dataset is identical on every machine."}
          </p>
        </Panel>
      </div>

      <Panel label="Rows" title={`${filtered.length} rows`}>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label htmlFor="dataset-search" className="label-caps block">
              Search rows
            </label>
            <input
              id="dataset-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              className="mt-2 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={page === 0}
              className="rounded-sm border border-border px-3 py-2 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <span className="metric px-2 py-2 text-sm">
              {page + 1} / {pages}
            </span>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(pages - 1, value + 1))}
              disabled={page >= pages - 1}
              className="rounded-sm border border-border px-3 py-2 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="metric w-full text-xs">
            <thead>
              <tr className="rule-line border-b text-left">
                <th scope="col" className="py-2 pr-4">{which === "severity" ? "feature row" : "text"}</th>
                <th scope="col" className="py-2">label</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((row, index) => (
                <tr key={`${row.text}-${index}`} className="border-b border-border">
                  <td className="py-2 pr-4">{row.text || <span className="text-muted-foreground">(empty string)</span>}</td>
                  <td className="py-2">{row.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel label="Your examples" title="Add training data of your own">
        <p className="text-sm text-muted-foreground">
          Examples you add are stored in the database and appended to the generated dataset the next
          time you train that model — so you can watch your own data change the metrics.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
          <div>
            <label htmlFor="example-text" className="label-caps block">
              {which === "severity" ? "Description (stored for reference)" : "Text"}
            </label>
            <input
              id="example-text"
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
              className="mt-2 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="example-label" className="label-caps block">
              Label
            </label>
            <select
              id="example-label"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              className="mt-2 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm"
            >
              {labelOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void addExample()}
              disabled={saving}
              className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : "Add example"}
            </button>
          </div>
        </div>

        {mine.data && mine.data.length > 0 ? (
          <ul className="mt-5 divide-y divide-border text-sm">
            {mine.data.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="label-caps">{row.dataset}</span>
                <span className="metric flex-1 truncate">{row.text || "(empty string)"}</span>
                <span className="metric text-xs">{row.label}</span>
                <button
                  type="button"
                  onClick={async () => {
                    await DatasetService.remove(row.id);
                    await mine.refetch();
                  }}
                  className="rounded-sm border border-destructive px-2 py-1 text-xs text-destructive"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">You have not added any examples yet.</p>
        )}
      </Panel>

      <Panel>
        <SectionLabel>Honest note</SectionLabel>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          This data is not scraped from real websites. It is generated from hand-written templates
          that mirror the patterns accessibility auditors see most often. That makes the labels
          consistent and inspectable, but it also means the reported accuracy describes this
          distribution — not the whole web.
        </p>
      </Panel>
    </div>
  );
}
