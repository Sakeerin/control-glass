# Playbook: Phase 3 Diff & Consequence Review (`review.md`)

Copy this checklist verbatim when reviewing changes or triaging PRs:

- [ ] **Step 1: Automated Diff & Tier Classification**
  - Run `npx control-glass diff` (`npm run review:diff`) to inspect changed files and affected features in `feature-map.json`.
- [ ] **Step 2: Verify TDD & Contract Immutability Lock**
  - Run `npx control-glass tdd-check` (`npm run guard:tdd`) to verify tests were not weakened to pass broken code.
- [ ] **Step 3: Verify Dune AST & Safety Gates**
  - Run `npx control-glass verify` (`npm run verify`) and inspect `.control-glass/evidence-latest.json`.
- [ ] **Step 4: Issue Tiered Routing & Rollout Recommendation**
  - **Tier 0:** Approve for automatic merge (isolated UI/formatting with 100% gate pass).
  - **Tier 1:** Summarize diff consequences for Task Owner review.
  - **Tier 2:** Escalate to Senior Engineer / Domain Expert and mandate Canary rollout (`1% -> 10% -> 100%`).
