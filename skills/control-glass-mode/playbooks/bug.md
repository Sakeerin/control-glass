# Playbook: Bug Investigation & Fix (`bug.md`)

Copy this checklist verbatim before writing any code:

- [ ] **Step 1: Materialized Memory & Blast Radius Trace**
  - Locate the affected feature in `feature-map.json` via its entrypoint, contract, or DOM selector.
- [ ] **Step 2: Deterministic Reproduction (Red Test Lock)**
  - Add a failing reproduction test in `tests/*.spec.ts` that captures the exact bug.
  - Freeze the updated test suite using `npx control-glass lock` (`npm run lock:tests`).
- [ ] **Step 3: Root-Cause Fix & Atomic Rollback Discipline**
  - Fix the root cause in `src/` without touching the locked test file and without adding band-aid comments.
  - If a hypothesis fails, revert the exploratory changes completely before trying another approach.
- [ ] **Step 4: Stop the Bleeding (Optional Gardener Escalation)**
  - If the bug was caused by a structural anti-pattern, add an AST lint rule in `src/harness/dune-linter.ts`.
- [ ] **Step 5: Control Glass Empirical Verification**
  - Run `npx control-glass verify` (`npm run verify`) and confirm 0 violations and 100% test pass.
