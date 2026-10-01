<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Project rules

## Git

Avoid rewriting published history (no force-pushes, rebases or amends of
commits that are already pushed); the hosting side syncs the connected branch
and rewritten history breaks that sync.

## Architecture

- Routing is TanStack Router file routes under `src/routes/`; `src/routeTree.gen.ts`
  is generated and must never be edited by hand.
- The UI never queries the database directly. It calls the service layer in
  `src/lib/services.ts`, which mirrors the documented REST contract.
- Audit logic lives in `src/lib/audit/` (rules, colour maths, scoring,
  remediation, pipeline). Rule checks must stay deterministic and free of ML.
- ML lives in `src/lib/ml/` (datasets, feature extraction, TensorFlow.js engine).
  TensorFlow.js is imported lazily so server rendering never loads it.
- All colour, type and shadow values are tokens in `src/styles.css`. Components
  must not hardcode colour utilities.
- No fabricated data anywhere: every number rendered must be computed from real
  input by real code.
