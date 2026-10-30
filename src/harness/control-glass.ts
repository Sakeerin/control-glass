import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildDependencyGraph } from "./auto-mapper.js";
import { runDeslopEngine } from "./deslop.js";
import { analyzeDiffAndTier, type DiffReviewReport } from "./diff-reviewer.js";
import { runDuneLinter } from "./dune-linter.js";
import { detectProjectLanguages, type SupportedLanguage } from "./polyglot-engine.js";
import { runSafetyGate } from "./safety-gate.js";
import { verifyTddLock } from "./tdd-guard.js";

export interface EmpiricalEvidenceArtifact {
  readonly timestamp: string;
  readonly durationMs: number;
  readonly detectedLanguages: readonly SupportedLanguage[];
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

export interface PolyglotGateCommands {
  readonly staticCheckCommands: readonly string[];
  readonly testCommands: readonly string[];
}

export function resolvePolyglotGateCommands(rootDir: string): PolyglotGateCommands {
  const staticCheckCommands: string[] = [];
  const testCommands: string[] = [];

  if (fs.existsSync(path.join(rootDir, "tsconfig.json"))) {
    staticCheckCommands.push("npx tsc --noEmit");
  }
  if (fs.existsSync(path.join(rootDir, "package.json"))) {
    testCommands.push("npx vitest run");
  }

  if (
    fs.existsSync(path.join(rootDir, "pyproject.toml")) ||
    fs.existsSync(path.join(rootDir, "mypy.ini")) ||
    fs.existsSync(path.join(rootDir, "requirements.txt"))
  ) {
    staticCheckCommands.push("mypy .");
    testCommands.push("pytest");
  }

  if (fs.existsSync(path.join(rootDir, "go.mod"))) {
    staticCheckCommands.push("go vet ./...");
    testCommands.push("go test ./...");
  }

  if (
    fs.existsSync(path.join(rootDir, "composer.json")) ||
    fs.existsSync(path.join(rootDir, "phpunit.xml"))
  ) {
    staticCheckCommands.push("vendor/bin/phpstan analyse");
    testCommands.push("vendor/bin/phpunit");
  }

  return { staticCheckCommands, testCommands };
}

function isCommandAvailable(probeCmd: string, cwd: string): boolean {
  try {
    execSync(probeCmd, { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
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

function runPolyglotStaticGate(
  rootDir: string,
  commands: readonly string[]
): { passed: boolean; output: string } {
  if (commands.length === 0) {
    return { passed: true, output: "No external static compiler config; AST linter active" };
  }
  const outputs: string[] = [];
  for (const cmd of commands) {
    if (cmd.startsWith("mypy") && !isCommandAvailable("mypy --version", rootDir)) continue;
    if (cmd.startsWith("go ") && !isCommandAvailable("go version", rootDir)) continue;
    if (
      cmd.startsWith("vendor/bin/phpstan") &&
      !fs.existsSync(path.join(rootDir, "vendor", "bin", "phpstan"))
    ) {
      continue;
    }
    const res = runCommandGate(cmd, rootDir);
    outputs.push(res.output);
    if (!res.passed) {
      return { passed: false, output: outputs.join("\n").trim() };
    }
  }
  return {
    passed: true,
    output: outputs.filter((o) => o.length > 0).join("\n") || "All static checks passed"
  };
}

function runPolyglotTestGate(
  rootDir: string,
  commands: readonly string[]
): { passed: boolean; output: string } {
  if (commands.length === 0) {
    return { passed: true, output: "No test runner manifest detected" };
  }
  const outputs: string[] = [];
  for (const cmd of commands) {
    if (cmd === "pytest" && !isCommandAvailable("pytest --version", rootDir)) continue;
    if (cmd.startsWith("go ") && !isCommandAvailable("go version", rootDir)) continue;
    if (
      cmd === "vendor/bin/phpunit" &&
      !fs.existsSync(path.join(rootDir, "vendor", "bin", "phpunit"))
    ) {
      continue;
    }
    const res = runCommandGate(cmd, rootDir);
    outputs.push(res.output);
    if (!res.passed) {
      return { passed: false, output: outputs.join("\n").trim() };
    }
  }
  return {
    passed: true,
    output: outputs.filter((o) => o.length > 0).join("\n") || "All polyglot test suites passed"
  };
}

export function runControlGlass(rootDir: string = process.cwd()): EmpiricalEvidenceArtifact {
  const startTime = performance.now();
  const detectedLanguages = detectProjectLanguages(rootDir);
  const polyglotCmds = resolvePolyglotGateCommands(rootDir);

  console.log(
    `🔬 [Control Glass] Starting Polyglot Empirical Verification Pipeline (${detectedLanguages.join(", ") || "typescript"})...\n`
  );

  const typecheckRes = runPolyglotStaticGate(rootDir, polyglotCmds.staticCheckCommands);
  console.log(
    `  1. [Level 1] Static Compiler & Contract Check: ${typecheckRes.passed ? "✅ PASS" : "❌ FAIL"}`
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

  const testRes = runPolyglotTestGate(rootDir, polyglotCmds.testCommands);
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
    detectedLanguages,
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
