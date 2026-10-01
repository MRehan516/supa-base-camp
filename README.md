# AccessLens — ML-Based Web Accessibility Auditor and Remediation System

AccessLens takes a web page's HTML, runs deterministic WCAG 2.1 rule checks on
it, adds judgement from three models trained in the browser, generates concrete
fixes, re-audits the fixed page and stores everything in a cloud Postgres
database.

## Running it

```bash
bun install
bun run dev      # http://localhost:8080
bun run build    # production build
bun run lint
```

The database (Postgres, auth and storage) is provisioned for the project; the
connection values live in `.env` as `VITE_SUPABASE_*`.

## Demonstration script

1. **ML Lab** → "Train all models". Watch the live loss/accuracy curves, then the
   confusion matrix, per-class precision/recall/F1 and permutation importance.
2. **New audit** → "Sample sites" → load *Campus news article* → "Run audit".
   The pipeline panel shows each stage with real timestamps and counts.
3. **Results** → open an issue drawer: snippet, WCAG criterion, rule severity vs
   model severity, the raw probability vector and the feature row fed to the
   severity model.
4. **Fix issues** → edit a suggestion, select fixes, "Apply selected & re-audit".
5. **Before vs after** → score change, remaining issues, side-by-side diff,
   two live previews, download the fixed HTML.
6. **Tests** → "Run all tests" to execute the built-in suites.
7. **Settings** → turn on Verification mode, then run another audit: every model
   inference and database write is printed to the on-page console.

## What is real

- Every rule check parses the supplied HTML and inspects the real DOM.
- Contrast ratios are computed from colours resolved by the browser in a
  sandboxed iframe, using the WCAG relative-luminance formula.
- The three models are trained with TensorFlow.js in your browser. Weights are
  stored in IndexedDB; metrics, training runs and prediction logs are stored in
  the database. Every probability shown is the model's own softmax output.
- Scores come from the published formula on the Methodology page.
- Fix suggestions are derived from real page context (captions, figure text,
  file-name tokens, link targets, resolved colours).

## Honest browser limits

- **Live URLs cannot be fetched.** The browser's same-origin policy blocks
  reading arbitrary third-party pages, so the input page offers paste, file
  upload and bundled sample pages instead.
- **Parsing cannot run in a Web Worker.** `DOMParser` and `getComputedStyle`
  do not exist in worker scope, so parsing and the rendered contrast pass run
  on the main thread and yield between stages to keep the interface responsive.
  TensorFlow.js uses WebGL where the device supports it.
- **Training data is synthetic and curated**, generated from documented
  templates plus hand-written examples. The label rules are printed on the
  Datasets page.
- **Fix suggestions are suggestions.** Anything with low confidence is marked
  "needs human review".
