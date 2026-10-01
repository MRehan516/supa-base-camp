/**
 * ML engine.
 *
 * Five models, all trained in the browser with TensorFlow.js:
 *
 *   severity   — Model 1: issue severity classifier (tabular features)
 *   issueType  — Model 2: issue-type classifier (character n-grams of the element snippet)
 *   fixSuccess — Model 3: fix-success predictor (tabular features of a proposed fix)
 *   alt        — supporting NLP model: alt-text quality
 *   link       — supporting NLP model: link-text clarity
 *
 * Evaluation protocol (identical for every model):
 *   - rows are grouped (identical text / same source page) and the GROUPS are
 *     shuffled with a fixed seed and split 70 / 15 / 15 into train / validation
 *     / test, so the same string or page can never sit on both sides;
 *   - the vectoriser is fitted on the training split only;
 *   - the validation split drives the training curves;
 *   - every reported metric comes from the test split, which the model never
 *     sees during fitting.
 *
 * TensorFlow.js is imported lazily so the server-side render never touches it.
 */

import type { SeverityRow, Severity } from "../types";
import {
  ALT_CLASSES,
  LINK_CLASSES,
  buildAltDataset,
  buildLinkDataset,
  buildSeverityDataset,
  mulberry32,
  shuffle,
  type TextExample,
} from "./datasets";
import {
  Vectoriser,
  severityFeatures,
  severityGroupIndices,
  type VectoriserState,
} from "./features";
import {
  FIX_MODEL_RULES,
  FIX_SUCCESS_CLASSES,
  ISSUE_TYPE_CLASSES,
  buildFixSuccessDataset,
  buildIssueTypeDataset,
  fixFeatureGroupIndices,
  fixSuccessFeatures,
  type FixSuccessInput,
} from "./synth";

type Tf = typeof import("@tensorflow/tfjs");
type Tensor = import("@tensorflow/tfjs").Tensor;

let tfPromise: Promise<Tf> | null = null;
export async function loadTf(): Promise<Tf> {
  if (!tfPromise) tfPromise = import("@tensorflow/tfjs").then((mod) => mod);
  return tfPromise;
}

export type ModelKind = "severity" | "issueType" | "fixSuccess" | "alt" | "link";
export const ALL_MODEL_KINDS: ModelKind[] = ["severity", "issueType", "fixSuccess", "alt", "link"];
/** The three primary project models. */
export const PRIMARY_MODEL_KINDS: ModelKind[] = ["severity", "issueType", "fixSuccess"];

export const SEVERITY_CLASSES: Severity[] = ["critical", "serious", "moderate", "minor"];

/** Bump when feature layouts change; older persisted models are discarded. */
const SCHEMA_VERSION = 3;

export const SPLIT = { train: 0.7, val: 0.15, test: 0.15 } as const;
export const SPLIT_SEEDS: Record<ModelKind, number> = {
  severity: 4242,
  issueType: 3131,
  fixSuccess: 5151,
  alt: 42,
  link: 43,
};

export interface EpochPoint {
  epoch: number;
  loss: number;
  acc: number;
  valLoss: number;
  valAcc: number;
}

