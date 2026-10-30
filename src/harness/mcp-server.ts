import readline from "node:readline";
import { buildDependencyGraph } from "./auto-mapper.js";
import { runPerformanceBenchmark } from "./bench.js";
import { runDeslopEngine } from "./deslop.js";
import { analyzeDiffAndTier } from "./diff-reviewer.js";
import { runDuneLinter } from "./dune-linter.js";
import { detectProjectLanguages } from "./polyglot-engine.js";
import { runSafetyGate } from "./safety-gate.js";
import { verifyTddLock, writeTddLockManifest } from "./tdd-guard.js";

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
  };
}

export const CONTROL_GLASS_MCP_TOOLS = [
  {
    name: "control_glass_verify_gates",
    description:
      "Runs Dune AST Linter, Phase 2 Safety Gate, Phase 1 TDD SHA-256 Lock check, and Phase 3 Diff Tier classification.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "control_glass_map_dependencies",
    description:
      "Builds the TypeScript AST Dependency & Export Graph (.control-glass/dependency-graph.json).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "control_glass_deslop",
    description:
      "Scans and optionally strips AI slop (comments, empty catch blocks, leftover debuggers).",
    inputSchema: {
      type: "object",
      properties: {
        fix: {
          type: "boolean",
          description: "Automatically strip single-line and multi-line comments in src/"
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "control_glass_diff_tier",
    description:
      "Analyzes git diff against feature-map.json and returns the recommended Review Tier (Tier 0, Tier 1, or Tier 2).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "control_glass_lock_tests",
    description:
      "Freezes SHA-256 hashes of tests/*.spec.ts and src/core/contracts.ts into .control-glass/tdd-lock.json.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "control_glass_bench",
    description:
      "Runs empirical runtime ops/sec and V8 heap delta benchmarks (.control-glass/bench-latest.json).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "control_glass_detect_languages",
    description:
      "Detects active polyglot project languages (.ts, .tsx, .py, .go, .php) in the workspace.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  }
] as const;

export function handleMcpRequest(
  req: JsonRpcRequest,
  rootDir: string = process.cwd()
): JsonRpcResponse | null {
  const id = req.id ?? null;

  if (req.method === "notifications/initialized") {
    return null;
  }

  if (req.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "control-glass-mcp",
          version: "3.0.0"
        }
      }
    };
  }

  if (req.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: CONTROL_GLASS_MCP_TOOLS
      }
    };
  }

  if (req.method === "tools/call") {
    const toolName = String(req.params?.["name"] ?? "");
    const args = (req.params?.["arguments"] as Record<string, unknown> | undefined) ?? {};

    let payload: unknown;

    switch (toolName) {
      case "control_glass_verify_gates": {
        const detectedLanguages = detectProjectLanguages(rootDir);
        const dune = runDuneLinter(rootDir);
        const deslop = runDeslopEngine(rootDir, false);
        const safety = runSafetyGate(rootDir);
        const tdd = verifyTddLock(rootDir);
        const diff = analyzeDiffAndTier(rootDir);
        payload = {
          passed: dune.passed && deslop.passed && safety.passed && tdd.passed,
          detectedLanguages,
          dune,
          deslop,
          safety,
          tdd,
          diff
        };
        break;
      }
      case "control_glass_detect_languages": {
        payload = {
          detectedLanguages: detectProjectLanguages(rootDir)
        };
        break;
      }
      case "control_glass_map_dependencies": {
        payload = buildDependencyGraph(rootDir);
        break;
      }
      case "control_glass_deslop": {
        const fix = Boolean(args["fix"]);
        payload = runDeslopEngine(rootDir, fix);
        break;
      }
      case "control_glass_diff_tier": {
        payload = analyzeDiffAndTier(rootDir);
        break;
      }
      case "control_glass_lock_tests": {
        payload = writeTddLockManifest(rootDir);
        break;
      }
      case "control_glass_bench": {
        payload = runPerformanceBenchmark(rootDir);
        break;
      }
      default: {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Unknown Control Glass MCP tool: ${toolName}`
          }
        };
      }
    }

    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2)
          }
        ]
      }
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `Method not supported: ${req.method}`
    }
  };
}

export function startMcpStdioServer(rootDir: string = process.cwd()): void {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false
  });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const req = JSON.parse(trimmed) as JsonRpcRequest;
      const res = handleMcpRequest(req, rootDir);
      if (res) {
        process.stdout.write(JSON.stringify(res) + "\n");
      }
    } catch {
      const errRes: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Invalid JSON-RPC payload" }
      };
      process.stdout.write(JSON.stringify(errRes) + "\n");
    }
  });
}

if (process.argv[1]?.endsWith("mcp-server.ts")) {
  startMcpStdioServer();
}
