-- Issue metadata, evidence, provenance and human review
ALTER TABLE public.issues
  ADD COLUMN IF NOT EXISTS issue_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS wcag_principle text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS auto_fixable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS human_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evidence jsonb,
  ADD COLUMN IF NOT EXISTS detection_source text NOT NULL DEFAULT 'rule',
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

UPDATE public.issues SET status = 'applied' WHERE status = 'fixed';
UPDATE public.issues SET detection_source = 'model'
  WHERE rule_id = 'link-vague' OR (rule_id = 'img-alt-poor' AND message LIKE 'The alt-text model%');

ALTER TABLE public.issues
  ADD CONSTRAINT issues_status_check
  CHECK (status IN ('open','suggested','applied','verified','rejected','needs_review'));
ALTER TABLE public.issues
  ADD CONSTRAINT issues_source_check CHECK (detection_source IN ('rule','model'));

CREATE INDEX IF NOT EXISTS issues_status_idx ON public.issues(status);
CREATE INDEX IF NOT EXISTS issues_rule_idx ON public.issues(rule_id);

-- Fix review state, model prediction and real verification outcome
ALTER TABLE public.fixes
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'applied',
  ADD COLUMN IF NOT EXISTS edited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS predicted_success real,
  ADD COLUMN IF NOT EXISTS verification text,
  ADD COLUMN IF NOT EXISTS remediated_page_id uuid REFERENCES public.remediated_pages(id) ON DELETE CASCADE;

ALTER TABLE public.fixes
  ADD CONSTRAINT fixes_status_check CHECK (status IN ('suggested','applied','rejected','failed'));
ALTER TABLE public.fixes
  ADD CONSTRAINT fixes_verification_check
  CHECK (verification IS NULL OR verification IN ('resolved','not_resolved','partially_resolved'));

CREATE INDEX IF NOT EXISTS fixes_remediated_idx ON public.fixes(remediated_page_id);

-- Store the full re-audit result so before/after transitions are reproducible
ALTER TABLE public.remediated_pages
  ADD COLUMN IF NOT EXISTS after_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS element_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS prediction_logs_audit_idx ON public.prediction_logs(audit_id);
CREATE INDEX IF NOT EXISTS prediction_logs_kind_idx ON public.prediction_logs(model_kind);
CREATE INDEX IF NOT EXISTS ml_models_trained_idx ON public.ml_models(trained_at DESC);