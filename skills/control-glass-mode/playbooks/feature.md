# Playbook: Feature Development (`feature.md`)

Copy this checklist verbatim before writing any code:

- [ ] **Step 1: Context & Materialized Memory Lookup**
  - Read `feature-map.json` and `AGENTS.md` to identify architectural boundaries and risk tier (`Tier 0 | 1 | 2`).
- [ ] **Step 2: Phase 1 Spec Freeze & Branded Contract Design**
  - Define Branded Types (`Brand<T, Name>`) and `Result<T, E>` signatures in `src/core/contracts.ts`.
  - Author red-phase unit and contract tests in `tests/<feature>.spec.ts`.
  - Run `npx control-glass lock` (or `npm run lock:tests`) to freeze SHA-256 hashes in `.control-glass/tdd-lock.json`.
- [ ] **Step 3: Phase 2 Single Paved Path Implementation**
  - Implement the feature in `src/features/` or `src/ui/` without modifying locked test files.
  - Strictly obey Dune rules: zero comments, zero `any`, zero `console.*`, and strict boundary imports.
  - Register the feature entrypoints, tests, and tier in `feature-map.json`.
- [ ] **Step 4: Phase 3 Empirical Verification & Tier Routing**
  - Run `npx control-glass verify` (or `npm run verify`).
  - Report the generated Review Tier (`Tier 0`, `Tier 1`, or `Tier 2`) and empirical evidence summary.
