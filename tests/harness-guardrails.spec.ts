import { describe, expect, it } from "vitest";
import { buildDependencyGraph } from "../src/harness/auto-mapper.js";
import { runPerformanceBenchmark } from "../src/harness/bench.js";
import { runDeslopEngine } from "../src/harness/deslop.js";
import { analyzeDiffAndTier } from "../src/harness/diff-reviewer.js";
import { runDuneLinter } from "../src/harness/dune-linter.js";
import { runSafetyGate } from "../src/harness/safety-gate.js";
import { verifyTddLock } from "../src/harness/tdd-guard.js";

describe("Michelin Kitchen & Bottleneck Guardrails Self-Test", () => {
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

  it("routes UI-only changes to Tier 0 (Auto-Merge) and Ledger/Thruster changes to Tier 2 (Senior Review)", () => {
    const tier0Report = analyzeDiffAndTier(process.cwd(), ["src/ui/telemetry-view.ts"]);
    expect(tier0Report.recommendedTier).toBe("Tier 0");

    const tier2Report = analyzeDiffAndTier(process.cwd(), [
      "src/features/ledger/settlement.ts"
    ]);
    expect(tier2Report.recommendedTier).toBe("Tier 2");
  });

  it("builds AST Dependency Graph via Auto-Mapper accurately", () => {
    const graph = buildDependencyGraph();
    expect(graph.totalFiles).toBeGreaterThanOrEqual(10);
    expect(graph.nodes["src/core/contracts.ts"]?.layer).toBe("core");
    expect(graph.nodes["src/ui/telemetry-view.ts"]?.imports).toContain(
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
  });
});
