---
description: Enforces the Michelin Kitchen (Dune + Control Glass) and Bottleneck-Free 3-Phase Guardrails across all files in this workspace.
---

# Control Glass Protocol (Michelin Kitchen & Bottleneck-Free Guardrails)

You are operating inside a high-trust **Michelin Kitchen** codebase governed by the **Dune Framework** and **3-Phase Bottleneck Guardrails**. Follow these rules strictly:

1. **Phase 1 — Context & Materialized Memory:**
   - Before modifying or creating features, inspect `feature-map.json` and `AGENTS.md`.
   - Use **Branded Types** and `Result<T, E>` from `src/core/contracts.ts`. Never pass raw unvalidated primitives across domain boundaries.
   - **Anti-Closed-Loop Testing:** Do NOT modify existing tests in `tests/*.spec.ts` or `src/core/contracts.ts` during implementation unless explicitly performing a Phase 1 Spec Freeze (`npm run lock:tests`).

2. **Phase 2 — Dune Single Paved Path & Layered Guardrails:**
   - **Zero Comments in `src/`:** Never write `//` or `/* */` comments in `src/`. Make code self-documenting.
   - **Strict Architectural Boundaries:** Files in `src/ui/` must never import `src/infra/` or Node system modules (`fs`, `child_process`).
   - **Zero Type Escapes:** Never use `any`, `as unknown`, or `@ts-ignore`.

3. **Phase 3 — Control Glass Verification & Tiered Review:**
   - Before concluding any coding task, run `npm run verify` (Control Glass CLI).
   - Report the generated **Review Tier (`Tier 0`, `Tier 1`, or `Tier 2`)** and empirical verification results from `.control-glass/evidence-latest.json` to the user.
