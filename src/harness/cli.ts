#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  buildVendorRequestPayload,
  createVendorModelConfig,
  detectAvailableVendors
} from "../vendors/llm-gateway.js";
import { buildDependencyGraph } from "./auto-mapper.js";
import { runPerformanceBenchmark } from "./bench.js";
import { runControlGlass } from "./control-glass.js";
import { runDeslopEngine } from "./deslop.js";
import { analyzeDiffAndTier } from "./diff-reviewer.js";
import { runDuneLinter } from "./dune-linter.js";
import { installGitAndCiHooks } from "./hook-installer.js";
import { startMcpStdioServer } from "./mcp-server.js";
import { runSafetyGate } from "./safety-gate.js";
import { verifyTddLock, writeTddLockManifest } from "./tdd-guard.js";
import { syncVendorConfigs } from "./vendor-sync.js";

const DEFAULT_FEATURE_MAP = {
  schemaVersion: "1.0.0",
  description: "Materialized Memory (Feature Map) for Control Glass & Tiered Review Routing",
  architecturalBoundaries: {
    ui: {
      pathPrefix: "src/ui/",
      forbiddenImports: ["src/infra/", "node:fs", "node:child_process", "fs", "child_process"],
      description: "Renderer / Presentation layer (must maintain 60-120 FPS, zero blocking I/O)"
    },
    features: {
      pathPrefix: "src/features/",
      forbiddenImports: ["node:child_process", "child_process"],
      description: "Single Paved Path domain features using pure Branded Contracts"
    },
    core: {
      pathPrefix: "src/core/",
      forbiddenImports: ["src/ui/", "src/features/"],
      description: "Foundational Branded Types, Result monads, and interface contracts"
    }
  },
  features: []
};

const DEFAULT_AGENTS_MD = `# AGENTS.md — Control Glass (Michelin Kitchen & Bottleneck-Free Contract)

> **Core Principle:** Make the easy path the right path. Do not rely on human babysitting; rely on deterministic verification and strict architectural contracts.

## 1. Allowed Commands (Single Paved Path)
- \`npx control-glass verify\` — Full verification gate (Typecheck + Dune AST Linter + Safety/Secret Gate + TDD Lock Check + Tests + Tiered Risk Classification).
- \`npx control-glass lint\` — Custom AST static analysis (no-comments, boundary locks, no-any).
- \`npx control-glass deslop\` — AST Slop detector and comment cleaner (\`--fix\`).
- \`npx control-glass map\` — Auto-build AST dependency graph (\`.control-glass/dependency-graph.json\`).
- \`npx control-glass bench\` — Run runtime & V8 heap delta benchmarks (\`.control-glass/bench-latest.json\`).
- \`npx control-glass safety\` — Scans for leaked secrets and destructive operations.
- \`npx control-glass lock\` — Locks SHA-256 hashes of tests and contracts during Phase 1 Spec Freeze.
- \`npx control-glass diff\` — Generates Diff & Consequence Report and calculates Review Tier (\`Tier 0 | 1 | 2\`).
- \`npx control-glass sync-vendors\` — Generates instructions & slash commands for Claude, OpenAI Codex, Cursor, Copilot, Windsurf, and MCP.
- \`npx control-glass mcp\` — Starts the Universal Model Context Protocol (MCP) Server over stdio.
- \`npx control-glass install-hooks\` — Installs Git pre-commit hook and GitHub Actions CI workflow.

## 2. Continuum of Control (Non-Negotiable Rules)
1. **Read Materialized Memory First:** Always read \`feature-map.json\` before locating or modifying features.
2. **Zero Comments in Source Code (\`src/\`):** Comments are strictly prohibited by AST Linter.
3. **Branded Types & Explicit Contracts:** Never use \`any\`, \`@ts-ignore\`, or \`as unknown as\`.
4. **Architectural Boundary Lock:** Respect \`architecturalBoundaries\` in \`feature-map.json\`.
5. **Anti-Closed-Loop Testing (TDD Lock):** Never modify locked test files in \`tests/\` to make broken code pass.
`;

export function initControlGlassProject(targetDir: string = process.cwd()): {
  readonly createdFiles: readonly string[];
} {
  const created: string[] = [];
  const featureMapPath = path.join(targetDir, "feature-map.json");
  if (!fs.existsSync(featureMapPath)) {
    fs.writeFileSync(featureMapPath, JSON.stringify(DEFAULT_FEATURE_MAP, null, 2) + "\n", "utf8");
    created.push("feature-map.json");
  }

  const agentsMdPath = path.join(targetDir, "AGENTS.md");
  if (!fs.existsSync(agentsMdPath)) {
    fs.writeFileSync(agentsMdPath, DEFAULT_AGENTS_MD, "utf8");
    created.push("AGENTS.md");
  }

  const vendorReport = syncVendorConfigs(targetDir);
  created.push(...vendorReport.generatedFiles);

  writeTddLockManifest(targetDir);
  created.push(".control-glass/tdd-lock.json");

  return { createdFiles: created };
}

