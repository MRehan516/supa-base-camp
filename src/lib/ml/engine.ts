/**
 * ML engine.
 *
 * Three models, all trained in the browser with TensorFlow.js on the bundled
 * datasets. Nothing is pre-baked: weights come from `model.fit`, metrics come
 * from evaluating the held-out validation split, and every prediction shown in
 * the UI is the raw softmax output of `model.predict`.
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
  severityFeatureNames,
  severityGroupIndices,
  type VectoriserState,
} from "./features";

type Tf = typeof import("@tensorflow/tfjs");

let tfPromise: Promise<Tf> | null = null;
export async function loadTf(): Promise<Tf> {
  if (!tfPromise) tfPromise = import("@tensorflow/tfjs").then((mod) => mod);
  return tfPromise;
}

export type ModelKind = "alt" | "link" | "severity";

export const SEVERITY_CLASSES: Severity[] = ["critical", "serious", "moderate", "minor"];

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
  macroF1: number;
  perClass: PerClassMetric[];
  confusion: number[][];
  trainSize: number;
  valSize: number;
  epochs: number;
  featureDim: number;
  architecture: string;
  durationMs: number;
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
  classes: string[];
  metrics: ModelMetrics;
  history: EpochPoint[];
  vectoriser?: VectoriserState;
  trainedAt: string;
}

const STORE_PREFIX = "accesslens.model.";
const MODEL_URL: Record<ModelKind, string> = {
  alt: "indexeddb://accesslens-alt",
  link: "indexeddb://accesslens-link",
  severity: "indexeddb://accesslens-severity",
};

export const MODEL_NAMES: Record<ModelKind, string> = {
  alt: "Alt-text quality classifier",
  link: "Link-text clarity classifier",
  severity: "Issue severity predictor",
};

function argmax(values: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

function evaluateMetrics(
  classes: string[],
  trueIdx: number[],
  predIdx: number[],
): Pick<ModelMetrics, "accuracy" | "macroF1" | "perClass" | "confusion"> {
  const size = classes.length;
  const confusion = Array.from({ length: size }, () => new Array(size).fill(0));
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
  const macroF1 = perClass.reduce((sum, c) => sum + c.f1, 0) / (size || 1);
  return { accuracy, macroF1, perClass, confusion };
}

function splitIndices(total: number, ratio: number, seed: number): { train: number[]; val: number[] } {
  const all = shuffle(
    Array.from({ length: total }, (_, i) => i),
    mulberry32(seed),
  );
  const cut = Math.floor(total * ratio);
  return { train: all.slice(0, cut), val: all.slice(cut) };
}

interface TrainTextOptions {
  kind: ModelKind;
  classes: string[];
  rows: TextExample[];
  epochs: number;
  hidden: number[];
  maxFeatures: number;
  onEpoch?: (point: EpochPoint) => void;
}

/**
 * The single training routine used by both text models: fit the vectoriser on
 * the training split only (so validation stays honest), build a dense network,
 * fit it, then evaluate on the validation split.
 */
async function trainTextModel(options: TrainTextOptions): Promise<TrainedModel> {
  const tf = await loadTf();
  const started = performance.now();
  const { rows, classes, kind, epochs, hidden, maxFeatures } = options;
  const { train, val } = splitIndices(rows.length, 0.8, 42);

  const vectoriser = new Vectoriser(maxFeatures).fit(train.map((i) => rows[i].text));
  const encode = (idx: number[]) => idx.map((i) => vectoriser.transform(rows[i].text));
  const labelIdx = (idx: number[]) => idx.map((i) => Math.max(0, classes.indexOf(rows[i].label)));

  const xTrain = tf.tensor2d(encode(train));
  const yTrain = tf.oneHot(tf.tensor1d(labelIdx(train), "int32"), classes.length);
  const xVal = tf.tensor2d(encode(val));
  const yVal = tf.oneHot(tf.tensor1d(labelIdx(val), "int32"), classes.length);

  const model = tf.sequential();
  hidden.forEach((units, i) => {
    model.add(
      tf.layers.dense({
        units,
        activation: "relu",
        inputShape: i === 0 ? [vectoriser.dimension] : undefined,
      }),
    );
    model.add(tf.layers.dropout({ rate: 0.25 }));
  });
  model.add(tf.layers.dense({ units: classes.length, activation: "softmax" }));
  model.compile({
    optimizer: tf.train.adam(0.005),
    loss: "categoricalCrossentropy",
    metrics: ["accuracy"],
  });

  const history: EpochPoint[] = [];
  await model.fit(xTrain, yTrain, {
    epochs,
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
        options.onEpoch?.(point);
        await tf.nextFrame();
      },
    },
  });

  const predicted = model.predict(xVal) as import("@tensorflow/tfjs").Tensor;
  const probs = (await predicted.array()) as number[][];
  const metricsCore = evaluateMetrics(classes, labelIdx(val), probs.map(argmax));
  predicted.dispose();

  const metrics: ModelMetrics = {
    ...metricsCore,
    classes,
    trainSize: train.length,
    valSize: val.length,
    epochs,
    featureDim: vectoriser.dimension,
    architecture: `Dense(${hidden.join(") → Dropout(0.25) → Dense(")}) → Dropout(0.25) → Dense(${classes.length}, softmax)`,
    durationMs: Math.round(performance.now() - started),
  };

  await model.save(MODEL_URL[kind]);
  const trainedAt = new Date().toISOString();
  persist(kind, { classes, metrics, history, vectoriser: vectoriser.toJSON(), trainedAt });
  cache[kind] = { model, meta: { kind, name: MODEL_NAMES[kind], classes, metrics, history, vectoriser, trainedAt } };

  xTrain.dispose();
  yTrain.dispose();
  xVal.dispose();
  yVal.dispose();
  return cache[kind]!.meta;
}

