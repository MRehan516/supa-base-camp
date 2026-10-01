import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { BarList, TrainingCurve } from "@/components/charts";
import {
  Breadcrumbs,
  ConfusionMatrix,
  PageHeader,
  Panel,
  ProbabilityBars,
  SectionLabel,
  Stat,
} from "@/components/primitives";
import { useApp } from "@/lib/app-context";
import { MODEL_NAMES, evaluateOnHoldout, type ModelKind, type ModelMetrics } from "@/lib/ml/engine";
import { MlService } from "@/lib/services";

export const Route = createFileRoute("/ml-lab")({
  head: () => ({
    meta: [
      { title: "ML Lab — AccessLens" },
      { name: "description", content: "Train the three accessibility models in your browser and inspect loss curves, confusion matrices, per-class metrics and feature importance." },
      { property: "og:title", content: "ML Lab — AccessLens" },
      { property: "og:description", content: "Live TensorFlow.js training with real metrics and a playground for raw predictions." },
    ],
  }),
  component: MlLab,
});

const KINDS: ModelKind[] = ["alt", "link", "severity"];

function MlLab() {
  const { models, training, liveEpochs, train, trainAll, reset } = useApp();
  const [active, setActive] = useState<ModelKind>("alt");
  const [holdout, setHoldout] = useState<Partial<Record<ModelKind, ModelMetrics>>>({});
  const [evaluating, setEvaluating] = useState(false);

  const model = models[active];
  const history = training === active && liveEpochs.length ? liveEpochs : (model?.history ?? []);
  const metrics = holdout[active] ?? model?.metrics;

  const logs = useQuery({ queryKey: ["prediction-logs"], queryFn: () => MlService.recentPredictions(20) });

  const evaluate = async () => {
    setEvaluating(true);
    try {
      const result = await evaluateOnHoldout(active);
      if (!result) {
        toast.error("Train this model first.");
        return;
      }
      setHoldout((prev) => ({ ...prev, [active]: result }));
      toast.success(`Re-evaluated on the held-out split: ${(result.accuracy * 100).toFixed(2)}% accuracy.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Evaluation failed.");
    } finally {
      setEvaluating(false);
    }
  };

  return (
    <div className="space-y-8">
      <Breadcrumbs trail={[{ label: "Home", to: "/" }, { label: "ML Lab" }]} />
      <PageHeader
        eyebrow="Section 07"
        title="ML Lab"
        description="Training runs with TensorFlow.js on this device. Weights are kept in browser storage; metrics and training runs are written to the database."
        actions={
          <>
            <button
              type="button"
              onClick={() => void trainAll()}
              disabled={training !== null}
              className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {training ? `Training ${training}…` : "Train all models"}
            </button>
            <button
              type="button"
              onClick={() => void train(active)}
              disabled={training !== null}
              className="rounded-sm border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              Train {active}
            </button>
            <button
              type="button"
              onClick={() => void reset(active)}
              disabled={training !== null || !model}
              className="rounded-sm border border-destructive px-4 py-2 text-sm text-destructive disabled:opacity-50"
            >
              Reset {active}
            </button>
          </>
        }
      />

      <div role="tablist" aria-label="Model" className="flex flex-wrap gap-1 border-b border-border">
        {KINDS.map((kind) => (
          <button
            key={kind}
            role="tab"
            type="button"
            aria-selected={active === kind}
            onClick={() => setActive(kind)}
            className={
              active === kind
                ? "-mb-px border-b-2 border-primary px-4 py-2 text-sm font-medium"
                : "-mb-px border-b-2 border-transparent px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {MODEL_NAMES[kind]}
          </button>
        ))}
      </div>

      {!model ? (
        <Panel label="Not trained">
          <p className="text-sm text-muted-foreground">
            {MODEL_NAMES[active]} has not been trained in this browser. Training builds the dataset,
            fits the network and stores the weights locally — no data leaves the device.
          </p>
          <button
            type="button"
            onClick={() => void train(active)}
            disabled={training !== null}
            className="mt-4 rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {training === active ? "Training…" : `Train ${MODEL_NAMES[active]}`}
          </button>
          {training === active && liveEpochs.length ? (
            <div className="mt-6">
              <TrainingCurve history={liveEpochs} label="Live training curves" />
            </div>
          ) : null}
        </Panel>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="panel p-5">
              <Stat label="Validation accuracy" value={`${(metrics!.accuracy * 100).toFixed(2)}%`} />
            </div>
            <div className="panel p-5">
              <Stat label="Macro F1" value={metrics!.macroF1.toFixed(3)} />
            </div>
            <div className="panel p-5">
              <Stat label="Train / val rows" value={`${metrics!.trainSize} / ${metrics!.valSize}`} />
            </div>
            <div className="panel p-5">
              <Stat
                label="Training time"
                value={`${(metrics!.durationMs / 1000).toFixed(1)}s`}
                hint={`${metrics!.epochs} epochs`}
              />
            </div>
          </div>

          <Panel
            label="Training"
            title="Loss and accuracy per epoch"
            actions={
              <button
                type="button"
                onClick={() => void evaluate()}
                disabled={evaluating}
                className="rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
              >
                {evaluating ? "Evaluating…" : "Re-evaluate on held-out split"}
              </button>
            }
          >
            <TrainingCurve history={history} label={`Training curves for ${MODEL_NAMES[active]}`} />
            <dl className="metric mt-5 grid gap-2 text-xs sm:grid-cols-2">
              <div className="flex justify-between border-b border-border py-1">
                <dt className="text-muted-foreground">architecture</dt>
                <dd>{metrics!.architecture}</dd>
              </div>
              <div className="flex justify-between border-b border-border py-1">
                <dt className="text-muted-foreground">input features</dt>
                <dd>{metrics!.featureDim}</dd>
              </div>
              <div className="flex justify-between border-b border-border py-1">
                <dt className="text-muted-foreground">classes</dt>
                <dd>{metrics!.classes.join(", ")}</dd>
              </div>
              <div className="flex justify-between border-b border-border py-1">
                <dt className="text-muted-foreground">trained at</dt>
                <dd>{new Date(model.trainedAt).toLocaleString()}</dd>
              </div>
            </dl>
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel label="Evaluation" title="Confusion matrix">
              <ConfusionMatrix classes={metrics!.classes} matrix={metrics!.confusion} />
            </Panel>
            <Panel label="Evaluation" title="Per-class metrics">
              <div className="overflow-x-auto">
                <table className="metric w-full text-xs">
                  <thead>
                    <tr className="rule-line border-b text-left">
                      <th scope="col" className="py-2 pr-3">class</th>
                      <th scope="col" className="py-2 pr-3">precision</th>
                      <th scope="col" className="py-2 pr-3">recall</th>
                      <th scope="col" className="py-2 pr-3">f1</th>
                      <th scope="col" className="py-2">support</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics!.perClass.map((row) => (
                      <tr key={row.label} className="border-b border-border">
                        <td className="py-2 pr-3">{row.label}</td>
                        <td className="py-2 pr-3">{row.precision.toFixed(3)}</td>
                        <td className="py-2 pr-3">{row.recall.toFixed(3)}</td>
                        <td className="py-2 pr-3">{row.f1.toFixed(3)}</td>
                        <td className="py-2">{row.support}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          {metrics!.importance?.length ? (
            <Panel label="Explainability" title="Permutation feature importance">
              <p className="mb-4 text-sm text-muted-foreground">
                Each feature group was shuffled in the validation split and the model re-scored. The
                bar is the real drop in accuracy caused by destroying that group.
              </p>
              <BarList
                items={metrics!.importance.map((row) => ({
                  label: row.feature,
                  value: Number((row.delta * 100).toFixed(2)),
                }))}
                unit="%"
              />
            </Panel>
          ) : null}
        </>
      )}

      {active === "alt" || active === "link" ? <Playground kind={active} onLogged={() => void logs.refetch()} /> : null}

      <Panel label="Logs" title="Recent predictions stored in the database">
        {logs.data && logs.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="metric w-full text-xs">
              <thead>
                <tr className="rule-line border-b text-left">
                  <th scope="col" className="py-2 pr-3">model</th>
                  <th scope="col" className="py-2 pr-3">input</th>
                  <th scope="col" className="py-2 pr-3">prediction</th>
                  <th scope="col" className="py-2">when</th>
                </tr>
              </thead>
              <tbody>
                {logs.data.map((row) => (
                  <tr key={row.id} className="border-b border-border">
                    <td className="py-2 pr-3">{row.model_kind}</td>
                    <td className="max-w-[18rem] truncate py-2 pr-3">{row.input_text}</td>
                    <td className="py-2 pr-3">{row.predicted_label}</td>
                    <td className="py-2 text-muted-foreground">{new Date(row.created_at).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No predictions logged yet. Run an audit or use the playground above.
          </p>
        )}
      </Panel>
    </div>
  );
}

function Playground({ kind, onLogged }: { kind: "alt" | "link"; onLogged: () => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ label: string; probabilities: number[]; classes: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!text.trim()) {
      toast.error("Enter some text to classify.");
      return;
    }
    setBusy(true);
    try {
      const prediction = kind === "alt" ? await MlService.predictAlt(text) : await MlService.predictLink(text);
      if (!prediction) {
        toast.error("Train this model first.");
        return;
      }
      setResult(prediction);
      await MlService.logPrediction(kind, text, prediction.label, prediction.probabilities);
      onLogged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Prediction failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel label="Playground" title={kind === "alt" ? "Classify alt text" : "Classify link text"}>
      <label htmlFor={`play-${kind}`} className="label-caps block">
        {kind === "alt" ? "Alt text" : "Link text"}
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          id={`play-${kind}`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={kind === "alt" ? "Chart of rainfall by month" : "Read the 2025 accessibility report"}
          className="min-w-[16rem] flex-1 rounded-sm border border-input bg-background px-3 py-2 font-[family-name:var(--font-mono)] text-sm"
        />
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Predicting…" : "Predict"}
        </button>
      </div>
      {result ? (
        <div className="mt-5">
          <SectionLabel>Raw softmax output — decision: {result.label}</SectionLabel>
          <div className="mt-2">
            <ProbabilityBars classes={result.classes} probabilities={result.probabilities} highlight={result.label} />
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Every prediction made here is also written to the prediction log table below.
        </p>
      )}
    </Panel>
  );
}
