Route this task through the Control Glass engineering workflow:
1. Read `feature-map.json` and `skills/control-glass-mode/SKILL.md`.
2. Match the request to `skills/control-glass-mode/playbooks/` (`feature.md`, `bug.md`, `perf.md`, `gardener.md`, or `review.md`) and copy the checklist verbatim.
3. Enforce Branded Types (`src/core/contracts.ts`), zero comments in `src/`, and SHA-256 TDD locks (`npx control-glass lock`).
4. Run `npx control-glass verify` and report the empirical verification result and Review Tier (`Tier 0 | Tier 1 | Tier 2`).
