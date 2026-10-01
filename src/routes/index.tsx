import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Panel, ProbabilityBars, SectionLabel } from "@/components/primitives";
import { useApp } from "@/lib/app-context";
import { MlService } from "@/lib/services";
import { RULES } from "@/lib/audit/rules";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AccessLens — ML-based web accessibility auditor" },
      {
        name: "description",
        content:
          "Audit any HTML page against WCAG 2.1, rank the findings with models trained in your browser, and generate fixes you can apply and re-test.",
      },
      { property: "og:title", content: "AccessLens — ML-based web accessibility auditor" },
      {
        property: "og:description",
        content: "Deterministic WCAG rule checks plus three in-browser models, with real remediation.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { models, train, training } = useApp();
  const [text, setText] = useState("photo123.jpg");
  const [result, setResult] = useState<{ label: string; probabilities: number[]; classes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounced live inference against the real model.
  useEffect(() => {
    if (!models.alt) {
      setResult(null);
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const prediction = await MlService.predictAlt(text);
          setResult(prediction);
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Prediction failed");
        }
      })();
    }, 150);
    return () => clearTimeout(timer);
  }, [text, models.alt]);

  return (
    <div className="space-y-12">
      <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <SectionLabel number="01">What this is</SectionLabel>
          <h1 className="mt-3 text-4xl leading-[1.08] sm:text-5xl">
            An accessibility auditor that explains its own judgement.
          </h1>
          <p className="mt-5 max-w-prose text-base text-muted-foreground">
            Paste a page's HTML. AccessLens parses it, runs {RULES.length} deterministic WCAG 2.1
            checks, then asks three models — trained in your browser, on data you can read — whether
            the alt text means anything, whether the link text is usable, and how badly each finding
            hurts. Then it writes the fix, applies it, and audits the result again.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              to="/audit"
              className="rounded-sm bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Start audit
            </Link>
            <Link to="/ml-lab" className="rounded-sm border border-border px-5 py-2.5 text-sm hover:bg-muted">
              View ML Lab
            </Link>
            <Link to="/methodology" className="rounded-sm px-5 py-2.5 text-sm underline underline-offset-4">
              How it works
            </Link>
          </div>
          <dl className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
            {[
              { k: "Rule checks", v: String(RULES.length) },
              { k: "Models", v: "3" },
              { k: "Labelled rows", v: "3,600+" },
              { k: "Fake numbers", v: "0" },
            ].map((item) => (
              <div key={item.k}>
                <dt className="label-caps">{item.k}</dt>
                <dd className="metric mt-1 text-2xl">{item.v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <Panel label="Live mini-demo" title="Alt-text quality, judged now">
          <p className="text-sm text-muted-foreground">
            Type any alt text. The probabilities below are the raw softmax output of the alt-text
            model running on this device — not a canned response.
          </p>
          <label htmlFor="demo-alt" className="label-caps mt-5 block">
            Alt text
          </label>
          <input
            id="demo-alt"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="mt-2 w-full rounded-sm border border-input bg-background px-3 py-2 font-[family-name:var(--font-mono)] text-sm"
            placeholder="Bar chart showing sales rising from 40 to 70 percent"
          />
          <div className="mt-5">
            {models.alt ? (
              result ? (
                <>
                  <p className="text-sm">
                    Decision: <span className="metric">{result.label}</span>
                  </p>
                  <div className="mt-3">
                    <ProbabilityBars
                      classes={result.classes}
                      probabilities={result.probabilities}
                      highlight={result.label}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Running inference…</p>
              )
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  No trained alt-text model is stored in this browser yet. Training takes a few
                  seconds and happens entirely on this device.
                </p>
                <button
                  type="button"
                  onClick={() => void train("alt")}
                  disabled={training !== null}
                  className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
                >
                  {training === "alt" ? "Training…" : "Train the alt-text model"}
                </button>
              </div>
            )}
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          </div>
        </Panel>
      </section>

      <section className="rule-line border-t pt-10">
        <SectionLabel number="02">Pipeline</SectionLabel>
        <ol className="mt-5 grid gap-6 md:grid-cols-5">
          {[
            { t: "Parse", d: "DOMParser builds the DOM and counts every element." },
            { t: "Rule checks", d: `${RULES.length} deterministic WCAG 2.1 checks, no ML involved.` },
            { t: "Contrast", d: "Colours resolved by the browser in a sandboxed frame." },
            { t: "ML inference", d: "Alt quality, link clarity and severity, with probabilities." },
            { t: "Remediate", d: "Generate fixes, apply, re-audit, compare scores." },
          ].map((step, index) => (
            <li key={step.t}>
              <p className="section-number">{String(index + 1).padStart(2, "0")}</p>
              <h2 className="mt-1 text-lg">{step.t}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{step.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="rule-line border-t pt-10">
        <SectionLabel number="03">Honest limits</SectionLabel>
        <div className="mt-5 grid gap-6 md:grid-cols-3">
          <Panel>
            <h2 className="text-lg">Live URLs cannot be fetched</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The browser blocks reading other sites' HTML. Use paste, file upload or the bundled
              sample pages instead — all three run the identical pipeline.
            </p>
          </Panel>
          <Panel>
            <h2 className="text-lg">Training data is synthetic + curated</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Generated from documented templates and hand-written examples. Every row and every
              label rule is listed on the Datasets page.
            </p>
          </Panel>
          <Panel>
            <h2 className="text-lg">Fixes are suggestions</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Each fix shows its confidence and its evidence. Weak ones are labelled "needs human
              review" and stay editable before you apply them.
            </p>
          </Panel>
        </div>
      </section>
    </div>
  );
}
