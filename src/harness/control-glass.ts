import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { buildDependencyGraph } from "./auto-mapper.js";
import { runDeslopEngine } from "./deslop.js";
import { analyzeDiffAndTier, type DiffOptions, type DiffReviewReport } from "./diff-reviewer.js";
import { runDuneLinter } from "./dune-linter.js";
import { detectProjectLanguages, type SupportedLanguage } from "./polyglot-engine.js";
import { runSafetyGate } from "./safety-gate.js";
import { verifyTddLock } from "./tdd-guard.js";
import { loadCommandConfig } from "./project-config.js";
import { collectProvenanceFiles } from "./file-inventory.js";
import { isDirectExecution, readGit } from "./runtime.js";
import { createSecretRedactor, redactReportStrings } from "./secret-redaction.js";

export type GateStatus = "passed" | "failed" | "skipped" | "error";
export interface CommandExecution {
  readonly command: string;
  readonly passed: boolean;
  readonly status: GateStatus;
  readonly output: string;
  readonly durationMs: number;
}
export interface CommandGateResult {
  readonly passed: boolean;
  readonly status: GateStatus;
  readonly output: string;
  readonly commands: readonly CommandExecution[];
}
export interface ControlGlassOptions extends DiffOptions { readonly silent?: boolean; }
export interface PolyglotGateCommands {
  readonly staticCheckCommands: readonly string[];
  readonly testCommands: readonly string[];
}
export interface EmpiricalEvidenceArtifact {
  readonly timestamp: string;
  readonly durationMs: number;
  readonly detectedLanguages: readonly SupportedLanguage[];
  readonly overallPassed: boolean;
  readonly errors: readonly string[];
  readonly gates: {
    readonly typecheck: CommandGateResult;
    readonly duneAstLinter: ReturnType<typeof runDuneLinter> & { readonly violationCount: number };
    readonly deslopEngine: ReturnType<typeof runDeslopEngine> & { readonly issueCount: number };
    readonly safetyAndSecretGate: ReturnType<typeof runSafetyGate> & { readonly findingCount: number };
    readonly tddContractLock: ReturnType<typeof verifyTddLock>;
    readonly unitAndContractTests: CommandGateResult & { readonly summary: string };
  };
  readonly provenance: { readonly gitHead: string | null; readonly sourceTreeHash: string; readonly nodeVersion: string; readonly toolVersion: string };
  readonly dependencyGraphSummary: { readonly totalMappedFiles: number; readonly unresolvedImportCount: number };
  readonly phase3Orchestration: DiffReviewReport;
}

export function resolvePolyglotGateCommands(rootDir: string): PolyglotGateCommands {
  const config = loadCommandConfig(rootDir);
  const staticCheckCommands: string[] = [];
  const testCommands: string[] = [];
  if (fs.existsSync(path.join(rootDir, "tsconfig.json"))) staticCheckCommands.push("npx --no-install tsc --noEmit");
  const packagePath = path.join(rootDir, "package.json");
  if (fs.existsSync(packagePath)) {
    const pkg = z.object({ scripts: z.record(z.string()).default({}) }).parse(JSON.parse(fs.readFileSync(packagePath, "utf8")));
    if (pkg.scripts["test"]) {
      if (/control-glass.*verify|npm\s+(?:run\s+)?verify/.test(pkg.scripts["test"])) throw new Error("RECURSIVE_TEST_COMMAND");
      testCommands.push("npm test");
    }
  }
  if (["pyproject.toml", "mypy.ini", "requirements.txt"].some(file => fs.existsSync(path.join(rootDir, file)))) { staticCheckCommands.push("mypy ."); testCommands.push("pytest"); }
  if (fs.existsSync(path.join(rootDir, "go.mod"))) { staticCheckCommands.push("go vet ./..."); testCommands.push("go test ./..."); }
  if (["composer.json", "phpunit.xml"].some(file => fs.existsSync(path.join(rootDir, file)))) { staticCheckCommands.push("vendor/bin/phpstan analyse"); testCommands.push("vendor/bin/phpunit"); }
  return { staticCheckCommands: config.staticCheckCommands ?? staticCheckCommands, testCommands: config.testCommands ?? testCommands };
}

function runCommands(rootDir: string, commands: readonly string[], timeoutMs: number): CommandGateResult {
  const redact = createSecretRedactor();
  if (commands.length === 0) return { passed: false, status: "skipped", output: "Required gate has no configured command.", commands: [] };
  const executions: CommandExecution[] = [];
  for (const command of commands) {
    const started = performance.now();
    try {
      const output = execSync(command, { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }).trim();
      executions.push({ command: redact(command), passed: true, status: "passed", output: redact(output), durationMs: Math.round(performance.now() - started) });
    } catch (error: unknown) {
      const failure = error as { stdout?: string; stderr?: string; message?: string; status?: number | null };
      executions.push({ command: redact(command), passed: false, status: failure.status === null || failure.status === undefined ? "error" : "failed", output: redact([failure.stdout ?? "", failure.stderr ?? "", failure.message ?? ""].join("\n").trim()), durationMs: Math.round(performance.now() - started) });
    }
  }
  const passed = executions.every(command => command.passed);
  return { passed, status: passed ? "passed" : executions.some(command => command.status === "error") ? "error" : "failed", output: executions.map(command => command.command + "\n" + command.output).join("\n"), commands: executions };
}

