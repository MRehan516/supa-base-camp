/**
 * Application context: user settings, the loaded models, and the verification
 * console. Everything here is browser-only state; it hydrates after mount so
 * server rendering stays deterministic.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { DatasetService, MlService, setTraceSink } from "./services";
import {
  ALL_MODEL_KINDS,
  loadAllModels,
  resetModel,
  setUserExamples,
  type EpochPoint,
  type ModelKind,
  type TrainedModel,
} from "./ml/engine";

export type ThemeName = "paper" | "contrast";

interface Settings {
  theme: ThemeName;
  fontScale: number;
  trainOnStartup: boolean;
  verification: boolean;
}

const DEFAULTS: Settings = { theme: "paper", fontScale: 100, trainOnStartup: false, verification: false };
const SETTINGS_KEY = "accesslens.settings";

interface AppContextValue {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  models: Partial<Record<ModelKind, TrainedModel>>;
  training: ModelKind | null;
  liveEpochs: EpochPoint[];
  train: (kind: ModelKind) => Promise<TrainedModel | null>;
  trainAll: () => Promise<void>;
  reset: (kind: ModelKind) => Promise<void>;
  modelsReady: boolean;
  hydrated: boolean;
  console: string[];
  clearConsole: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [models, setModels] = useState<Partial<Record<ModelKind, TrainedModel>>>({});
  const [training, setTraining] = useState<ModelKind | null>(null);
  const [liveEpochs, setLiveEpochs] = useState<EpochPoint[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const startupRan = useRef(false);

  // Restore settings and any model persisted from an earlier visit.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) setSettings({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) });
    } catch {
      /* first visit */
    }
    void (async () => {
      const loaded = await loadAllModels();
      setModels(loaded);
      setHydrated(true);
    })();
    void (async () => {
      try {
        const rows = await DatasetService.list();
        setUserExamples(rows.map((row) => ({ dataset: row.dataset, text: row.text, label: row.label })));
      } catch {
        /* the datasets page reports failures */
      }
    })();
  }, []);

  // Persist settings and reflect them on the document.
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
    const root = document.documentElement;
    root.setAttribute("data-theme", settings.theme);
    root.style.setProperty("--app-font-size", `${settings.fontScale}%`);
  }, [settings]);

  // Verification mode routes every model call and database write into the panel.
  useEffect(() => {
    if (!settings.verification) {
      setTraceSink(null);
      return;
    }
    setTraceSink((line) => {
      setConsoleLines((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 300));
    });
    return () => setTraceSink(null);
  }, [settings.verification]);

  const train = useCallback(async (kind: ModelKind) => {
    setTraining(kind);
    setLiveEpochs([]);
    try {
      const model = await MlService.train(kind, (point) => setLiveEpochs((prev) => [...prev, point]));
      setModels((prev) => ({ ...prev, [kind]: model }));
      return model;
    } finally {
      setTraining(null);
    }
  }, []);

  const trainAll = useCallback(async () => {
    for (const kind of ALL_MODEL_KINDS) {
      await train(kind);
    }
  }, [train]);

  const reset = useCallback(async (kind: ModelKind) => {
    await resetModel(kind);
    setModels((prev) => {
      const next = { ...prev };
      delete next[kind];
      return next;
    });
  }, []);

  // Optional: train everything on first load when the user asked for it.
  useEffect(() => {
    if (!hydrated || startupRan.current) return;
    startupRan.current = true;
    const missing = ALL_MODEL_KINDS.filter((kind) => !models[kind]);
    if (settings.trainOnStartup && missing.length) void trainAll();
  }, [hydrated, settings.trainOnStartup, models, trainAll]);

  const value = useMemo<AppContextValue>(
    () => ({
      settings,
      updateSettings: (patch) => setSettings((prev) => ({ ...prev, ...patch })),
      models,
      training,
      liveEpochs,
      train,
      trainAll,
      reset,
      modelsReady: ALL_MODEL_KINDS.every((k) => Boolean(models[k])),
      hydrated,
      console: consoleLines,
      clearConsole: () => setConsoleLines([]),
    }),
    [settings, models, training, liveEpochs, train, trainAll, reset, hydrated, consoleLines],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}
