import { describe, expect, it } from "vitest";
import {
  createIdempotencyKey,
  createNewtonSeconds,
  createPercentageInt,
  createPoundForceSeconds,
  createSatang
} from "../src/core/contracts.js";
import { buildDependencyGraph } from "../src/harness/auto-mapper.js";
import { runPerformanceBenchmark } from "../src/harness/bench.js";
import { runDeslopEngine } from "../src/harness/deslop.js";
import { analyzeDiffAndTier } from "../src/harness/diff-reviewer.js";
import { runDuneLinter } from "../src/harness/dune-linter.js";
import { runSafetyGate } from "../src/harness/safety-gate.js";
import { verifyTddLock } from "../src/harness/tdd-guard.js";

describe("Control Glass 7-Gate Guardrails & Branded Contracts Self-Test", () => {
  it("validates Branded Types and rejects invalid negative/out-of-bounds values", () => {
    expect(createNewtonSeconds(444.82).ok).toBe(true);
    expect(createNewtonSeconds(-1).ok).toBe(false);
    expect(createPoundForceSeconds(100).ok).toBe(true);
    expect(createSatang(25_000).ok).toBe(true);
    expect(createSatang(12.34).ok).toBe(false);
    expect(createPercentageInt(10).ok).toBe(true);
    expect(createPercentageInt(150).ok).toBe(false);
    expect(createIdempotencyKey("tx-valid-key-001").ok).toBe(true);
    expect(createIdempotencyKey("short").ok).toBe(false);
  });

  it("passes Dune AST Linter with zero comments and intact boundaries", () => {
    const res = runDuneLinter();
    expect(res.passed).toBe(true);
    expect(res.violations).toEqual([]);
  });

  it("passes Phase 2 Safety & Secret Gate", () => {
    const res = runSafetyGate();
    expect(res.passed).toBe(true);
    expect(res.findings).toEqual([]);
  });

  it("passes Phase 1 TDD Immutability Lock", () => {
    const res = verifyTddLock();
    expect(res.passed).toBe(true);
  });

  it("routes UI-only changes to Tier 0 (Auto-Merge) and Core/Harness changes to Tier 2 (Senior Review)", () => {
    const tier0Report = analyzeDiffAndTier(process.cwd(), ["src/ui/Component.tsx"]);
    expect(tier0Report.recommendedTier).toBe("Tier 0");

    const tier2Report = analyzeDiffAndTier(process.cwd(), [
      "src/core/contracts.ts"
    ]);
    expect(tier2Report.recommendedTier).toBe("Tier 2");
  });

  it("builds AST Dependency Graph via Auto-Mapper accurately", () => {
    const graph = buildDependencyGraph();
    expect(graph.totalFiles).toBeGreaterThanOrEqual(10);
    expect(graph.nodes["src/core/contracts.ts"]?.layer).toBe("core");
    expect(graph.nodes["src/vendors/llm-gateway.ts"]?.imports).toContain(
      "src/core/contracts.ts"
    );
  });

  it("passes Deterministic AST Deslop Engine with zero slop issues", () => {
    const report = runDeslopEngine(process.cwd(), false);
    expect(report.passed).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("executes Empirical Performance & V8 Heap Hill-Climber within SLA", () => {
    const bench = runPerformanceBenchmark();
    expect(bench.overallPassed).toBe(true);
    expect(bench.metrics.length).toBeGreaterThanOrEqual(2);

    const customBench = runPerformanceBenchmark(process.cwd(), [
      {
        name: "Custom Consumer Workload (1,000 ops)",
        iterations: 1_000,
        maxAllowedDurationMs: 200,
        fn: () => {
          Math.sqrt(144);
        }
      }
    ]);
    expect(customBench.overallPassed).toBe(true);
    expect(customBench.metrics[0]?.name).toBe("Custom Consumer Workload (1,000 ops)");
  });
});
