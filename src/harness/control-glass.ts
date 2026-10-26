import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildDependencyGraph } from "./auto-mapper.js";
import { runDeslopEngine } from "./deslop.js";
import { analyzeDiffAndTier, type DiffReviewReport } from "./diff-reviewer.js";
import { runDuneLinter } from "./dune-linter.js";
import { runSafetyGate } from "./safety-gate.js";
import { verifyTddLock } from "./tdd-guard.js";

export interface EmpiricalEvidenceArtifact {
  readonly timestamp: string;
  readonly durationMs: number;
  readonly overallPassed: boolean;
  readonly gates: {
    readonly typecheck: { readonly passed: boolean; readonly output: string };
    readonly duneAstLinter: {
      readonly passed: boolean;
      readonly checkedFiles: number;
      readonly violationCount: number;
    };
    readonly deslopEngine: {
      readonly passed: boolean;
      readonly scannedFiles: number;
      readonly issueCount: number;
    };
    readonly safetyAndSecretGate: {
      readonly passed: boolean;
      readonly scannedFiles: number;
      readonly findingCount: number;
    };
    readonly tddContractLock: {
      readonly passed: boolean;
      readonly violations: readonly string[];
    };
    readonly unitAndContractTests: {
      readonly passed: boolean;
      readonly summary: string;
    };
  };
  readonly dependencyGraphSummary: {
    readonly totalMappedFiles: number;
  };
  readonly phase3Orchestration: DiffReviewReport;
}

function runCommandGate(command: string, cwd: string): { passed: boolean; output: string } {
  try {
    const out = execSync(command, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { passed: true, output: out.trim() };
  } catch (error: unknown) {
    const errObj = error as { stdout?: string; stderr?: string; message?: string };
    const combined = [errObj.stdout ?? "", errObj.stderr ?? "", errObj.message ?? ""]
      .join("\n")
      .trim();
    return { passed: false, output: combined };
  }
}

export function runControlGlass(rootDir: string = process.cwd()): EmpiricalEvidenceArtifact {
  const startTime = performance.now();

  console.log("🔬 [Control Glass] Starting Empirical Verification Pipeline...\n");

  const typecheckRes = runCommandGate("npx tsc --noEmit", rootDir);
  console.log(
    `  1. [Level 1] Strict TypeScript Compiler: ${typecheckRes.passed ? "✅ PASS" : "❌ FAIL"}`
  );

  const duneRes = runDuneLinter(rootDir);
  console.log(
    `  2. [Level 2] Dune AST Linter (${duneRes.checkedFiles} files): ${duneRes.passed ? "✅ PASS" : "❌ FAIL"}`
  );

  const deslopRes = runDeslopEngine(rootDir, false);
  console.log(
    `  3. [Level 2] AST Deslop Engine (${deslopRes.scannedFiles} files): ${deslopRes.passed ? "✅ PASS" : "❌ FAIL"}`
  );

  const safetyRes = runSafetyGate(rootDir);
  console.log(
    `  4. [Phase 2] Safety & Secret Gate (${safetyRes.scannedFiles} files): ${safetyRes.passed ? "✅ PASS" : "❌ FAIL"}`
  );

  const tddRes = verifyTddLock(rootDir);
  console.log(
    `  5. [Phase 1] TDD & Contract Immutability Lock: ${tddRes.passed ? "✅ PASS" : "❌ FAIL"}`
  );

  const testRes = runCommandGate("npx vitest run", rootDir);
  console.log(
    `  6. [Level 1] Empirical Contract & Unit Tests: ${testRes.passed ? "✅ PASS" : "❌ FAIL"}`
  );

  const depGraph = buildDependencyGraph(rootDir);
  const diffReport = analyzeDiffAndTier(rootDir);
  console.log(
    `  7. [Phase 3] Tiered Review Routing (${depGraph.totalFiles} AST nodes mapped): 🎯 ${diffReport.recommendedTier} — ${diffReport.routingDecision}\n`
  );

  const overallPassed =
    typecheckRes.passed &&
    duneRes.passed &&
    deslopRes.passed &&
    safetyRes.passed &&
    tddRes.passed &&
    testRes.passed;

  const durationMs = Math.round(performance.now() - startTime);

  const artifact: EmpiricalEvidenceArtifact = {
    timestamp: new Date().toISOString(),
    durationMs,
    overallPassed,
    gates: {
      typecheck: typecheckRes,
      duneAstLinter: {
        passed: duneRes.passed,
        checkedFiles: duneRes.checkedFiles,
        violationCount: duneRes.violations.length
      },
      deslopEngine: {
        passed: deslopRes.passed,
        scannedFiles: deslopRes.scannedFiles,
        issueCount: deslopRes.issues.length
      },
      safetyAndSecretGate: {
        passed: safetyRes.passed,
        scannedFiles: safetyRes.scannedFiles,
        findingCount: safetyRes.findings.length
      },
      tddContractLock: tddRes,
      unitAndContractTests: {
        passed: testRes.passed,
        summary: testRes.passed ? "All test suites passed" : testRes.output
      }
    },
    dependencyGraphSummary: {
      totalMappedFiles: depGraph.totalFiles
    },
    phase3Orchestration: diffReport
  };

  const evidencePath = path.join(rootDir, ".control-glass", "evidence-latest.json");
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

  console.log(`📄 Empirical Evidence saved to .control-glass/evidence-latest.json (${durationMs}ms)`);

  if (!overallPassed) {
    console.error("\n🚨 Control Glass Verification FAILED. Fix violations before submitting PR.");
    if (!typecheckRes.passed) console.error(typecheckRes.output);
    if (!duneRes.passed) {
      for (const v of duneRes.violations) {
        console.error(`  [${v.ruleId}] ${v.file}:${v.line} — ${v.message}`);
      }
    }
    if (!deslopRes.passed) {
      for (const issue of deslopRes.issues) {
        console.error(`  [${issue.kind}] ${issue.file}:${issue.line} — ${issue.description}`);
      }
    }
    if (!safetyRes.passed) {
      for (const f of safetyRes.findings) {
        console.error(`  [${f.category}] ${f.file}:${f.line} — ${f.detail}`);
      }
    }
    if (!tddRes.passed) {
      for (const v of tddRes.violations) {
        console.error(`  [TDD_LOCK] ${v}`);
      }
    }
    if (!testRes.passed) console.error(testRes.output);
    process.exit(1);
  }

  console.log("\n🏆 Control Glass Verification SUCCEEDED. High-trust quality verified!");
  return artifact;
}

if (process.argv[1]?.endsWith("control-glass.ts")) {
  runControlGlass();
}
