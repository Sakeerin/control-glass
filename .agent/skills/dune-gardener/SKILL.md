---
name: dune-gardener
description: Playbook for the "Gardener" role—identifying anti-patterns, eliminating tech debt, and immediately encoding new AST lint rules in dune-linter.ts to stop the bleeding.
---

# Dune Gardener Skill ("Stop the Bleeding")

> *"Codebase is the best form of memory. If a workaround exists, Agents will copy and spread it like a virus."*

Use this skill when course-correcting an AI Agent mistake or refactoring legacy code.

## Gardener Workflow
1. **Spot the Weed (Anti-Pattern):** Identify where an Agent or developer used a workaround, weak type, or boundary violation.
2. **Delete Tech Debt:** Refactor the offending code to follow the **Single Paved Path** (`Brand<T>`, `Result<T, E>`, pure functions).
3. **Stop the Bleeding (Write an AST Rule Immediately):**
   - Open `src/harness/dune-linter.ts`.
   - Add a deterministic TypeScript AST check in `checkAstRules` so the anti-pattern can never be committed again.
4. **Verify:** Run `npm run verify` to ensure the entire codebase complies with the new rule.
