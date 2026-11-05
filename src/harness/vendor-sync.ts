import { isDirectExecution } from "./runtime.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

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
  readonly conflicts: readonly string[];
}

const UNIVERSAL_PROTOCOL_CORE = `# Control Glass v3.0 — Universal Polyglot & Multi-Vendor Agent Contract

> **Core Principle:** Make the easy path the right path. Do not rely on human babysitting; rely on deterministic verification and strict architectural contracts.

## 1. Primary Router & CLI Commands (Single Paved Path)
- Route tasks through \`/control-glass-mode\` (Playbooks: \`feature.md\`, \`bug.md\`, \`perf.md\`, \`gardener.md\`, \`review.md\`).
- \`npx control-glass verify\` (or \`npm run verify\`) — Full 7-gate polyglot empirical verification (Static Compiler + Dune AST Linter + Deslop Engine + Safety Gate + TDD SHA-256 Lock + Unit Tests + Tiered Review Routing). **MUST pass before completing any task.**
- \`npx control-glass languages\` — Detect active project languages (\`typescript\`, \`python\`, \`go\`, \`php\`).
- \`npx control-glass map\` — Auto-generate Polyglot AST Dependency Graph (\`.control-glass/dependency-graph.json\`).
- \`npx control-glass deslop --fix\` — Deterministic AST slop cleaner (strips comments, flags empty catch blocks and debuggers).
- \`npx control-glass lock --phase=spec-freeze\` — Freeze SHA-256 hashes of test files and contracts during Phase 1 Spec Freeze.
- \`npx control-glass diff\` — Compute blast radius and classify PR Review Tier (\`Tier 0 | Tier 1 | Tier 2\`).

## 2. Non-Negotiable Continuum of Control Rules (Polyglot: TS/React/Node, Python, Go, PHP)
1. **Read Materialized Memory First:** Always read \`feature-map.json\` before locating or modifying features.
2. **Zero Comments in Source Code (\`DUNE_NO_COMMENTS\`):** Never write \`//\`, \`/* */\`, or \`#\` comments in source directories. Make types and function names self-documenting.
3. **Branded Types & Explicit Contracts:** Never pass unvalidated primitives across domain boundaries. Never use \`any\`, \`Any\`, \`interface{}\`, \`mixed\`, \`@ts-ignore\`, \`# type: ignore\`, \`//nolint\`, or \`@phpstan-ignore\`.
4. **Architectural Boundary Lock (\`DUNE_BOUNDARY_VIOLATION\`):** UI/React layers (\`src/ui/\`, \`components/\`, \`.tsx\`) must never import \`src/infra/\` or OS I/O modules (\`fs\`, \`child_process\`).
5. **Anti-Closed-Loop Testing (\`TDD_LOCK\`):** Never modify locked test files during implementation to make broken code pass.
`;

const CLAUDE_SLASH_COMMAND_MODE = `Route this task through the Control Glass engineering workflow:
1. Read \`feature-map.json\` and \`skills/control-glass-mode/SKILL.md\`.
2. Match the request to \`skills/control-glass-mode/playbooks/\` (\`feature.md\`, \`bug.md\`, \`perf.md\`, \`gardener.md\`, or \`review.md\`) and copy the checklist verbatim.
3. Enforce Branded Types (\`src/core/contracts.ts\`), zero comments in \`src/\`, and SHA-256 TDD locks (\`npx control-glass lock --phase=spec-freeze\`).
4. Run \`npx control-glass verify\` and report the empirical verification result and Review Tier (\`Tier 0 | Tier 1 | Tier 2\`).
`;

