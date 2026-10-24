---
name: how-why
description: AST-Backed Code Comprehension & Git Intent Tracer (upgrades pstack /how and /why using .control-glass/dependency-graph.json and feature-map.json).
---

# AST-Backed Comprehension (`/how-why`)

Use this skill when the user asks **"how does X work?"** or **"why was Y built this way?"**. Instead of guessing or reading the entire repository, leverage Control Glass's Materialized Memory.

## Procedure
1. **Generate Fresh AST Dependency Graph:**
   ```bash
   npx control-glass map
   ```
2. **Trace Structural Execution (`/how`):**
   - Read `feature-map.json` to identify the feature's `tier`, `riskReason`, `entrypoints`, `contracts`, and `tests`.
   - Read `.control-glass/dependency-graph.json` to trace exact upstream `imports`, downstream `importedBy` consumers, and `exportedSymbols`.
3. **Trace Architectural Intent & Safeguards (`/why`):**
   - Inspect `git log -p -n 5 <file>` and cross-reference with the locked specification in `tests/*.spec.ts` to explain the exact invariant or historical disaster safeguard the code enforces.
