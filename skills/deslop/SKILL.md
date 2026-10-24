---
name: deslop
description: Deterministic AST Slop Detector & Cleaner (upgrades pstack /unslop with real TypeScript compiler scanning and auto-stripping).
---

# Deterministic `/deslop` Skill

Unlike prompt-only `/unslop` skills that ask an LLM to eyeball a diff, `/deslop` runs an executable TypeScript AST scanner (`src/harness/deslop.ts`) to eradicate AI slop deterministically.

## Execution Procedure
1. Run the AST Deslop Engine with auto-fix enabled:
   ```bash
   npx control-glass deslop --fix
   ```
   *(Or `npm run deslop -- --fix` inside this repository).*
2. What the AST Engine automatically strips and checks:
   - **Auto-Strips Band-Aid Comments (`COMMENT_SLOP`):** Removes all single-line (`//`) and multi-line (`/* */`) comments while preserving shebangs (`#!`).
   - **Blocks Empty Catch Blocks (`EMPTY_CATCH_BLOCK`):** Flags `catch {}` blocks that silently swallow errors instead of returning `Result<T, E>`.
   - **Blocks Leftover Debuggers (`DEBUG_LEFTOVER`):** Flags `debugger` statements.
3. Review `git diff` to ensure no dead exports or unnecessary wrapper functions remain, then run `npx control-glass verify`.
