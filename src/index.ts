export {
  type Brand,
  type Result,
  type NewtonSeconds,
  type PoundForceSeconds,
  type Satang,
  type PercentageInt,
  type NonEmptyText,
  type IdempotencyKey,
  ok,
  err,
  createNewtonSeconds,
  createPoundForceSeconds,
  createSatang,
  createPercentageInt,
  createNonEmptyText,
  createIdempotencyKey
} from "./core/contracts.js";

export { runDuneLinter, type LintViolation } from "./harness/dune-linter.js";
export { runSafetyGate, type SafetyFinding } from "./harness/safety-gate.js";
export {
  verifyTddLock,
  writeTddLockManifest,
  type TddLockManifest
} from "./harness/tdd-guard.js";
export {
  analyzeDiffAndTier,
  type DiffReviewReport,
  type ReviewTier
} from "./harness/diff-reviewer.js";
export {
  runControlGlass,
  resolvePolyglotGateCommands,
  type EmpiricalEvidenceArtifact,
  type PolyglotGateCommands
} from "./harness/control-glass.js";
export {
  buildDependencyGraph,
  type DependencyGraphArtifact,
  type FileDependencyNode
} from "./harness/auto-mapper.js";
export {
  runDeslopEngine,
  type DeslopReport,
  type SlopIssue
} from "./harness/deslop.js";
export {
  runPerformanceBenchmark,
  measureWorkload,
  type BenchmarkMetric,
  type BenchmarkSuiteReport,
  type CustomBenchmarkTask
} from "./harness/bench.js";
export { installGitAndCiHooks } from "./harness/hook-installer.js";
export {
  syncVendorConfigs,
  type SupportedVendorTarget,
  type VendorSyncReport
} from "./harness/vendor-sync.js";
export {
  CONTROL_GLASS_MCP_TOOLS,
  handleMcpRequest,
  startMcpStdioServer,
  type JsonRpcRequest,
  type JsonRpcResponse
} from "./harness/mcp-server.js";
export {
  type AiVendorId,
  type VendorModelConfig,
  type VendorRequestPayload,
  createVendorModelConfig,
  buildVendorRequestPayload,
  detectAvailableVendors
} from "./vendors/llm-gateway.js";
export {
  type SupportedLanguage,
  type PolyglotViolation,
  type PolyglotSlopFinding,
  detectLanguageFromFile,
  detectProjectLanguages,
  collectPolyglotSourceFiles,
  lintNonTsSourceText,
  scanNonTsSlop,
  stripNonTsComments,
  POLYGLOT_CONTRACT_TEMPLATES
} from "./harness/polyglot-engine.js";
export { initControlGlassProject } from "./harness/cli.js";
