---
name: deslop
description: Deterministic AST Slop Detector & Cleaner (upgrades pstack /unslop with real TypeScript compiler scanning and auto-stripping).
---

# Deterministic `/deslop` Skill

Run `npx control-glass deslop --fix` (or `npm run deslop -- --fix`) to automatically strip comments, detect empty catch blocks, and flag leftover debugger statements via the TypeScript AST compiler.
