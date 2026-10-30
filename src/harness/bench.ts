import fs from "node:fs";
import path from "node:path";
import {
  createIdempotencyKey,
  createNewtonSeconds,
  createNonEmptyText,
  createPercentageInt,
  createSatang
} from "../core/contracts.js";

export interface BenchmarkMetric {
  readonly name: string;
  readonly iterations: number;
  readonly totalDurationMs: number;
  readonly opsPerSecond: number;
  readonly heapDeltaBytes: number;
  readonly passedSla: boolean;
}

export interface BenchmarkSuiteReport {
  readonly timestamp: string;
  readonly overallPassed: boolean;
  readonly metrics: readonly BenchmarkMetric[];
}

export interface CustomBenchmarkTask {
  readonly name: string;
  readonly iterations?: number;
  readonly maxAllowedDurationMs?: number;
  readonly fn: () => void;
}

export function measureWorkload(
  name: string,
  iterations: number,
  maxAllowedDurationMs: number,
  fn: () => void
): BenchmarkMetric {
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    fn();
  }

  const totalDurationMs = Number((performance.now() - start).toFixed(3));
  const heapAfter = process.memoryUsage().heapUsed;
  const heapDeltaBytes = Math.max(0, heapAfter - heapBefore);
  const opsPerSecond = Math.round((iterations / Math.max(totalDurationMs, 0.001)) * 1000);

  return {
    name,
    iterations,
    totalDurationMs,
    opsPerSecond,
    heapDeltaBytes,
    passedSla: totalDurationMs <= maxAllowedDurationMs
  };
}

export function runPerformanceBenchmark(
  rootDir: string = process.cwd(),
  customTasks?: readonly CustomBenchmarkTask[]
): BenchmarkSuiteReport {
  const metrics: BenchmarkMetric[] = [];

  if (customTasks && customTasks.length > 0) {
    for (const task of customTasks) {
      metrics.push(
        measureWorkload(
          task.name,
          task.iterations ?? 10_000,
          task.maxAllowedDurationMs ?? 500,
          task.fn
        )
      );
    }
  } else {
    metrics.push(
      measureWorkload(
        "Branded Numeric Contract Validation (10,000 ops)",
        10_000,
        500,
        () => {
          createNewtonSeconds(444.82);
          createSatang(25_000);
          createPercentageInt(10);
        }
      ),
      measureWorkload(
        "Branded Text & Idempotency Contract Validation (10,000 ops)",
        10_000,
        500,
        () => {
          createNonEmptyText("MISSION-CONTROL");
          createIdempotencyKey("tx-bench-key-00001");
        }
      )
    );
  }

  const overallPassed = metrics.every((m) => m.passedSla);

  const report: BenchmarkSuiteReport = {
    timestamp: new Date().toISOString(),
    overallPassed,
    metrics
  };

  const outPath = path.join(rootDir, ".control-glass", "bench-latest.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  return report;
}

if (process.argv[1]?.endsWith("bench.ts")) {
  const report = runPerformanceBenchmark();
  console.log("⚡ Control Glass Performance & Heap Hill-Climber:");
  for (const m of report.metrics) {
    console.log(
      `  - ${m.name}: ${m.totalDurationMs}ms (${m.opsPerSecond.toLocaleString()} ops/sec, heapΔ: ${(m.heapDeltaBytes / 1024).toFixed(1)} KB) [${m.passedSla ? "✅ SLA PASS" : "❌ SLA FAIL"}]`
    );
  }
  if (!report.overallPassed) {
    process.exit(1);
  }
}
