# 01 — Getting Started with `control-glass`

`control-glass` is both an **AI Agent Plugin** (for Cursor / Antigravity) and an **Executable CLI / TypeScript Harness** (`npx control-glass`) that any developer can install into their own repository.

It transforms AI coding agents from "slop generators" into disciplined **Michelin Kitchen** engineers governed by deterministic AST rules, SHA-256 TDD locks, and Tiered Review routing.

---

## 1. Install as an AI Editor Plugin (Cursor / Antigravity)

You can install `control-glass` as a global plugin so `/control-glass-mode` and its companion skills are available across all your projects:

### Option A: Clone into Global Plugins Directory
```bash
git clone https://github.com/Sakeerin/control-glass.git ~/.gemini/config/plugins/control-glass
```
*(For Cursor plugins directory, clone or symlink into `.cursor/plugins/control-glass` or your workspace `.agent/` folder).*

Once installed, restart your editor to discover:
- **`/control-glass-mode`** — Front-door task router & playbook orchestrator
- **`setup-control-glass`** — One-command project bootstrapper
- **`pac-tdd-workflow`** — Contract-first & SHA-256 locked TDD workflow
- **`control-glass-verify`** — 6-gate empirical verification runner
- **`dune-gardener`** — Anti-pattern elimination & AST rule authoring
- **`diff-consequence-reviewer`** — Automated Tier 0 / Tier 1 / Tier 2 PR triage

---

## 2. Install as a CLI & Library in Your TypeScript Project

To enforce the 6 deterministic gates (Typecheck, Dune AST Linter, Safety/Secret Gate, TDD Immutability Lock, Vitest, and Tiered Diff Routing) in your own project:

```bash
npm install --save-dev github:Sakeerin/control-glass
```

Then initialize `control-glass` in your repository root:

```bash
npx control-glass init
```

This automatically creates:
1. **`feature-map.json`** — Materialized Memory defining your architectural boundaries (`ui`, `features`, `core`) and feature risk tiers (`Tier 0 | 1 | 2`).
2. **`AGENTS.md`** — Concise contract file instructing AI agents on allowed commands and non-negotiable rules.
3. **`.control-glass/tdd-lock.json`** — Initial SHA-256 cryptographic lock manifest for your test suite and contracts.

---

## 3. Run the Verification Pipeline

At any time (or inside your CI pipeline), run:

```bash
npx control-glass verify
```

Next: Read **[02 — Route Work Through `/control-glass-mode`](./02-control-glass-mode.md)** to learn how to prompt your agent effectively.