export interface PerClassMetric {
  label: string;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface ModelMetrics {
  classes: string[];
  accuracy: number;
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  perClass: PerClassMetric[];
  confusion: number[][];
  trainSize: number;
  valSize: number;
  testSize: number;
  groups: number;
  seed: number;
  /** Always "test": metrics are computed on the held-out test split. */
  evaluatedOn: "test";
  /** True when the test split is too small for firm conclusions. */
  smallSample: boolean;
  epochs: number;
  featureDim: number;
  architecture: string;
  durationMs: number;
  /** Permutation importance on the validation split (drop in accuracy). */
  importance?: { feature: string; delta: number }[];
}

export interface TrainedModel {
  kind: ModelKind;
  name: string;
  classes: string[];
  metrics: ModelMetrics;
  history: EpochPoint[];
  vectoriser?: Vectoriser;
  trainedAt: string;
}

export interface Prediction {
  label: string;
  probabilities: number[];
  classes: string[];
}

interface Persisted {
  schema: number;
  classes: string[];
  metrics: ModelMetrics;
  history: EpochPoint[];
  vectoriser?: VectoriserState;
  trainedAt: string;
}

const STORE_PREFIX = "accesslens.model.";
const MODEL_URL: Record<ModelKind, string> = {
  severity: "indexeddb://accesslens-severity",
  issueType: "indexeddb://accesslens-issuetype",
  fixSuccess: "indexeddb://accesslens-fixsuccess",
  alt: "indexeddb://accesslens-alt",
  link: "indexeddb://accesslens-link",
};

export const MODEL_NAMES: Record<ModelKind, string> = {
  severity: "Model 1 · Severity classifier",
  issueType: "Model 2 · Issue-type classifier",
  fixSuccess: "Model 3 · Fix-success predictor",
  alt: "Alt-text quality classifier",
  link: "Link-text clarity classifier",
};

export const MODEL_PURPOSE: Record<ModelKind, string> = {
  severity: "Ranks a detected finding by likely user impact. It never decides whether the finding exists.",
  issueType: "Predicts the issue category from the element's HTML alone. Agreement with the rule's category is a consistency check, not proof.",
  fixSuccess: "Estimates whether a proposed fix will make the rule stop firing. The real answer always comes from the re-audit.",
  alt: "Flags alt text that is potentially uninformative. It cannot see the image, so it cannot confirm the alt is correct.",
  link: "Flags link text that is potentially vague out of context. Findings it raises are advisory and not scored.",
};

export function argmax(values: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

export function evaluateMetrics(
  classes: string[],
  trueIdx: number[],
  predIdx: number[],
): Pick<ModelMetrics, "accuracy" | "macroF1" | "macroPrecision" | "macroRecall" | "perClass" | "confusion"> {
  const size = classes.length;
  const confusion = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  trueIdx.forEach((t, i) => {
    confusion[t][predIdx[i]] += 1;
  });
  let correct = 0;
  for (let i = 0; i < size; i++) correct += confusion[i][i];
  const accuracy = trueIdx.length ? correct / trueIdx.length : 0;

  const perClass = classes.map((label, i) => {
    const tp = confusion[i][i];
    let fp = 0;
    let fn = 0;
    for (let j = 0; j < size; j++) {
      if (j !== i) {
        fp += confusion[j][i];
        fn += confusion[i][j];
      }
    }
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    const support = confusion[i].reduce((a, b) => a + b, 0);
    return { label, precision, recall, f1, support };
  });
  const present = perClass.filter((c) => c.support > 0);
  const denom = present.length || 1;
  return {
    accuracy,
    macroPrecision: present.reduce((s, c) => s + c.precision, 0) / denom,
    macroRecall: present.reduce((s, c) => s + c.recall, 0) / denom,
    macroF1: present.reduce((s, c) => s + c.f1, 0) / denom,
    perClass,
    confusion,
  };
}

export interface Split {
  train: number[];
  val: number[];
  test: number[];
  groups: number;
}

/**
 * Grouped, seeded 70/15/15 split. Rows sharing a group key always land in the
 * same split, which prevents identical strings (or variants of the same page)
 * leaking from training into evaluation.
 */
export function groupedSplit(keys: string[], seed: number): Split {
  const groups = new Map<string, number[]>();
  keys.forEach((key, i) => {
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  });
  const names = shuffle([...groups.keys()].sort(), mulberry32(seed));
  const total = keys.length;
  const train: number[] = [];
  const val: number[] = [];
  const test: number[] = [];
  names.forEach((name) => {
    const rows = groups.get(name)!;
    if (train.length < total * SPLIT.train) train.push(...rows);
    else if (val.length < total * SPLIT.val) val.push(...rows);
    else test.push(...rows);
  });
  return { train, val, test, groups: groups.size };
}

const normKey = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Datasets per model (used by both training and re-evaluation)
// ---------------------------------------------------------------------------

/** Extra labelled examples contributed by the user through /datasets. */
let userExamples: { dataset: string; text: string; label: string }[] = [];
export function setUserExamples(rows: { dataset: string; text: string; label: string }[]): void {
  userExamples = rows;
}
function extraExamples(dataset: string): TextExample[] {
  return userExamples
    .filter((row) => row.dataset === dataset)
    .map((row) => ({ text: row.text, label: row.label, origin: "user" as const }));
}

interface PreparedData {
  classes: string[];
  rows: number;
  keys: string[];
  labels: number[];
  /** Text per row for vectorised models, or numeric features for tabular ones. */
  text?: string[];
  features?: number[][];
}

function prepare(kind: ModelKind): PreparedData {
  if (kind === "alt" || kind === "link") {
    const rows = kind === "alt" ? [...buildAltDataset(), ...extraExamples("alt")] : [...buildLinkDataset(), ...extraExamples("link")];
    const classes = kind === "alt" ? [...ALT_CLASSES] : [...LINK_CLASSES];
    return {
      classes,
      rows: rows.length,
      keys: rows.map((r) => normKey(r.text)),
      labels: rows.map((r) => Math.max(0, classes.indexOf(r.label as never))),
      text: rows.map((r) => r.text),
    };
  }
  if (kind === "issueType") {
    const rows = buildIssueTypeDataset();
    const classes = [...ISSUE_TYPE_CLASSES] as string[];
    return {
      classes,
      rows: rows.length,
      keys: rows.map((r) => normKey(r.text)),
      labels: rows.map((r) => Math.max(0, classes.indexOf(r.label))),
      text: rows.map((r) => r.text),
    };
  }
  if (kind === "fixSuccess") {
    const rows = buildFixSuccessDataset();
    const classes = [...FIX_SUCCESS_CLASSES] as string[];
    return {
      classes,
      rows: rows.length,
      keys: rows.map((r) => r.group),
      labels: rows.map((r) => classes.indexOf(r.label)),
      features: rows.map((r) => fixSuccessFeatures(r.input)),
    };
  }
  const rows = buildSeverityDataset();
  const classes = [...SEVERITY_CLASSES] as string[];
  return {
    classes,
    rows: rows.length,
    keys: rows.map((r) => JSON.stringify([r.row.ruleId, r.row.elementType, r.row.inNav, r.row.interactive, r.row.position.toFixed(2), r.row.contrastGap.toFixed(2), r.row.sameRuleCount])),
    labels: rows.map((r) => Math.max(0, classes.indexOf(r.label))),
    features: rows.map((r) => severityFeatures(r.row)),
  };
}

interface Config {
  hidden: number[];
  dropout: number;
  epochs: number;
  lr: number;
  maxFeatures?: number;
}

const CONFIG: Record<ModelKind, Config> = {
  severity: { hidden: [96, 48], dropout: 0.2, epochs: 40, lr: 0.008 },
  issueType: { hidden: [96, 48], dropout: 0.25, epochs: 24, lr: 0.005, maxFeatures: 500 },
  fixSuccess: { hidden: [48, 24], dropout: 0.2, epochs: 40, lr: 0.006 },
  alt: { hidden: [128, 64], dropout: 0.25, epochs: 24, lr: 0.005, maxFeatures: 600 },
  link: { hidden: [64, 32], dropout: 0.25, epochs: 20, lr: 0.005, maxFeatures: 400 },
};

function groupIndicesFor(kind: ModelKind): Record<string, number[]> | null {
  if (kind === "severity") return severityGroupIndices();
  if (kind === "fixSuccess") return fixFeatureGroupIndices();
  return null;
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

interface CacheEntry {
  model: import("@tensorflow/tfjs").LayersModel;
  meta: TrainedModel;
}

const cache: Partial<Record<ModelKind, CacheEntry>> = {};

async function predictMatrix(model: import("@tensorflow/tfjs").LayersModel, x: number[][]): Promise<number[][]> {
  const tf = await loadTf();
  const tensor = tf.tensor2d(x);
  const out = model.predict(tensor) as Tensor;
  const probs = (await out.array()) as number[][];
  tensor.dispose();
  out.dispose();
  return probs;
}

export async function trainModel(kind: ModelKind, onEpoch?: (p: EpochPoint) => void): Promise<TrainedModel> {
  const tf = await loadTf();
  const started = performance.now();
  const cfg = CONFIG[kind];
  const data = prepare(kind);
  if (data.rows < 30) throw new Error(`Not enough examples to train ${MODEL_NAMES[kind]} (${data.rows}).`);
  const seed = SPLIT_SEEDS[kind];
  const split = groupedSplit(data.keys, seed);

  let vectoriser: Vectoriser | undefined;
  let encode: (idx: number[]) => number[][];
  if (data.text) {
    vectoriser = new Vectoriser(cfg.maxFeatures).fit(split.train.map((i) => data.text![i]));
    encode = (idx) => idx.map((i) => vectoriser!.transform(data.text![i]));
  } else {
    encode = (idx) => idx.map((i) => data.features![i]);
  }
  const labels = (idx: number[]) => idx.map((i) => data.labels[i]);

  const xTrainArr = encode(split.train);
  const xValArr = encode(split.val);
  const xTestArr = encode(split.test);
  const dim = xTrainArr[0].length;

  const xTrain = tf.tensor2d(xTrainArr);
  const yTrain = tf.oneHot(tf.tensor1d(labels(split.train), "int32"), data.classes.length);
  const xVal = tf.tensor2d(xValArr);
  const yVal = tf.oneHot(tf.tensor1d(labels(split.val), "int32"), data.classes.length);

  const model = tf.sequential();
  cfg.hidden.forEach((units, i) => {
    model.add(tf.layers.dense({ units, activation: "relu", inputShape: i === 0 ? [dim] : undefined }));
    model.add(tf.layers.dropout({ rate: cfg.dropout }));
  });
  model.add(tf.layers.dense({ units: data.classes.length, activation: "softmax" }));
  model.compile({ optimizer: tf.train.adam(cfg.lr), loss: "categoricalCrossentropy", metrics: ["accuracy"] });

  const history: EpochPoint[] = [];
  await model.fit(xTrain, yTrain, {
    epochs: cfg.epochs,
    batchSize: 32,
    shuffle: true,
    validationData: [xVal, yVal],
    callbacks: {
      onEpochEnd: async (epoch, logs) => {
        const point: EpochPoint = {
          epoch: epoch + 1,
          loss: Number(logs?.loss ?? 0),
          acc: Number(logs?.acc ?? logs?.accuracy ?? 0),
          valLoss: Number(logs?.val_loss ?? 0),
          valAcc: Number(logs?.val_acc ?? logs?.val_accuracy ?? 0),
        };
        history.push(point);
        onEpoch?.(point);
        await tf.nextFrame();
      },
    },
  });
  xTrain.dispose();
  yTrain.dispose();
  xVal.dispose();
  yVal.dispose();

  // ---- Final metrics on the untouched test split ------------------------
  const testTrue = labels(split.test);
  const testProbs = await predictMatrix(model, xTestArr);
  const core = evaluateMetrics(data.classes, testTrue, testProbs.map(argmax));

  // ---- Permutation importance on the validation split --------------------
  let importance: ModelMetrics["importance"];
  const groups = groupIndicesFor(kind);
  if (groups && xValArr.length) {
    const valTrue = labels(split.val);
    const baseAcc = evaluateMetrics(data.classes, valTrue, (await predictMatrix(model, xValArr)).map(argmax)).accuracy;
    const rnd = mulberry32(99);
    importance = [];
    for (const [group, cols] of Object.entries(groups)) {
      const order = shuffle(Array.from({ length: xValArr.length }, (_, i) => i), rnd);
      const shuffled = xValArr.map((row, r) => {
        const copy = [...row];
        cols.forEach((c) => {
          copy[c] = xValArr[order[r]][c];
        });
        return copy;
      });
      const acc = evaluateMetrics(data.classes, valTrue, (await predictMatrix(model, shuffled)).map(argmax)).accuracy;
      importance.push({ feature: group, delta: baseAcc - acc });
    }
    importance.sort((a, b) => b.delta - a.delta);
  }

  const minSupport = Math.min(...core.perClass.map((c) => c.support));
  const metrics: ModelMetrics = {
    ...core,
    classes: data.classes,
    trainSize: split.train.length,
    valSize: split.val.length,
    testSize: split.test.length,
    groups: split.groups,
    seed,
    evaluatedOn: "test",
    smallSample: split.test.length < 150 || minSupport < 20,
    epochs: cfg.epochs,
    featureDim: dim,
    architecture: `Dense(${cfg.hidden.join(`) → Dropout(${cfg.dropout}) → Dense(`)}) → Dropout(${cfg.dropout}) → Dense(${data.classes.length}, softmax)`,
    durationMs: Math.round(performance.now() - started),
    importance,
  };

  await model.save(MODEL_URL[kind]);
  const trainedAt = new Date().toISOString();
  persist(kind, { schema: SCHEMA_VERSION, classes: data.classes, metrics, history, vectoriser: vectoriser?.toJSON(), trainedAt });
  cache[kind]?.model.dispose();
  cache[kind] = { model, meta: { kind, name: MODEL_NAMES[kind], classes: data.classes, metrics, history, vectoriser, trainedAt } };
  return cache[kind]!.meta;
}

function persist(kind: ModelKind, data: Persisted): void {
  try {
    localStorage.setItem(STORE_PREFIX + kind, JSON.stringify(data));
  } catch {
    /* storage may be unavailable — training still works for this session */
  }
}

function readPersisted(kind: ModelKind): Persisted | null {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + kind);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    // Validate shape and schema: anything stale or malformed is ignored.
    if (
      parsed.schema !== SCHEMA_VERSION ||
      !Array.isArray(parsed.classes) ||
      !parsed.metrics ||
      typeof parsed.metrics.accuracy !== "number" ||
      !Array.isArray(parsed.history)
    ) {
      return null;
    }
    return parsed as Persisted;
  } catch {
    return null;
  }
}

/** Load a previously trained model from IndexedDB, if one exists. */
export async function loadModel(kind: ModelKind): Promise<TrainedModel | null> {
  if (cache[kind]) return cache[kind]!.meta;
  const persisted = readPersisted(kind);
  if (!persisted) return null;
  try {
    const tf = await loadTf();
    const model = await tf.loadLayersModel(MODEL_URL[kind]);
    const inputDim = (model.inputs[0].shape[1] as number | null) ?? -1;
    if (inputDim !== persisted.metrics.featureDim) {
      model.dispose();
      return null;
    }
    const meta: TrainedModel = {
      kind,
      name: MODEL_NAMES[kind],
      classes: persisted.classes,
      metrics: persisted.metrics,
      history: persisted.history,
      trainedAt: persisted.trainedAt,
      vectoriser: persisted.vectoriser ? Vectoriser.fromJSON(persisted.vectoriser) : undefined,
    };
    cache[kind] = { model, meta };
    return meta;
  } catch {
    return null;
  }
}

export async function loadAllModels(): Promise<Partial<Record<ModelKind, TrainedModel>>> {
  const entries = await Promise.all(ALL_MODEL_KINDS.map(async (kind) => [kind, await loadModel(kind)] as const));
  return Object.fromEntries(entries.filter(([, meta]) => meta)) as Partial<Record<ModelKind, TrainedModel>>;
}

export async function resetModel(kind: ModelKind): Promise<void> {
  const tf = await loadTf();
  try {
    await tf.io.removeModel(MODEL_URL[kind]);
  } catch {
    /* nothing stored yet */
  }
  cache[kind]?.model.dispose();
  delete cache[kind];
  try {
    localStorage.removeItem(STORE_PREFIX + kind);
  } catch {
    /* ignore */
  }
}

export function isTrained(kind: ModelKind): boolean {
  return Boolean(cache[kind]);
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

async function predictVector(kind: ModelKind, vector: number[]): Promise<Prediction | null> {
  const entry = cache[kind];
  if (!entry) return null;
  const probs = (await predictMatrix(entry.model, [vector]))[0];
  return { label: entry.meta.classes[argmax(probs)], probabilities: probs, classes: entry.meta.classes };
}

export async function predictText(kind: "alt" | "link" | "issueType", text: string): Promise<Prediction | null> {
  const entry = cache[kind];
  if (!entry?.meta.vectoriser) return null;
  return predictVector(kind, entry.meta.vectoriser.transform(text));
}

export async function predictSeverity(row: SeverityRow): Promise<Prediction | null> {
  return predictVector("severity", severityFeatures(row));
}

/** Returns null when the rule is outside the fix model's training coverage. */
export async function predictFixSuccess(input: FixSuccessInput): Promise<Prediction | null> {
  if (!FIX_MODEL_RULES.includes(input.ruleId)) return null;
  return predictVector("fixSuccess", fixSuccessFeatures(input));
}

/**
 * Local occlusion sensitivity for one severity prediction: each feature group
 * is zeroed and the drop in the predicted class's probability is measured.
 * This is a real computed perturbation, not an exact additive attribution.
 */
export async function explainSeverity(row: SeverityRow): Promise<{ label: string; base: number; groups: { feature: string; delta: number }[] } | null> {
  const entry = cache.severity;
  if (!entry) return null;
  const base = severityFeatures(row);
  const groups = severityGroupIndices();
  const variants = [base, ...Object.values(groups).map((cols) => base.map((v, i) => (cols.includes(i) ? 0 : v)))];
  const probs = await predictMatrix(entry.model, variants);
  const top = argmax(probs[0]);
  return {
    label: entry.meta.classes[top],
    base: probs[0][top],
    groups: Object.keys(groups)
      .map((feature, i) => ({ feature, delta: probs[0][top] - probs[i + 1][top] }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
  };
}

/** Re-run the test-split evaluation for a trained model (same split, same seed). */
export async function evaluateOnHoldout(kind: ModelKind): Promise<ModelMetrics | null> {
  const entry = cache[kind];
  if (!entry) return null;
  const data = prepare(kind);
  const split = groupedSplit(data.keys, SPLIT_SEEDS[kind]);
  const x = split.test.map((i) => (data.text ? entry.meta.vectoriser!.transform(data.text[i]) : data.features![i]));
  const probs = await predictMatrix(entry.model, x);
  const trueIdx = split.test.map((i) => data.labels[i]);
  return { ...entry.meta.metrics, ...evaluateMetrics(entry.meta.classes, trueIdx, probs.map(argmax)), testSize: split.test.length };
}

/** Dataset statistics for the Datasets page, computed from the real builders. */
export function datasetSummary(kind: ModelKind) {
  const data = prepare(kind);
  const split = groupedSplit(data.keys, SPLIT_SEEDS[kind]);
  const distribution = data.classes.map((label, i) => ({ label, count: data.labels.filter((l) => l === i).length }));
  const trainKeys = new Set(split.train.map((i) => data.keys[i]));
  const leaked = split.test.filter((i) => trainKeys.has(data.keys[i])).length;
  return {
    rows: data.rows,
    classes: data.classes,
    distribution,
    groups: split.groups,
    train: split.train.length,
    val: split.val.length,
    test: split.test.length,
    seed: SPLIT_SEEDS[kind],
    leakedTestRows: leaked,
  };
}
