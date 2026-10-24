# 04 — Multi-Vendor AI Support (Claude, OpenAI, Gemini, Cursor, Copilot, Windsurf & MCP)

`control-glass` is 100% vendor-agnostic. Whether a developer on your team uses **Anthropic Claude Code**, **OpenAI Codex / ChatGPT**, **Google Gemini / Antigravity**, **Cursor**, **GitHub Copilot**, or **Windsurf**, `control-glass` enforces the exact same **Michelin Kitchen** playbooks and 6 deterministic verification gates.

---

## 1. One-Command Multi-Vendor Config Sync (`npx control-glass sync-vendors`)

Different AI agents read different instruction files and slash-command directories. Running:

```bash
npx control-glass sync-vendors
```
*(or `npx control-glass init`)* automatically generates and keeps in sync:

| AI Vendor / Tool | Generated Files | How to Use |
| :--- | :--- | :--- |
| **Anthropic Claude Code** | `CLAUDE.md`<br>`.claude/commands/control-glass-mode.md`<br>`.claude/commands/interrogate.md`<br>`.claude/commands/deslop.md`<br>`.claude/commands/arena.md` | Type `/project:control-glass-mode`, `/project:interrogate`, `/project:deslop`, or `/project:arena` directly inside Claude Code CLI |
| **OpenAI Codex / Agents** | `AGENTS.md` | Automatically loaded by OpenAI Codex CLI and OpenAI Agents |
| **Cursor IDE** | `.cursor/rules/control-glass.mdc`<br>`plugin.json` | Automatically active across all files (`alwaysApply: true`) + `/control-glass-mode` skill |
| **GitHub Copilot** | `.github/copilot-instructions.md` | Automatically injected into GitHub Copilot Chat & Workspace |
| **Windsurf** | `.windsurfrules` | Automatically enforced by Windsurf Cascade agent |
| **Google Antigravity** | `.agent/rules/` & `.agent/skills/`<br>`plugin.json` | Native plugin & skill integration (`/control-glass-mode`) |

---

## 2. Universal MCP Server (`npx control-glass mcp`)

Any AI desktop app, IDE, or agent framework that supports the **Model Context Protocol (MCP)**—including **Claude Desktop**, **Claude Code**, **OpenAI Agents SDK**, **Cursor**, and **Antigravity**—can connect to `control-glass` as a native MCP tool server.

Add this to your client's `mcp_config.json` or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "control-glass": {
      "command": "npx",
      "args": ["control-glass", "mcp"]
    }
  }
}
```

### Exposed MCP Native Tools:
- `control_glass_verify_gates` — Runs Dune AST Linter, Safety Gate, TDD SHA-256 Lock, and Diff Tier classification.
- `control_glass_map_dependencies` — Builds the AST Dependency & Export Graph (`.control-glass/dependency-graph.json`).
- `control_glass_deslop` — Scans and strips AI comment slop and empty catch blocks.
- `control_glass_diff_tier` — Computes blast radius and returns `Tier 0`, `Tier 1`, or `Tier 2`.
- `control_glass_lock_tests` — Freezes SHA-256 hashes of tests and contracts.
- `control_glass_bench` — Runs empirical ops/sec and V8 heap benchmarks.

---

## 3. Multi-Vendor LLM Gateway API (`src/vendors/llm-gateway.ts`)

For programmatic multi-model workflows (such as pitting **Claude** against **OpenAI GPT** or **Google Gemini** in `/arena` or running cross-vendor `/interrogate` reviews), import the type-safe gateway directly from `control-glass`:

```typescript
import {
  createVendorModelConfig,
  buildVendorRequestPayload,
  createNonEmptyText
} from "control-glass";

const claude = createVendorModelConfig("anthropic", "claude-3-7-sonnet-latest");
const openai = createVendorModelConfig("openai", "gpt-4o");
const gemini = createVendorModelConfig("gemini", "gemini-2.5-pro");
const localOllama = createVendorModelConfig("openai-compatible", "deepseek-r1");
```

Check active vendor environment keys at any time via:
```bash
npx control-glass vendors
```