export function syncVendorConfigs(rootDir: string = process.cwd()): VendorSyncReport {
  const generated: string[] = [];
  const conflicts: string[] = [];
  const start = "<!-- control-glass:managed:start -->";
  const end = "<!-- control-glass:managed:end -->";
  const writeRel = (relative: string, content: string): void => {
    const destination = path.join(rootDir, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (!fs.existsSync(destination) || fs.readFileSync(destination, "utf8") !== content) fs.writeFileSync(destination, content, "utf8");
    generated.push(relative);
  };
  const writeManaged = (relative: string, content: string, prefix: string = ""): void => {
    const destination = path.join(rootDir, relative);
    const existing = fs.existsSync(destination) ? fs.readFileSync(destination, "utf8") : "";
    const block = start + "\n" + content.trimEnd() + "\n" + end;
    const first = existing.indexOf(start);
    const last = existing.indexOf(end, first);
    if (first !== -1 && last === -1) { conflicts.push(relative); return; }
    const next = first !== -1 ? existing.slice(0, first) + block + existing.slice(last + end.length)
      : existing.length > 0 ? existing.trimEnd() + "\n\n" + block + "\n" : prefix + block + "\n";
    writeRel(relative, next);
  };
  writeManaged("CLAUDE.md", UNIVERSAL_PROTOCOL_CORE);
  writeManaged("AGENTS.md", UNIVERSAL_PROTOCOL_CORE);
  writeManaged(".claude/commands/control-glass-mode.md", CLAUDE_SLASH_COMMAND_MODE);
  writeManaged(".claude/commands/interrogate.md", "Read skills/interrogate/SKILL.md and agents/interrogator.md. Audit the current diff and verification evidence.");
  writeManaged(".claude/commands/deslop.md", "Read skills/deslop/SKILL.md. Run control-glass deslop --fix and control-glass verify.");
  writeManaged(".claude/commands/arena.md", "Read skills/arena/SKILL.md and compare validated contract designs.");
  writeManaged(".cursor/rules/control-glass.mdc", UNIVERSAL_PROTOCOL_CORE, '---\ndescription: Control Glass verification contracts\nglobs: "**/*"\nalwaysApply: true\n---\n\n');
  writeManaged(".github/copilot-instructions.md", UNIVERSAL_PROTOCOL_CORE);
  writeManaged(".windsurfrules", UNIVERSAL_PROTOCOL_CORE);
  writeManaged(".agent/rules/control-glass.md", UNIVERSAL_PROTOCOL_CORE);
  const mcpPath = path.join(rootDir, "mcp_config.json");
  const existingMcp = fs.existsSync(mcpPath) ? z.object({ mcpServers: z.record(z.unknown()).default({}) }).passthrough().parse(JSON.parse(fs.readFileSync(mcpPath, "utf8"))) : { mcpServers: {} };
  const mcpServers = { ...existingMcp.mcpServers };
  if (!("control-glass" in mcpServers)) mcpServers["control-glass"] = { command: "npx", args: ["--no-install", "control-glass", "mcp"] };
  writeRel("mcp_config.json", JSON.stringify({ ...existingMcp, mcpServers }, null, 2) + "\n");
  const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
  const copyDirectory = (source: string, relative: string): void => {
    if (!fs.existsSync(source)) { conflicts.push(relative); return; }
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const input = path.join(source, entry.name);
      const output = path.join(relative, entry.name);
      if (entry.isDirectory()) copyDirectory(input, output);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        const destination = path.join(rootDir, output);
        const content = fs.readFileSync(input, "utf8");
        if (fs.existsSync(destination) && fs.readFileSync(destination, "utf8") !== content) conflicts.push(output);
        else writeRel(output, content);
      }
    }
  };
  copyDirectory(path.join(packageRoot, "skills"), "skills");
  copyDirectory(path.join(packageRoot, "skills"), ".agent/skills");
  copyDirectory(path.join(packageRoot, "agents"), "agents");
  const pluginPath = path.join(rootDir, "plugin.json");
  if (!fs.existsSync(pluginPath)) writeRel("plugin.json", fs.readFileSync(path.join(packageRoot, "plugin.json"), "utf8"));
  return { syncedTargets: ["claude-code", "openai-codex", "cursor", "github-copilot", "windsurf", "antigravity"], generatedFiles: generated, conflicts };
}

if (isDirectExecution(import.meta.url)) {
  const report = syncVendorConfigs();
  console.log(
    `🌐 Synced Multi-Vendor AI configs (${report.syncedTargets.join(", ")}):\n  - ${report.generatedFiles.join("\n  - ")}`
  );
}