interface CacheEntry {
  model: import("@tensorflow/tfjs").LayersModel;
  meta: TrainedModel;
}

const cache: Partial<Record<ModelKind, CacheEntry>> = {};

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
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

export async function trainAltModel(onEpoch?: (p: EpochPoint) => void): Promise<TrainedModel> {
  const rows = [...buildAltDataset(), ...extraExamples("alt")];
  return trainTextModel({
    kind: "alt",
    classes: [...ALT_CLASSES],
    rows,
    epochs: 24,
    hidden: [128, 64],
    maxFeatures: 600,
    onEpoch,
  });
}

export async function trainLinkModel(onEpoch?: (p: EpochPoint) => void): Promise<TrainedModel> {
  const rows = [...buildLinkDataset(), ...extraExamples("link")];
  return trainTextModel({
    kind: "link",
    classes: [...LINK_CLASSES],
    rows,
    epochs: 20,
    hidden: [64, 32],
    maxFeatures: 400,
    onEpoch,
  });
}

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

export async function trainSeverityModel(onEpoch?: (p: EpochPoint) => void): Promise<TrainedModel> {
  const tf = await loadTf();
  const started = performance.now();
  const classes = [...SEVERITY_CLASSES] as string[];
  const dataset = buildSeverityDataset();
  const { train, val } = splitIndices(dataset.length, 0.8, 4242);

  const encode = (idx: number[]) => idx.map((i) => severityFeatures(dataset[i].row));
  const labels = (idx: number[]) => idx.map((i) => Math.max(0, classes.indexOf(dataset[i].label)));

  const xTrainArr = encode(train);
  const xValArr = encode(val);
  const yTrainIdx = labels(train);
  const yValIdx = labels(val);

  const xTrain = tf.tensor2d(xTrainArr);
  const yTrain = tf.oneHot(tf.tensor1d(yTrainIdx, "int32"), classes.length);
  const xVal = tf.tensor2d(xValArr);
  const yVal = tf.oneHot(tf.tensor1d(yValIdx, "int32"), classes.length);

  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 96, activation: "relu", inputShape: [xTrainArr[0].length] }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 48, activation: "relu" }));
  model.add(tf.layers.dense({ units: classes.length, activation: "softmax" }));
  model.compile({ optimizer: tf.train.adam(0.008), loss: "categoricalCrossentropy", metrics: ["accuracy"] });

  const history: EpochPoint[] = [];
  const epochs = 40;
  await model.fit(xTrain, yTrain, {
    epochs,
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

  const baseProbs = (await (model.predict(xVal) as import("@tensorflow/tfjs").Tensor).array()) as number[][];
  const metricsCore = evaluateMetrics(classes, yValIdx, baseProbs.map(argmax));

  // ---- Permutation importance, computed for real -----------------------
  const groups = severityGroupIndices();
  const names = severityFeatureNames();
  const importance: { feature: string; delta: number }[] = [];
  const rnd = mulberry32(99);
  for (const [group, indices] of Object.entries(groups)) {
    const shuffled = xValArr.map((row) => [...row]);
    const order = shuffle(
      Array.from({ length: shuffled.length }, (_, i) => i),
      rnd,
    );
    indices.forEach((col) => {
      order.forEach((sourceRow, targetRow) => {
        shuffled[targetRow][col] = xValArr[sourceRow][col];
      });
    });
    const tensor = tf.tensor2d(shuffled);
    const probs = (await (model.predict(tensor) as import("@tensorflow/tfjs").Tensor).array()) as number[][];
    tensor.dispose();
    const permuted = evaluateMetrics(classes, yValIdx, probs.map(argmax)).accuracy;
    importance.push({ feature: group, delta: metricsCore.accuracy - permuted });
  }
  importance.sort((a, b) => b.delta - a.delta);
  void names;

  const metrics: ModelMetrics = {
    ...metricsCore,
    classes,
    trainSize: train.length,
    valSize: val.length,
    epochs,
    featureDim: xTrainArr[0].length,
    architecture: "Dense(96) → Dropout(0.2) → Dense(48) → Dense(4, softmax)",
    durationMs: Math.round(performance.now() - started),
    importance,
  };

  await model.save(MODEL_URL.severity);
  const trainedAt = new Date().toISOString();
  persist("severity", { classes, metrics, history, trainedAt });
  cache.severity = {
    model,
    meta: { kind: "severity", name: MODEL_NAMES.severity, classes, metrics, history, trainedAt },
  };

  xTrain.dispose();
  yTrain.dispose();
  xVal.dispose();
  yVal.dispose();
  return cache.severity.meta;
}

/** Load a previously trained model from IndexedDB, if one exists. */
export async function loadModel(kind: ModelKind): Promise<TrainedModel | null> {
  if (cache[kind]) return cache[kind]!.meta;
  const persisted = readPersisted(kind);
  if (!persisted) return null;
  try {
    const tf = await loadTf();
    const model = await tf.loadLayersModel(MODEL_URL[kind]);
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
  const entries = await Promise.all(
    (["alt", "link", "severity"] as ModelKind[]).map(async (kind) => [kind, await loadModel(kind)] as const),
  );
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

async function predictVector(kind: ModelKind, vector: number[]): Promise<Prediction | null> {
  const entry = cache[kind];
  if (!entry) return null;
  const tf = await loadTf();
  const input = tf.tensor2d([vector]);
  const output = entry.model.predict(input) as import("@tensorflow/tfjs").Tensor;
  const probs = ((await output.array()) as number[][])[0];
  input.dispose();
  output.dispose();
  return {
    label: entry.meta.classes[argmax(probs)],
    probabilities: probs,
    classes: entry.meta.classes,
  };
}

export async function predictText(kind: "alt" | "link", text: string): Promise<Prediction | null> {
  const entry = cache[kind];
  if (!entry?.meta.vectoriser) return null;
  return predictVector(kind, entry.meta.vectoriser.transform(text));
}

export async function predictSeverity(row: SeverityRow): Promise<Prediction | null> {
  return predictVector("severity", severityFeatures(row));
}

/** Re-evaluate a trained model on its held-out validation split. */
export async function evaluateOnHoldout(kind: ModelKind): Promise<ModelMetrics | null> {
  const entry = cache[kind];
  if (!entry) return null;
  const tf = await loadTf();
  const classes = entry.meta.classes;

  if (kind === "severity") {
    const dataset = buildSeverityDataset();
    const { val } = splitIndices(dataset.length, 0.8, 4242);
    const x = tf.tensor2d(val.map((i) => severityFeatures(dataset[i].row)));
    const probs = (await (entry.model.predict(x) as import("@tensorflow/tfjs").Tensor).array()) as number[][];
    x.dispose();
    const trueIdx = val.map((i) => Math.max(0, classes.indexOf(dataset[i].label)));
    return { ...entry.meta.metrics, ...evaluateMetrics(classes, trueIdx, probs.map(argmax)) };
  }

  const rows = kind === "alt" ? buildAltDataset() : buildLinkDataset();
  const { val } = splitIndices(rows.length, 0.8, 42);
  const vectoriser = entry.meta.vectoriser!;
  const x = tf.tensor2d(val.map((i) => vectoriser.transform(rows[i].text)));
  const probs = (await (entry.model.predict(x) as import("@tensorflow/tfjs").Tensor).array()) as number[][];
  x.dispose();
  const trueIdx = val.map((i) => Math.max(0, classes.indexOf(rows[i].label)));
  return { ...entry.meta.metrics, ...evaluateMetrics(classes, trueIdx, probs.map(argmax)) };
}
