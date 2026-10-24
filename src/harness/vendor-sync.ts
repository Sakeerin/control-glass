import fs from "node:fs";
import path from "node:path";

export type SupportedVendorTarget =
  | "claude-code"
  | "openai-codex"
  | "cursor"
  | "github-copilot"
  | "windsurf"
  | "antigravity";

export interface VendorSyncReport {
  readonly syncedTargets: readonly SupportedVendorTarget[];
  readonly generatedFiles: readonly string[];
}

const UNIVERSAL_PROTOCOL_CORE = `# Control Glass — Universal Multi-Vendor Agent Contract

> **Core Principle:** Make the easy path the right path. Do not rely on human babysitting; rely on deterministic verification and strict architectural contracts.

## 1. Primary Router & CLI Commands (Single Paved Path)
- Route tasks through \`/control-glass-mode\` (Playbooks: \`feature.md\`, \`bug.md\`, \`perf.md\`, \`gardener.md\`, \`review.md\`).
- \`npx control-glass verify\` (or \`npm run verify\`) — Full 6-gate empirical verification (Typecheck + Dune AST Linter + Safety Gate + TDD SHA-256 Lock + Vitest + Tiered Review Routing). **MUST pass before completing any task.**
- \`npx control-glass map\` — Auto-generate AST Dependency Graph (\`.control-glass/dependency-graph.json\`).
- \`npx control-glass deslop --fix\` — Deterministic AST slop cleaner (strips comments, flags empty catch blocks and debuggers).
- \`npx control-glass lock\` — Freeze SHA-256 hashes of \`tests/*.spec.ts\` and \`src/core/contracts.ts\` during Phase 1 Spec Freeze.
- \`npx control-glass diff\` — Compute blast radius and classify PR Review Tier (\`Tier 0 | Tier 1 | Tier 2\`).

## 2. Non-Negotiable Continuum of Control Rules
1. **Read Materialized Memory First:** Always read \`feature-map.json\` before locating or modifying features.
2. **Zero Comments in \`src/\` (\`DUNE_NO_COMMENTS\`):** Never write \`//\` or \`/* */\` comments in \`src/\`. Make types and function names self-documenting.
3. **Branded Types & Explicit Contracts:** Never pass unvalidated primitives across domain boundaries. Use \`Brand<T, Name>\` and \`Result<T, E>\` from \`src/core/contracts.ts\`. Never use \`any\`, \`@ts-ignore\`, or \`as unknown\`.
4. **Architectural Boundary Lock (\`DUNE_BOUNDARY_VIOLATION\`):** \`src/ui/\` must never import \`src/infra/\` or Node I/O modules (\`fs\`, \`child_process\`).
5. **Anti-Closed-Loop Testing (\`TDD_LOCK\`):** Never modify locked test files in \`tests/\` during implementation to make broken code pass.
`;

const CLAUDE_SLASH_COMMAND_MODE = `Route this task through the Control Glass engineering workflow:
1. Read \`feature-map.json\` and \`skills/control-glass-mode/SKILL.md\`.
2. Match the request to \`skills/control-glass-mode/playbooks/\` (\`feature.md\`, \`bug.md\`, \`perf.md\`, \`gardener.md\`, or \`review.md\`) and copy the checklist verbatim.
3. Enforce Branded Types (\`src/core/contracts.ts\`), zero comments in \`src/\`, and SHA-256 TDD locks (\`npx control-glass lock\`).
4. Run \`npx control-glass verify\` and report the empirical verification result and Review Tier (\`Tier 0 | Tier 1 | Tier 2\`).
`;

const CURSOR_MDC_RULE = `---
description: Control Glass Michelin Kitchen & 3-Phase Bottleneck Guardrails
globs: "**/*"
alwaysApply: true
---

${UNIVERSAL_PROTOCOL_CORE}
`;

export function syncVendorConfigs(rootDir: string = process.cwd()): VendorSyncReport {
  const generated: string[] = [];

  const writeRel = (relPath: string, content: string): void => {
    const abs = path.join(rootDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
    generated.push(relPath);
  };

  writeRel("CLAUDE.md", UNIVERSAL_PROTOCOL_CORE);
  writeRel(".claude/commands/control-glass-mode.md", CLAUDE_SLASH_COMMAND_MODE);
  writeRel(
    ".claude/commands/interrogate.md",
    "Read `skills/interrogate/SKILL.md` and `agents/interrogator.md`, run `npx control-glass map` and `npx control-glass diff`, and perform a 4-Disaster Adversarial Red-Team Audit on the current changes.\n"
  );
  writeRel(
    ".claude/commands/deslop.md",
    "Run `npx control-glass deslop --fix` and `npx control-glass verify` to strip comments and eradicate AI slop deterministically.\n"
  );
  writeRel(
    ".claude/commands/arena.md",
    "Read `skills/arena/SKILL.md` and evaluate 2-3 competing Branded Contract designs using the 100-point Continuum of Control scorecard.\n"
  );

  writeRel(".cursor/rules/control-glass.mdc", CURSOR_MDC_RULE);
  writeRel(".github/copilot-instructions.md", UNIVERSAL_PROTOCOL_CORE);
  writeRel(".windsurfrules", UNIVERSAL_PROTOCOL_CORE);

  const mcpConfigSample = {
    mcpServers: {
      "control-glass": {
        command: "npx",
        args: ["control-glass", "mcp"]
      }
    }
  };
  writeRel("mcp_config.json", JSON.stringify(mcpConfigSample, null, 2) + "\n");

  return {
    syncedTargets: [
      "claude-code",
      "openai-codex",
      "cursor",
      "github-copilot",
      "windsurf",
      "antigravity"
    ],
    generatedFiles: generated
  };
}

if (process.argv[1]?.endsWith("vendor-sync.ts")) {
  const report = syncVendorConfigs();
  console.log(
    `🌐 Synced Multi-Vendor AI configs (${report.syncedTargets.join(", ")}):\n  - ${report.generatedFiles.join("\n  - ")}`
  );
}
