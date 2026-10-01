import { createFileRoute, Link } from "@tanstack/react-router";

import { Breadcrumbs, PageHeader, Panel, SectionLabel } from "@/components/primitives";
import { RULES } from "@/lib/audit/rules";
import { SEVERITY_WEIGHT, WEIGHT_CEILING } from "@/lib/audit/scoring";
import { ALT_LABEL_RULES, LINK_LABEL_RULES, SEVERITY_LABEL_RULES } from "@/lib/ml/datasets";
import { SEVERITY_FEATURE_GROUPS } from "@/lib/ml/features";

export const Route = createFileRoute("/methodology")({
  head: () => ({
    meta: [
      { title: "Methodology — AccessLens" },
      { name: "description", content: "The rule catalogue, the scoring formula, the model architectures, the API contract and an honest list of limitations." },
      { property: "og:title", content: "Methodology — AccessLens" },
      { property: "og:description", content: "Everything the auditor does, written out so it can be checked." },
    ],
  }),
  component: Methodology,
});

const ENDPOINTS = [
  ["POST", "/api/audits", "Run the pipeline on supplied HTML and store the audit"],
  ["GET", "/api/audits", "List stored audits with scores and issue counts"],
  ["GET", "/api/audits/:id", "One audit with its issues and remediated version"],
  ["DELETE", "/api/audits/:id", "Delete an audit and its issues"],
  ["POST", "/api/audits/:id/remediate", "Apply selected fixes, re-audit, store the result"],
  ["POST", "/api/ml/train/:model", "Train one model and record metrics"],
  ["GET", "/api/ml/models", "Model records with their metrics"],
  ["POST", "/api/ml/alt-text/predict", "Classify alt text, returning probabilities"],
  ["POST", "/api/ml/link-text/predict", "Classify link text, returning probabilities"],
  ["GET", "/api/stats", "Dashboard aggregates"],
];

