---
name: control-glass-verify
description: Runs the Control Glass Verification CLI to collect empirical evidence, validate AST/Safety/TDD gates, and classify PR Review Tiers.
---

# Control Glass Verification Skill

Use this skill to empirically verify application correctness and generate a machine-verifiable trust artifact before finishing any task.

## Execution Procedure
1. Execute the Control Glass CLI:
   ```bash
   npx control-glass verify
   ```
2. Inspect `.control-glass/evidence-latest.json` to review:
   - `gates.typecheck` (Level 1 Type & Branded Contract soundness)
   - `gates.duneAstLinter` (Level 2 No-Comment & Boundary enforcement)
   - `gates.safetyAndSecretGate` (Phase 2 Secret & Destructive command prevention)
   - `gates.tddContractLock` (Phase 1 Anti-Closed-Loop Testing integrity)
   - `gates.unitAndContractTests` (Empirical test execution)
   - `phase3Orchestration` (Tier 0 / Tier 1 / Tier 2 routing decision)
3. If any gate fails, remediate the root cause in the implementation code (never bypass linters or weaken tests) and re-run `npx control-glass verify` until `overallPassed: true`.
