import readline from "node:readline";
import { z } from "zod";
import { buildDependencyGraph } from "./auto-mapper.js";
import { runPerformanceBenchmark } from "./bench.js";
import { runControlGlass } from "./control-glass.js";
import { runDeslopEngine } from "./deslop.js";
import { analyzeDiffAndTier } from "./diff-reviewer.js";
import { detectProjectLanguages } from "./polyglot-engine.js";
import { isDirectExecution } from "./runtime.js";

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: string | number | null | undefined;
  readonly method: string;
  readonly params?: Record<string, unknown> | undefined;
}
export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}
const RequestSchema = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number(), z.null()]).optional(), method: z.string(), params: z.record(z.unknown()).optional() });
const EmptyArguments = z.object({}).strict();
const DiffArguments = z.object({ baseRef: z.string().min(1).optional(), headRef: z.string().min(1).optional() }).strict();
const DeslopArguments = z.object({ fix: z.boolean().default(false) }).strict();
const DIFF_INPUT_SCHEMA = { type: "object", properties: { baseRef: { type: "string" }, headRef: { type: "string" } }, additionalProperties: false } as const;
const EMPTY_INPUT_SCHEMA = { type: "object", properties: {}, additionalProperties: false } as const;
export const CONTROL_GLASS_MCP_TOOLS = [
  { name: "control_glass_verify_gates", description: "Runs the complete seven-gate CLI verification pipeline, including configured static checks and tests.", inputSchema: DIFF_INPUT_SCHEMA },
  { name: "control_glass_map_dependencies", description: "Builds the project dependency and export graph.", inputSchema: EMPTY_INPUT_SCHEMA },
  { name: "control_glass_deslop", description: "Scans source and optionally replaces comment trivia while preserving executable tokens.", inputSchema: { type: "object", properties: { fix: { type: "boolean" } }, additionalProperties: false } },
  { name: "control_glass_diff_tier", description: "Classifies the complete requested diff. Classification alone does not approve a merge.", inputSchema: DIFF_INPUT_SCHEMA },
  { name: "control_glass_bench", description: "Runs runtime and memory benchmarks.", inputSchema: EMPTY_INPUT_SCHEMA },
  { name: "control_glass_detect_languages", description: "Detects project source languages.", inputSchema: EMPTY_INPUT_SCHEMA }
] as const;

function failure(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function handleMcpRequest(req: JsonRpcRequest, rootDir: string = process.cwd()): JsonRpcResponse | null {
  const checked = RequestSchema.safeParse(req);
  if (!checked.success) return failure(null, -32600, "Invalid JSON-RPC request.");
  const id = req.id ?? null;
  if (req.method === "notifications/initialized") return null;
  if (req.method === "initialize") return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "control-glass-mcp", version: "3.0.0" } } };
  if (req.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: CONTROL_GLASS_MCP_TOOLS } };
  if (req.method !== "tools/call") return req.id === undefined ? null : failure(id, -32601, "Method not supported.");
  const call = z.object({ name: z.string(), arguments: z.record(z.unknown()).default({}) }).passthrough().safeParse(req.params);
  if (!call.success) return failure(id, -32602, "Invalid tool call parameters.");
  const name = call.data.name;
  if (!CONTROL_GLASS_MCP_TOOLS.some(tool => tool.name === name)) return failure(id, -32601, "Unknown Control Glass tool.");
  const schema = name === "control_glass_deslop" ? DeslopArguments : name === "control_glass_verify_gates" || name === "control_glass_diff_tier" ? DiffArguments : EmptyArguments;
  if (!schema.safeParse(call.data.arguments).success) return failure(id, -32602, "Invalid tool arguments.");
  let payload: unknown;
  let isError = false;
  try {
    switch (name) {
      case "control_glass_verify_gates": {
        const args = DiffArguments.parse(call.data.arguments);
        const evidence = runControlGlass(rootDir, { silent: true, ...(args.baseRef === undefined ? {} : { baseRef: args.baseRef }), ...(args.headRef === undefined ? {} : { headRef: args.headRef }) });
        payload = evidence;
        isError = !evidence.overallPassed;
        break;
      }
      case "control_glass_diff_tier": {
        const args = DiffArguments.parse(call.data.arguments);
        const report = analyzeDiffAndTier(rootDir, undefined, { ...(args.baseRef === undefined ? {} : { baseRef: args.baseRef }), ...(args.headRef === undefined ? {} : { headRef: args.headRef }) });
        payload = report;
        isError = report.status !== "known";
        break;
      }
      case "control_glass_deslop": {
        const report = runDeslopEngine(rootDir, DeslopArguments.parse(call.data.arguments).fix);
        payload = report;
        isError = !report.passed;
        break;
      }
      case "control_glass_map_dependencies": payload = buildDependencyGraph(rootDir); break;
      case "control_glass_bench": {
        const report = runPerformanceBenchmark(rootDir);
        payload = report;
        isError = !report.overallPassed;
        break;
      }
      case "control_glass_detect_languages": payload = { detectedLanguages: detectProjectLanguages(rootDir) }; break;
    }
  } catch (error: unknown) {
    payload = { error: error instanceof Error ? error.message : "Tool execution failed." };
    isError = true;
  }
  return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError } };
}

export function startMcpStdioServer(rootDir: string = process.cwd()): void {
  const input = readline.createInterface({ input: process.stdin, terminal: false });
  input.on("line", line => {
    if (line.trim().length === 0) return;
    let request: unknown;
    try { request = JSON.parse(line); }
    catch { process.stdout.write(JSON.stringify(failure(null, -32700, "Invalid JSON payload.")) + "\n"); return; }
    const parsed = RequestSchema.safeParse(request);
    const response = parsed.success ? handleMcpRequest(parsed.data, rootDir) : failure(null, -32600, "Invalid JSON-RPC request.");
    if (response !== null) process.stdout.write(JSON.stringify(response) + "\n");
  });
}

if (isDirectExecution(import.meta.url)) startMcpStdioServer();
