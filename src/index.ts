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
  type EmpiricalEvidenceArtifact
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
  type BenchmarkMetric,
  type BenchmarkSuiteReport
} from "./harness/bench.js";
export { installGitAndCiHooks } from "./harness/hook-installer.js";
export { initControlGlassProject } from "./harness/cli.js";
