# 03 — Dune Architecture & The 6 Verification Gates

`control-glass` enforces the **Continuum of Control** by pushing rules out of fragile human code reviews (Level 4) and down into **Data Structures (Level 1)** and **Static AST Analysis (Level 2)**.

---

## Level 1: Branded Contracts (`src/core/contracts.ts`)

You can import `Brand`, `Result`, `ok`, and `err` directly from `control-glass`:

```typescript
import { type Brand, type Result, ok, err } from "control-glass";

export typeUserId = Brand<string, "UserId">;
export type Satang = Brand<number, "Satang">;
```

Why? Because in the *Mars Climate Orbiter* disaster, passing a raw `number` allowed Pound-force seconds to mix with Newton-seconds. With `Brand<T, Name>`, passing an unvalidated number or mixing units is a **compile-time error**.

---

## Level 2: Dune AST Linter (`npx control-glass lint`)

`dune-linter.ts` parses your TypeScript files into an Abstract Syntax Tree (AST) and enforces four strict rules:

1. **`DUNE_NO_COMMENTS`**: Zero `//` or `/* */` comments in `src/`. Agents frequently use comments as excuses for band-aid workarounds. Banning comments forces self-explanatory types and small functions.
2. **`DUNE_BOUNDARY_VIOLATION`**: Reads `architecturalBoundaries` from `feature-map.json` and blocks illegal imports (e.g., preventing `src/ui/` from importing `node:fs`, `child_process`, or `src/infra/`).
3. **`DUNE_NO_EXPLICIT_ANY` & `DUNE_NO_TYPE_ASSERTION_ESCAPE`**: Blocks `any`, `as any`, and `as unknown`.
4. **`DUNE_NO_CONSOLE_IN_DOMAIN`**: Blocks `console.*` calls in domain and UI code.

---

## Phase 1 & 2 Guardrails (`npx control-glass tdd-check` & `safety`)

* **Anti-Closed-Loop Testing (`tdd-guard.ts`)**: When an AI writes both code and tests simultaneously, it often weakens the test assertion to make buggy code pass. `npx control-glass lock` records SHA-256 hashes of `tests/*.spec.ts` and `src/core/contracts.ts`. During implementation, any unauthorized edit to those files triggers a `TDD_LOCK` failure.
* **Safety & Secret Gate (`safety-gate.ts`)**: Scans for leaked credentials (`sk-...`, `sk-proj-...`, `ghp_...`, `AKIA...`, private keys) and blocks destructive SQL/shell operations (`DROP TABLE`, `TRUNCATE TABLE`, `rm -rf`, `eval()`).

---

## Phase 3: Tiered Review Orchestrator (`npx control-glass diff`)

To eliminate the 400% Code Review bottleneck, `diff-reviewer.ts` compares `git status` against `feature-map.json` and classifies every change:

| Tier | Criteria | Action |
| :--- | :--- | :--- |
| **Tier 0** | Changes isolated to `Tier 0` features (e.g. `src/ui/`) with 100% gate pass | **Auto-Merge Eligible** (Zero human bottleneck) |
| **Tier 1** | Standard feature changes in `src/features/` | **Task Owner Review** with Diff Consequence summary |
| **Tier 2** | Touches `src/core/contracts.ts`, `src/harness/`, or `Tier 2` critical features | **Senior / Domain Expert Review** + Canary Rollout (`1% -> 10% -> 100%`) |
