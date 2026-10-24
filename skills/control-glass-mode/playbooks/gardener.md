# Playbook: Dune Gardener & Tech Debt Elimination (`gardener.md`)

Copy this checklist verbatim before writing any code:

- [ ] **Step 1: Identify the Anti-Pattern ("Spot the Weed")**
  - Locate workarounds, loose primitives, boundary leaks, or unsafe patterns in `src/`.
- [ ] **Step 2: Refactor to Single Paved Path**
  - Replace raw primitives or unsafe casts with validated Branded Types and `Result<T, E>` from `src/core/contracts.ts`.
- [ ] **Step 3: Encode AST Lint Rule Immediately ("Stop the Bleeding")**
  - Add a deterministic TypeScript AST rule in `src/harness/dune-linter.ts` or pattern in `src/harness/safety-gate.ts` so Agents can never copy the bad pattern again.
- [ ] **Step 4: Verify Across Entire Codebase**
  - Run `npx control-glass verify` (`npm run verify`) to prove zero violations across all files.
