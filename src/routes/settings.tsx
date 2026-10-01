import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { Breadcrumbs, PageHeader, Panel, SectionLabel } from "@/components/primitives";
import { useApp } from "@/lib/app-context";
import { ALL_MODEL_KINDS, MODEL_NAMES } from "@/lib/ml/engine";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — AccessLens" },
      { name: "description", content: "Switch to the high-contrast theme, scale the type, train models on startup and turn on verification mode." },
      { property: "og:title", content: "Settings — AccessLens" },
      { property: "og:description", content: "Verification mode logs every model call and database write on the page." },
    ],
  }),
  component: Settings,
});

function Settings() {
  const { settings, updateSettings, models, reset, training, console: lines, clearConsole } = useApp();

  return (
    <div className="space-y-8">
      <Breadcrumbs trail={[{ label: "Home", to: "/" }, { label: "Settings" }]} />
      <PageHeader
        eyebrow="Section 11"
        title="Settings"
        description="Preferences are stored in this browser only. Nothing here changes the audit maths."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel label="Appearance" title="Theme and type size">
          <fieldset>
            <legend className="label-caps">Theme</legend>
            <div className="mt-2 flex flex-wrap gap-4">
              {(
                [
                  { id: "paper", label: "Paper (default)" },
                  { id: "contrast", label: "High contrast" },
                ] as const
              ).map((option) => (
                <label key={option.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="theme"
                    value={option.id}
                    checked={settings.theme === option.id}
                    onChange={() => updateSettings({ theme: option.id })}
                    className="size-4"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-6">
            <label htmlFor="font-scale" className="label-caps block">
              Text size — {settings.fontScale}%
            </label>
            <input
              id="font-scale"
              type="range"
              min={90}
              max={140}
              step={5}
              value={settings.fontScale}
              onChange={(event) => updateSettings({ fontScale: Number(event.target.value) })}
              className="mt-3 w-full"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Scales the whole interface, which is also a quick way to check that the layout survives
              enlarged text.
            </p>
          </div>
        </Panel>

        <Panel label="Behaviour" title="Models and verification">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={settings.trainOnStartup}
              onChange={(event) => updateSettings({ trainOnStartup: event.target.checked })}
              className="mt-1 size-4"
            />
            <span>
              <span className="block">Train missing models when the app opens</span>
              <span className="block text-xs text-muted-foreground">
                Convenient for a demonstration; it uses a few seconds of processor time on load.
              </span>
            </span>
          </label>

          <label className="mt-5 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={settings.verification}
              onChange={(event) => updateSettings({ verification: event.target.checked })}
              className="mt-1 size-4"
            />
            <span>
              <span className="block">Verification mode</span>
              <span className="block text-xs text-muted-foreground">
                Prints every model inference and every database write to the console below, so you
                can confirm the numbers on screen were really computed.
              </span>
            </span>
          </label>

          <div className="rule-line mt-6 border-t pt-4">
            <SectionLabel>Stored models</SectionLabel>
            <ul className="mt-3 space-y-2 text-sm">
              {ALL_MODEL_KINDS.map((kind) => (
                <li key={kind} className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    {MODEL_NAMES[kind]}
                    <span className="metric ml-2 text-xs text-muted-foreground">
                      {models[kind] ? `${(models[kind]!.metrics.accuracy * 100).toFixed(1)}% val acc` : "not trained"}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={!models[kind] || training !== null}
                    onClick={async () => {
                      await reset(kind);
                      toast.success(`${MODEL_NAMES[kind]} removed from this browser.`);
                    }}
                    className="rounded-sm border border-destructive px-2 py-1 text-xs text-destructive disabled:opacity-50"
                  >
                    Delete weights
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>

      <Panel
        label="Verification"
        title="On-page console"
        actions={
          <button
            type="button"
            onClick={clearConsole}
            className="rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-muted"
          >
            Clear
          </button>
        }
      >
        {settings.verification ? (
          lines.length > 0 ? (
            <pre className="max-h-80 overflow-auto rounded-sm bg-muted p-3 font-[family-name:var(--font-mono)] text-xs">
              {lines.join("\n")}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              Verification mode is on. Run an audit or a prediction and each step will appear here.
            </p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            Turn on verification mode above to record model calls and database writes.
          </p>
        )}
      </Panel>
    </div>
  );
}