function attempt<T>(operation: () => T, fallback: T, errors: string[], name: string): T {
  try { return operation(); }
  catch (error: unknown) { errors.push(name + ": " + createSecretRedactor()(error instanceof Error ? error.message : "Unexpected error")); return fallback; }
}

function hashProjectSource(rootDir: string): string {
  const hash = crypto.createHash("sha256").update("control-glass-provenance-v2\0");
  for (const file of collectProvenanceFiles(rootDir)) {
    const contentHash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    hash.update(path.relative(rootDir, file).split(path.sep).join("/")).update("\0").update(contentHash).update("\0");
  }
  return hash.digest("hex");
}

export function runControlGlass(rootDir: string = process.cwd(), options: ControlGlassOptions = {}): EmpiricalEvidenceArtifact {
  const started = performance.now();
  const errors: string[] = [];
  const initialSourceHash = attempt(() => hashProjectSource(rootDir), "unavailable", errors, "Initial source provenance");
  const config = attempt(() => loadCommandConfig(rootDir), { timeoutMs: 120_000 }, errors, "configuration");
  const detectedLanguages = attempt(() => detectProjectLanguages(rootDir), [], errors, "language detection");
  const commands = attempt(() => resolvePolyglotGateCommands(rootDir), { staticCheckCommands: [], testCommands: [] }, errors, "command resolution");
  const safety = attempt(() => runSafetyGate(rootDir), { passed: false, scannedFiles: 0, findings: [] }, errors, "Safety");
  const blockedCommands: CommandGateResult = { passed: false, status: "error", output: "Command execution blocked by the safety gate.", commands: [] };
  const typecheck = safety.passed ? runCommands(rootDir, commands.staticCheckCommands, config.timeoutMs) : blockedCommands;
  const dune = attempt(() => runDuneLinter(rootDir), { passed: false, checkedFiles: 0, violations: [] }, errors, "Dune");
  const deslop = attempt(() => runDeslopEngine(rootDir), { passed: false, scannedFiles: 0, cleanedCommentCount: 0, issues: [] }, errors, "Deslop");
  const tdd = attempt(() => verifyTddLock(rootDir, options), { passed: false, violations: ["TDD gate failed unexpectedly."] }, errors, "TDD");
  const tests = safety.passed ? runCommands(rootDir, commands.testCommands, config.timeoutMs) : blockedCommands;
  const graph = attempt(() => buildDependencyGraph(rootDir), { totalFiles: 0, generatedAt: new Date().toISOString(), nodes: {}, unresolvedImports: [] }, errors, "Dependency mapping");
  const sourceTreeHash = attempt(() => hashProjectSource(rootDir), "unavailable", errors, "Source provenance");
  if (sourceTreeHash !== initialSourceHash) errors.push("SOURCE_CHANGED_DURING_VERIFICATION");
  const gatesPassed = typecheck.passed && dune.passed && deslop.passed && safety.passed && tdd.passed && tests.passed && errors.length === 0;
  const diff = analyzeDiffAndTier(rootDir, undefined, { ...options, gatesPassed });
  const head = readGit(rootDir, ["rev-parse", "--verify", "HEAD"]);
  const artifact: EmpiricalEvidenceArtifact = redactReportStrings({
    timestamp: new Date().toISOString(), durationMs: Math.round(performance.now() - started), detectedLanguages,
    overallPassed: gatesPassed && diff.status === "known" && errors.length === 0, errors,
    gates: { typecheck, duneAstLinter: { ...dune, violationCount: dune.violations.length }, deslopEngine: { ...deslop, issueCount: deslop.issues.length }, safetyAndSecretGate: { ...safety, findingCount: safety.findings.length }, tddContractLock: tdd, unitAndContractTests: { ...tests, summary: tests.passed ? "All configured test commands passed." : tests.output } },
    provenance: { gitHead: head.ok ? head.value.trim() : null, sourceTreeHash, nodeVersion: process.version, toolVersion: "3.0.0" },
    dependencyGraphSummary: { totalMappedFiles: graph.totalFiles, unresolvedImportCount: graph.unresolvedImports.length }, phase3Orchestration: diff
  });
  const evidencePath = path.join(rootDir, ".control-glass/evidence-latest.json");
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath + ".tmp", JSON.stringify(artifact, null, 2) + "\n", "utf8");
  fs.renameSync(evidencePath + ".tmp", evidencePath);
  if (!options.silent) {
    for (const [name, result] of Object.entries(artifact.gates)) console.log(name + ": " + (result.passed ? "PASS" : "FAIL"));
    console.log("Review: " + diff.recommendedTier + " — " + diff.routingDecision);
    console.log("Control Glass: " + (artifact.overallPassed ? "PASSED" : "FAILED"));
    if (!artifact.overallPassed) console.error(JSON.stringify(artifact, null, 2));
  }
  return artifact;
}

if (isDirectExecution(import.meta.url)) {
  if (!runControlGlass().overallPassed) process.exitCode = 1;
}
