CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'paste',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.audits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  html_source TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  element_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audits_project_idx ON public.audits(project_id);
CREATE INDEX audits_created_idx ON public.audits(created_at DESC);

CREATE TABLE public.issues (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_id UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  wcag_criterion TEXT NOT NULL,
  wcag_level TEXT NOT NULL DEFAULT 'A',
  selector TEXT NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  severity_rule TEXT NOT NULL DEFAULT 'moderate',
  severity_ml TEXT,
  ml_confidence REAL,
  ml_detail JSONB,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX issues_audit_idx ON public.issues(audit_id);

CREATE TABLE public.fixes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  issue_id UUID NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE,
  before_html TEXT NOT NULL DEFAULT '',
  after_html TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fixes_issue_idx ON public.fixes(issue_id);

CREATE TABLE public.remediated_pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_id UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  html_fixed TEXT NOT NULL,
  score_after INTEGER NOT NULL DEFAULT 0,
  issues_after INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX remediated_audit_idx ON public.remediated_pages(audit_id);

CREATE TABLE public.ml_models (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT 'v1',
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  trained_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ml_models_kind_idx ON public.ml_models(kind);

CREATE TABLE public.training_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  model_id UUID NOT NULL REFERENCES public.ml_models(id) ON DELETE CASCADE,
  loss_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  acc_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  val_loss_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  val_acc_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  epochs INTEGER NOT NULL DEFAULT 0,
  train_size INTEGER NOT NULL DEFAULT 0,
  val_size INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX training_runs_model_idx ON public.training_runs(model_id);

CREATE TABLE public.prediction_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  model_kind TEXT NOT NULL,
  audit_id UUID REFERENCES public.audits(id) ON DELETE CASCADE,
  input_text TEXT NOT NULL DEFAULT '',
  probabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  predicted_label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX prediction_logs_created_idx ON public.prediction_logs(created_at DESC);

CREATE TABLE public.dataset_examples (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dataset TEXT NOT NULL,
  text TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX dataset_examples_dataset_idx ON public.dataset_examples(dataset);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audits TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.issues TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.remediated_pages TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ml_models TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_runs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prediction_logs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dataset_examples TO anon, authenticated;
GRANT ALL ON public.projects, public.audits, public.issues, public.fixes, public.remediated_pages, public.ml_models, public.training_runs, public.prediction_logs, public.dataset_examples TO service_role;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remediated_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prediction_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dataset_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open demo access" ON public.projects FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open demo access" ON public.audits FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open demo access" ON public.issues FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open demo access" ON public.fixes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open demo access" ON public.remediated_pages FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open demo access" ON public.ml_models FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open demo access" ON public.training_runs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open demo access" ON public.prediction_logs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open demo access" ON public.dataset_examples FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);