function printHelp(): void {
  console.log(`
🔬 Control Glass CLI v2.1 — Universal Multi-Vendor Agentic Engineering Harness

Usage:
  control-glass <command> [options]

Commands:
  init            Initialize Control Glass & multi-vendor configs in any repository
  sync-vendors    Generate instruction files & slash commands for Claude, OpenAI, Cursor, Copilot, Windsurf & MCP
  mcp             Start the Control Glass MCP (Model Context Protocol) stdio server for any AI client
  vendors         Inspect supported AI vendor adapters (Anthropic Claude, OpenAI, Gemini, Ollama/OpenRouter)
  verify          Run full 6-gate empirical verification pipeline & emit .control-glass/evidence-latest.json
  lint            Run Dune AST Linter (No-Comment, Boundary Lock, No-Any, No-Console)
  deslop [--fix]  Detect & strip AI slop (comments, empty catch blocks, leftover debuggers)
  map             Auto-generate AST Dependency & Export Graph (.control-glass/dependency-graph.json)
  bench           Run empirical performance & V8 heap memory hill-climbing benchmark
  safety          Run Phase 2 Safety & Secret Gate (API key leak & destructive command blocker)
  tdd-check       Verify Phase 1 TDD & Contract SHA-256 immutability lock
  lock            Update Phase 1 TDD & Contract SHA-256 lock (.control-glass/tdd-lock.json)
  diff            Run Phase 3 Diff & Consequence Analyzer and calculate Review Tier (Tier 0 / 1 / 2)
  install-hooks   Install zero-bypass Git pre-commit hook and GitHub Actions CI workflow
`);
}

if (process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js")) {
  const cmd = process.argv[2] ?? "verify";
  const cwd = process.cwd();

  switch (cmd) {
    case "init": {
      const res = initControlGlassProject(cwd);
      console.log(`✅ Control Glass initialized (${res.createdFiles.length} files configured).`);
      break;
    }
    case "sync-vendors": {
      const report = syncVendorConfigs(cwd);
      console.log(
        `🌐 Synced Multi-Vendor AI configs (${report.syncedTargets.join(", ")}):\n  - ${report.generatedFiles.join("\n  - ")}`
      );
      break;
    }
    case "mcp": {
      startMcpStdioServer(cwd);
      break;
    }
    case "vendors": {
      const active = detectAvailableVendors();
      const claudeCfg = createVendorModelConfig("anthropic");
      const openaiCfg = createVendorModelConfig("openai");
      const geminiCfg = createVendorModelConfig("gemini");
      const localCfg = createVendorModelConfig("openai-compatible");
      console.log("🤖 Control Glass Multi-Vendor LLM Gateway:");
      console.log("  Supported Providers: anthropic (Claude), openai (GPT/o-series), gemini, openai-compatible (Ollama/DeepSeek/OpenRouter)");
      console.log(`  Detected Active API Keys in Env: ${active.length > 0 ? active.join(", ") : "None (Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY)"}`);
      if (claudeCfg.ok && openaiCfg.ok && geminiCfg.ok && localCfg.ok) {
        console.log(
          `  Default Models: Claude=${claudeCfg.value.modelId}, OpenAI=${openaiCfg.value.modelId}, Gemini=${geminiCfg.value.modelId}, Local=${localCfg.value.modelId}`
        );
      }
      void buildVendorRequestPayload;
      break;
    }
    case "verify": {
      runControlGlass(cwd);
      break;
    }
    case "lint": {
      const res = runDuneLinter(cwd);
      if (!res.passed) {
        for (const v of res.violations) {
          console.error(`  [${v.ruleId}] ${v.file}:${v.line} — ${v.message}`);
        }
        process.exit(1);
      }
      console.log(`✅ Dune AST Linter passed (${res.checkedFiles} files verified).`);
      break;
    }
    case "deslop": {
      const fix = process.argv.includes("--fix");
      const res = runDeslopEngine(cwd, fix);
      if (res.cleanedCommentCount > 0) {
        console.log(`🧹 Auto-cleaned ${res.cleanedCommentCount} comment block(s).`);
      }
      if (!res.passed) {
        for (const issue of res.issues) {
          console.error(`  [${issue.kind}] ${issue.file}:${issue.line} — ${issue.description}`);
        }
        process.exit(1);
      }
      console.log(`✅ Deslop Engine passed (${res.scannedFiles} files verified clean).`);
      break;
    }
    case "map": {
      const graph = buildDependencyGraph(cwd);
      console.log(`🗺️  Auto-Mapper built AST dependency graph (${graph.totalFiles} files -> .control-glass/dependency-graph.json).`);
      break;
    }
    case "bench": {
      const report = runPerformanceBenchmark(cwd);
      for (const m of report.metrics) {
        console.log(
          `  - ${m.name}: ${m.totalDurationMs}ms (${m.opsPerSecond.toLocaleString()} ops/sec, heapΔ: ${(m.heapDeltaBytes / 1024).toFixed(1)} KB)`
        );
      }
      if (!report.overallPassed) {
        process.exit(1);
      }
      break;
    }
    case "safety": {
      const res = runSafetyGate(cwd);
      if (!res.passed) {
        for (const f of res.findings) {
          console.error(`  [${f.category}] ${f.file}:${f.line} — ${f.detail}`);
        }
        process.exit(1);
      }
      console.log(`✅ Safety & Secret Gate passed (${res.scannedFiles} files scanned).`);
      break;
    }
    case "tdd-check": {
      const res = verifyTddLock(cwd);
      if (!res.passed) {
        for (const v of res.violations) {
          console.error(`  - ${v}`);
        }
        process.exit(1);
      }
      console.log("✅ TDD Guard passed.");
      break;
    }
    case "lock": {
      const manifest = writeTddLockManifest(cwd);
      console.log(`🔒 TDD & Contract Lock updated (${Object.keys(manifest.files).length} files frozen).`);
      break;
    }
    case "diff": {
      const report = analyzeDiffAndTier(cwd);
      console.log(`🎯 Recommended Tier: ${report.recommendedTier}`);
      console.log(`🚦 Decision: ${report.routingDecision}`);
      break;
    }
    case "install-hooks": {
      const res = installGitAndCiHooks(cwd);
      console.log(`🔒 Installed Zero-Bypass Hooks & CI Gates: ${res.installedPaths.join(", ")}`);
      break;
    }
    default: {
      printHelp();
      break;
    }
  }
}
