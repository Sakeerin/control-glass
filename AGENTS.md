# AGENTS.md — Control Glass (Michelin Kitchen & Bottleneck-Free Contract)

> **Core Principle:** Make the easy path the right path. Do not rely on human babysitting; rely on deterministic verification and strict architectural contracts.

## 1. Allowed Commands (Single Paved Path)
- `npm run verify` — **Control Glass CLI**: Full verification gate (Typecheck + Dune AST Linter + Safety/Secret Gate + TDD Lock Check + Tests + Tiered Risk Classification). **MUST pass before completing any task.**
- `npm run typecheck` — Strict TypeScript compiler check.
- `npm run lint:dune` — Custom AST static analysis (enforces no-comments, architectural boundaries, and anti-pattern rules).
- `npm run guard:safety` — Scans for leaked secrets and dangerous operations.
- `npm run guard:tdd` — Verifies that locked `*.spec.ts` / `*.contract.ts` files were not tampered with during implementation.
- `npm test` — Run unit and contract verification suite.
- `npm run review:diff` — Generates a Diff & Consequence Report and calculates Review Tier (`Tier 0` / `Tier 1` / `Tier 2`).

## 2. Continuum of Control (Non-Negotiable Rules)
1. **Read Materialized Memory First:** Always read `feature-map.json` before locating or modifying features. Update `feature-map.json` when adding new features.
2. **Zero Comments in Source Code (`src/`):** Comments are strictly prohibited by AST Linter. Never write comments as band-aids or excuses for workarounds; make types and function names self-explanatory.
3. **Branded Types & Explicit Contracts:** Raw numbers/strings are forbidden across domain boundaries (e.g., use `NewtonSeconds`, `Satang`, `ValidatedUserId`). Never use `any`, `@ts-ignore`, or `as unknown as`.
4. **Architectural Boundary Lock:** `src/ui/` (Renderer) MUST NEVER directly import from `src/infra/` or heavy Node modules (`fs`, `child_process`, `crypto`). Communicate only via `src/core/contracts.ts`.
5. **Anti-Closed-Loop Testing (TDD Lock):** Never modify existing test assertions in `tests/` to make broken implementation code pass. Only update test locks via `npm run lock:tests` during an explicit Phase 1 Spec/Requirement Freeze.
6. **Least Privilege:** Never hardcode credentials, tokens, or execute destructive shell/database commands (`DROP TABLE`, `rm -rf`, ` truncate `).

## 3. Progressive Disclosure (Skills & Playbooks)
For detailed workflows, read the skills in `.agent/skills/`:
- `.agent/skills/pac-tdd-workflow/SKILL.md` — Phase 1 Spec Freeze -> Red Test -> Green Implementation.
- `.agent/skills/control-glass-verify/SKILL.md` — Empirical verification & evidence collection.
- `.agent/skills/dune-gardener/SKILL.md` — Eliminating tech debt & writing AST lint rules to "stop the bleeding".
- `.agent/skills/diff-consequence-reviewer/SKILL.md` — Sub-agent Diff analysis & Tiered Review routing.
