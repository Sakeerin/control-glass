# Playbook: Empirical Performance & Heap Hill-Climbing (`perf.md`)

Copy this checklist verbatim when optimizing performance or eliminating memory leaks:

- [ ] **Step 1: Baseline Empirical Measurement**
  - Run `npx control-glass bench` (`npm run bench`) and record baseline `totalDurationMs`, `opsPerSecond`, and `heapDeltaBytes` from `.control-glass/bench-latest.json`.
- [ ] **Step 2: Lock Correctness Contracts**
  - Verify `npx control-glass tdd-check` (`npm run guard:tdd`) passes so performance changes cannot silently break domain correctness.
- [ ] **Step 3: Single Paved Path Optimization (Hill-Climbing)**
  - Apply one atomic optimization at a time in `src/`.
  - Re-run `npx control-glass bench` after each change.
  - **Atomic Rollback Rule:** If `opsPerSecond` regresses or `heapDeltaBytes` increases without justification, revert the change immediately.
- [ ] **Step 4: Full 6-Gate Verification**
  - Run `npx control-glass verify` (`npm run verify`) to confirm Typecheck, Dune AST Linter, Safety Gate, TDD Lock, and Unit Tests all pass alongside the improved benchmark.
