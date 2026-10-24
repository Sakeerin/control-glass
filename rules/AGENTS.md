# Control Glass Plugin Rules (Michelin Kitchen & Bottleneck-Free Guardrails)

When this plugin is active, enforce the **Control Glass** engineering principles across all tasks:

1. **Front-Door Router (`/control-glass-mode`):**
   - Match the user's goal against the playbooks in `skills/control-glass-mode/playbooks/` (`feature.md`, `bug.md`, `gardener.md`, `review.md`).
   - Copy the selected playbook's checklist steps verbatim before writing code.
2. **Phase 1 — Context & Locked TDD:**
   - Read `feature-map.json` and `AGENTS.md` first.
   - Model domain values with Branded Types (`Brand<T, Name>`) and explicit `Result<T, E>` returns.
   - Never alter locked `*.spec.ts` files during implementation (Anti-Closed-Loop Testing).
3. **Phase 2 — Dune Single Paved Path:**
   - Zero comments in `src/` (`DUNE_NO_COMMENTS`).
   - Strict architectural boundaries (`DUNE_BOUNDARY_VIOLATION`).
   - Zero `any` or unsafe type assertions (`DUNE_NO_EXPLICIT_ANY`).
4. **Phase 3 — Empirical Verification & Tiered Routing:**
   - Always run `npx control-glass verify` (or `npm run verify`) before concluding a task and report the resulting Review Tier (`Tier 0`, `Tier 1`, or `Tier 2`).