function Methodology() {
  return (
    <div className="space-y-8">
      <Breadcrumbs trail={[{ label: "Home", to: "/" }, { label: "Methodology" }]} />
      <PageHeader
        eyebrow="Section 12"
        title="Methodology"
        description="Everything the auditor does, written out so a reader can verify it rather than take it on trust."
      />

      <Panel label="Pipeline" title="The five stages">
        <ol className="space-y-4">
          {[
            ["Parse", "DOMParser builds a document from the supplied HTML and every element is counted. Nothing is fetched from the network."],
            ["Rule checks", `${RULES.length} deterministic checks walk the document. No model is involved in this stage, so the same page always produces the same findings.`],
            ["Contrast", "The page is written into an off-screen sandboxed iframe with scripts disabled, so getComputedStyle returns the colours the browser would really paint. Ratios use the WCAG relative-luminance formula, flattening transparent backgrounds onto their ancestors."],
            ["Model inference", "The alt-text and link-text classifiers judge text quality; the severity model ranks every finding. Raw probabilities are stored with the issue so they can be inspected later."],
            ["Score and store", "The weighted score is computed and the audit, issues and prediction logs are written to the database."],
          ].map(([title, body], index) => (
            <li key={title}>
              <p className="section-number">{String(index + 1).padStart(2, "0")}</p>
              <h3 className="mt-1 text-lg">{title}</h3>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel label="Scoring" title="The formula">
        <pre className="overflow-x-auto rounded-sm bg-muted p-4 font-[family-name:var(--font-mono)] text-xs">{`penalty   = Σ weight(severity of issue)
capacity  = ${WEIGHT_CEILING} × log2(elementCount + 2)
score     = round(100 × (1 − penalty / capacity)), clamped to 0…100

weights: ${Object.entries(SEVERITY_WEIGHT)
          .map(([key, value]) => `${key}=${value}`)
          .join("  ")}`}</pre>
        <p className="mt-4 max-w-prose text-sm text-muted-foreground">
          Dividing by a logarithm of the element count means a large page is not punished simply for
          being large, while a tiny page with a critical fault still scores badly. The score is
          monotonic: adding an issue can never raise it. Both properties are asserted on the{" "}
          <Link to="/tests" className="underline underline-offset-4">
            Tests page
          </Link>
          .
        </p>
      </Panel>

      <Panel label="Models" title="Architecture and training">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="rule-line border-b text-left">
                <th scope="col" className="py-2 pr-4">model</th>
                <th scope="col" className="py-2 pr-4">input</th>
                <th scope="col" className="py-2 pr-4">network</th>
                <th scope="col" className="py-2">output</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-b border-border">
                <td className="py-3 pr-4">Alt-text quality</td>
                <td className="py-3 pr-4">Character n-gram TF-IDF (n = 2…4) + 12 hand features</td>
                <td className="py-3 pr-4">Dense 128 → dropout → 64 → softmax, Adam</td>
                <td className="py-3">missing_info · poor · good · decorative_ok</td>
              </tr>
              <tr className="border-b border-border">
                <td className="py-3 pr-4">Link-text clarity</td>
                <td className="py-3 pr-4">Same text features, smaller vocabulary</td>
                <td className="py-3 pr-4">Dense 64 → dropout → 32 → softmax, Adam</td>
                <td className="py-3">vague · descriptive</td>
              </tr>
              <tr>
                <td className="py-3 pr-4">Issue severity</td>
                <td className="py-3 pr-4">
                  Tabular: {SEVERITY_FEATURE_GROUPS.join(", ")}
                </td>
                <td className="py-3 pr-4">Dense 96 → dropout → 48 → softmax, Adam</td>
                <td className="py-3">critical · serious · moderate · minor</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-prose text-sm text-muted-foreground">
          Training uses an 80/20 split with a fixed seed, so results are reproducible. Weights are
          stored in browser storage; metrics, loss histories and training runs are written to the
          database. Feature importance on the severity model is real permutation importance: each
          feature group is shuffled in the validation split and the accuracy drop is measured.
        </p>
      </Panel>

      <Panel label="Labels" title="How the training data was labelled">
        <div className="grid gap-6 lg:grid-cols-3">
          {[
            { title: "Alt text", rules: ALT_LABEL_RULES },
            { title: "Link text", rules: LINK_LABEL_RULES },
            { title: "Severity", rules: SEVERITY_LABEL_RULES },
          ].map((group) => (
            <div key={group.title}>
              <SectionLabel>{group.title}</SectionLabel>
              <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                {group.rules.map((rule) => (
                  <li key={rule} className="rule-line border-b pb-2">
                    {rule}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm">
          Every row is browsable on the{" "}
          <Link to="/datasets" className="underline underline-offset-4">
            Datasets page
          </Link>
          .
        </p>
      </Panel>

      <Panel label="Rules" title={`The ${RULES.length} rule checks`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="rule-line border-b text-left">
                <th scope="col" className="py-2 pr-4">id</th>
                <th scope="col" className="py-2 pr-4">WCAG criterion</th>
                <th scope="col" className="py-2 pr-4">level</th>
                <th scope="col" className="py-2 pr-4">default severity</th>
                <th scope="col" className="py-2">auto-fixable</th>
              </tr>
            </thead>
            <tbody>
              {RULES.map((rule) => (
                <tr key={rule.id} className="border-b border-border">
                  <td className="metric py-2 pr-4 text-xs">{rule.id}</td>
                  <td className="py-2 pr-4">{rule.wcag}</td>
                  <td className="metric py-2 pr-4">{rule.level}</td>
                  <td className="py-2 pr-4">{rule.severity}</td>
                  <td className="py-2">{rule.fixable ? "yes" : "needs a person"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel label="API" title="Service contract">
        <p className="max-w-prose text-sm text-muted-foreground">
          The interface never queries the database directly. It calls the service layer, which
          implements exactly these operations — so the same application could be moved behind an HTTP
          API without touching a single page.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="metric w-full text-xs">
            <tbody>
              {ENDPOINTS.map(([method, path, purpose]) => (
                <tr key={path + method} className="border-b border-border">
                  <td className="py-2 pr-4">{method}</td>
                  <td className="py-2 pr-4">{path}</td>
                  <td className="py-2 font-[family-name:var(--font-sans)] text-muted-foreground">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel label="Limits" title="What this cannot do">
        <ul className="space-y-3 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">No live URL auditing.</strong> A browser cannot read
            another site's HTML, so paste, upload and bundled samples are offered instead. No proxy is
            used, and none is pretended.
          </li>
          <li>
            <strong className="text-foreground">Parsing is not in a worker.</strong> DOMParser and
            getComputedStyle do not exist in worker scope. The pipeline yields to the browser between
            stages so the interface stays responsive; TensorFlow.js uses WebGL where available.
          </li>
          <li>
            <strong className="text-foreground">Synthetic training data.</strong> Accuracy figures
            describe this curated distribution, not the entire web.
          </li>
          <li>
            <strong className="text-foreground">Automated checks miss things.</strong> Rule checks
            cannot judge whether a heading is meaningful, whether a caption is accurate, or whether a
            keyboard flow makes sense. Manual testing with real assistive technology is still required.
          </li>
          <li>
            <strong className="text-foreground">Fixes are suggestions.</strong> Low-confidence fixes
            are labelled for human review and every suggestion stays editable before it is applied.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
