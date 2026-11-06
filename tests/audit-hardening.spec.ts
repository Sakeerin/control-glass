import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { buildDependencyGraph } from "../src/harness/auto-mapper.js";
import { runControlGlass } from "../src/harness/control-glass.js";
import { runDeslopEngine } from "../src/harness/deslop.js";
import { analyzeDiffAndTier } from "../src/harness/diff-reviewer.js";
import { runDuneLinter } from "../src/harness/dune-linter.js";
import { handleMcpRequest } from "../src/harness/mcp-server.js";
import { stripNonTsComments } from "../src/harness/polyglot-engine.js";
import { runSafetyGate } from "../src/harness/safety-gate.js";
import { writeTddLockManifest } from "../src/harness/tdd-guard.js";
import { commit, fixture, git, repository, write } from "./review-fixtures.contract.js";

const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const cliPath = path.resolve("src/harness/cli.ts");
const commandConfig = JSON.stringify({ staticCheckCommands: ["node --version"], testCommands: ["node --version"] });

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "false" };
  for (const name of ["CONTROL_GLASS_BASE_REF", "CONTROL_GLASS_HEAD_REF", "CONTROL_GLASS_LOCK_BASE_REF", "CONTROL_GLASS_APPROVED_LOCK_SHA256"]) delete env[name];
  return { ...env, ...overrides };
}

function cli(root: string, args: readonly string[], overrides: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["--import", loader, cliPath, ...args], { cwd: root, env: environment(overrides), encoding: "utf8", timeout: 30_000 });
}

function verificationHistory(): { root: string; baseRef: string } {
  const root = repository({ ".gitignore": ".control-glass/*\n!.control-glass/tdd-lock.json\n", "control-glass.config.json": commandConfig, "tests/value.spec.ts": "export const expected = 1;\n" });
  writeTddLockManifest(root, { phase: "spec-freeze" });
  commit(root, "approved specification");
  return { root, baseRef: git(root, "rev-parse", "HEAD") };
}

function changeLockedExpectation(root: string): void {
  const source = "export const expected = 2;\n";
  write(root, "tests/value.spec.ts", source);
  const lockPath = path.join(root, ".control-glass/tdd-lock.json");
  const manifest = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { files: Record<string, string> };
  manifest.files["tests/value.spec.ts"] = crypto.createHash("sha256").update(source).digest("hex");
  fs.writeFileSync(lockPath, JSON.stringify(manifest, null, 2) + "\n");
}

function uiHistory(source = 'export function label() { return "paid"; }\n'): { root: string; baseRef: string } {
  const root = repository({ "src/ui/view.ts": source });
  commit(root, "baseline");
  return { root, baseRef: git(root, "rev-parse", "HEAD") };
}

describe("Audited verification hardening", () => {
  it("rejects a committed rehashed lock against the explicit baseline through API, MCP, and CLI", () => {
    const { root, baseRef } = verificationHistory();
    changeLockedExpectation(root);
    commit(root, "unapproved rewritten expectation");
    const report = runControlGlass(root, { baseRef, silent: true });
    expect(report.gates.tddContractLock.passed).toBe(false);
    expect(report.gates.tddContractLock.violations.join(" ")).toContain("UNTRUSTED_TDD_MANIFEST");
    expect(report.overallPassed).toBe(false);
    const response = handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "control_glass_verify_gates", arguments: { baseRef } } }, root);
    expect(response?.result).toMatchObject({ isError: true });
    const child = cli(root, ["verify", "--base", baseRef, "--head", "HEAD"], { CI: "true" });
    expect(child.status).toBe(1);
    expect(child.stderr).toContain("UNTRUSTED_TDD_MANIFEST");
  }, 30_000);

  it("trusts the unchanged explicit baseline and a subsequent local Phase 1 receipt", () => {
    const { root, baseRef } = verificationHistory();
    write(root, "src/value.ts", "export const value = 1;\n");
    commit(root, "implementation");
    expect(runControlGlass(root, { baseRef, silent: true }).overallPassed).toBe(true);
    changeLockedExpectation(root);
    writeTddLockManifest(root, { phase: "spec-freeze" });
    expect(runControlGlass(root, { baseRef, silent: true }).gates.tddContractLock.passed).toBe(true);
  }, 20_000);

  it("honors an exact CI approval and a dedicated trusted lock baseline", () => {
    const { root, baseRef } = verificationHistory();
    changeLockedExpectation(root);
    commit(root, "separately approved specification");
    const approvedRef = git(root, "rev-parse", "HEAD");
    const content = fs.readFileSync(path.join(root, ".control-glass/tdd-lock.json"), "utf8").replace(/\r\n/g, "\n");
    const approvedHash = crypto.createHash("sha256").update(content).digest("hex");
    expect(cli(root, ["verify", "--base", baseRef], { CI: "true", CONTROL_GLASS_APPROVED_LOCK_SHA256: approvedHash }).status).toBe(0);
    expect(cli(root, ["verify", "--base", baseRef], { CI: "true", CONTROL_GLASS_LOCK_BASE_REF: approvedRef }).status).toBe(0);
  }, 20_000);

  it("scans secrets in workflows, native config, scripts, JavaScript, extensionless files, and the scanner itself", () => {
    const token = "sk-" + "Z".repeat(32);
    for (const file of [".github/workflows/ci.yml", "pyproject.toml", "scripts/task.sh", "src/value.js", "credentials", "src/harness/safety-gate.ts"]) {
      const root = fixture({ [file]: "TOKEN=" + token + "\n" });
      const report = runSafetyGate(root);
      expect(report.passed, file).toBe(false);
      expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ file, category: "SECRET_LEAK" })]));
      expect(JSON.stringify(report.findings)).not.toContain(token);
    }
  });

  it("scans documentation secrets while treating documented SQL and shell examples as prose", () => {
    const root = fixture({ "AGENTS.md": "Never execute " + "DROP" + " TABLE" + " or " + "eval" + "(input).\n" });
    expect(runSafetyGate(root).passed).toBe(true);
    write(root, "README.md", "TOKEN=" + "sk-" + "X".repeat(32));
    expect(runSafetyGate(root).findings).toEqual(expect.arrayContaining([expect.objectContaining({ file: "README.md", category: "SECRET_LEAK" })]));
    write(root, "key.pem", "-----BEGIN " + "PRIVATE KEY-----\n");
    expect(runSafetyGate(root).findings.some(item => item.file === "key.pem")).toBe(true);
  });

  it("excludes dependency, output, Git, cache, and binary files from text safety scanning", () => {
    const token = "sk-" + "Y".repeat(32);
    const root = fixture(Object.fromEntries(["node_modules/dependency/config.yml", "dist/output.js", ".git/config", ".control-glass/evidence-latest.json", ".cache/file.txt"].map(file => [file, token])));
    fs.writeFileSync(path.join(root, "asset.bin"), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(token)]));
    expect(runSafetyGate(root).passed).toBe(true);
    expect(runSafetyGate(root).scannedFiles).toBe(0);
  });

  it("checks executable/config text for hazards regardless of its extension", () => {
    const root = fixture({ "scripts/task.sh": "eval" + "(input)\n", "migration.sql": "DROP" + " TABLE example;\n" });
    const findings = runSafetyGate(root).findings;
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: "scripts/task.sh", category: "UNSAFE_EXECUTION" }),
      expect.objectContaining({ file: "migration.sql", category: "DESTRUCTIVE_COMMAND" })
    ]));
  });

  it("preserves embedded Go assets and runtime behavior during comment autofix", () => {
    const root = fixture({
      "go.mod": "module audit.local/embed\n\ngo 1.22\n",
      "payload.txt": "EMBED_OK",
      "main.go": 'package main\nimport (\n "embed"\n "os"\n)\n//go:embed payload.txt\nvar payload embed.FS\nfunc main() {\n data, err := payload.ReadFile("payload.txt")\n if err != nil { os.Stdout.WriteString("MISSING"); return }\n os.Stdout.Write(data)\n}\n'
    });
    const run = () => execFileSync("go", ["run", "."], { cwd: root, encoding: "utf8", timeout: 120_000, env: { ...process.env, GOWORK: "off", GOTOOLCHAIN: "local", GOPROXY: "off", GOSUMDB: "off" } });
    expect(run()).toBe("EMBED_OK");
    expect(runDeslopEngine(root, true).passed).toBe(true);
    expect(run()).toBe("EMBED_OK");
    expect(fs.readFileSync(path.join(root, "main.go"), "utf8")).toContain("//go:embed payload.txt");
    expect(runDuneLinter(root).violations.filter(item => item.ruleId === "DUNE_NO_COMMENTS")).toEqual([]);
  }, 120_000);

  it("preserves Go compiler and tooling directives while still removing ordinary comments", () => {
    const directives = "//go:generate go run ./tools\n//go:noinline\n//line generated.go:10\n";
    const source = "package main\n" + directives + "func value() int { return 1 }\n// ordinary explanation\n";
    const result = stripNonTsComments(source, "go");
    expect(result.cleanedText).toContain(directives);
    expect(result.cleanedText).not.toContain("ordinary explanation");
    expect(result.removedCount).toBe(1);
  });

  it("checks template-literal imports and requires consistently in the linter and graph", () => {
    const root = fixture({ "src/ui/view.ts": 'export const load = () => import(`node:fs`);\nexport const loadCrypto = () => require(`node:crypto`);\n' });
    const violations = runDuneLinter(root).violations.filter(item => item.ruleId === "DUNE_BOUNDARY_VIOLATION");
    expect(violations).toHaveLength(2);
    expect(buildDependencyGraph(root).nodes["src/ui/view.ts"]?.imports).toEqual(expect.arrayContaining(["node:fs", "node:crypto"]));
  });

  it("checks every Python comma import including aliases and records the same graph imports", () => {
    const root = fixture({
      "feature-map.json": JSON.stringify({ architecturalBoundaries: { ui: { pathPrefix: "src/ui/", forbiddenImports: ["subprocess"] } } }),
      "src/ui/view.py": "import os as operating_system, subprocess as process\n"
    });
    expect(runDuneLinter(root).violations.some(item => item.ruleId === "DUNE_BOUNDARY_VIOLATION")).toBe(true);
    expect(buildDependencyGraph(root).nodes["src/ui/view.py"]?.imports).toEqual(expect.arrayContaining(["os", "subprocess"]));
  });

  it("checks aliased, comma, and grouped PHP namespace imports consistently with the graph", () => {
    for (const statement of ["use App\\Infra\\Client as Remote;", "use App\\Safe\\View, App\\Infra\\Client as Remote;", "use App\\Infra\\{Client as Remote, Connection};"]) {
      const root = fixture({
        "feature-map.json": JSON.stringify({ architecturalBoundaries: { ui: { pathPrefix: "src/ui/", forbiddenImports: ["App\\Infra"] } } }),
        "src/ui/view.php": "<?php\ndeclare(strict_types=1);\n" + statement + "\n"
      });
      expect(runDuneLinter(root).violations.some(item => item.ruleId === "DUNE_BOUNDARY_VIOLATION"), statement).toBe(true);
      expect(buildDependencyGraph(root).nodes["src/ui/view.php"]?.imports).toContain("App\\Infra\\Client");
    }
  });

  it("does not invent native dependencies from multiline string data", () => {
    const root = fixture({ "src/text.py": 'text = """\nimport subprocess\n"""\n', "src/text.php": '<?php\ndeclare(strict_types=1);\n$text = <<<TXT\nuse App\\Infra\\Client;\nTXT;\n' });
    const graph = buildDependencyGraph(root);
    expect(graph.nodes["src/text.py"]?.imports).toEqual([]);
    expect(graph.nodes["src/text.php"]?.imports).toEqual([]);
    expect(runDuneLinter(root).passed).toBe(true);
  });

  it("requires owner review for UI logic even when a feature declares Tier 0 and gates pass", () => {
    const { root } = uiHistory('export function charge() { return 1; }\n');
    write(root, "feature-map.json", JSON.stringify({ features: [{ id: "charge", name: "Charge", tier: "Tier 0", riskReason: "UI", entrypoints: ["src/ui/view.ts"], contracts: [], tests: [] }] }));
    commit(root, "register UI feature");
    write(root, "src/ui/view.ts", "export function charge() { return 100000; }\n");
    const report = analyzeDiffAndTier(root, ["src/ui/view.ts"], { gatesPassed: true });
    expect(report.recommendedTier).toBe("Tier 1");
    expect(report.routingDecision).toContain("OWNER REVIEW REQUIRED");
    expect(report.routingDecision).not.toContain("AUTO-MERGE ELIGIBLE");
  });

  it("allows proven UI formatting only after every verification gate passes", () => {
    const { root } = uiHistory();
    write(root, "src/ui/view.ts", 'export function label(){\n  return "paid";\n}\n');
    const report = analyzeDiffAndTier(root, undefined, { gatesPassed: true });
    expect(report.recommendedTier).toBe("Tier 0");
    expect(report.routingDecision).toContain("AUTO-MERGE ELIGIBLE");
    expect(analyzeDiffAndTier(root).routingDecision).not.toContain("AUTO-MERGE ELIGIBLE");
  });

  it("requires review for added, deleted, and renamed UI code", () => {
    for (const operation of ["add", "delete", "rename"]) {
      const { root } = uiHistory();
      if (operation === "add") write(root, "src/ui/new.ts", "export const value = 1;\n");
      else if (operation === "delete") fs.unlinkSync(path.join(root, "src/ui/view.ts"));
      else git(root, "mv", "src/ui/view.ts", "src/ui/renamed.ts");
      const report = analyzeDiffAndTier(root, undefined, { gatesPassed: true });
      expect(report.recommendedTier, operation).toBe("Tier 1");
      expect(report.routingDecision).not.toContain("AUTO-MERGE ELIGIBLE");
    }
  });

  it("keeps filename-only classification advisory and refuses auto-approval without diff content", () => {
    const root = fixture();
    const report = analyzeDiffAndTier(root, ["src/ui/Unknown.tsx"], { gatesPassed: true });
    expect(report.recommendedTier).toBe("Tier 0");
    expect(report.routingDecision).not.toContain("AUTO-MERGE ELIGIBLE");
  });

  it("reviews UI logic in the requested commit range even if checkout later restores it", () => {
    const { root, baseRef } = uiHistory();
    write(root, "src/ui/view.ts", 'export function label() { return "refunded"; }\n');
    commit(root, "logic change");
    const headRef = git(root, "rev-parse", "HEAD");
    write(root, "src/ui/view.ts", 'export function label(){return "paid";}\n');
    commit(root, "restore logic");
    const report = analyzeDiffAndTier(root, undefined, { baseRef, headRef, gatesPassed: true });
    expect(report.recommendedTier).toBe("Tier 1");
    expect(report.routingDecision).not.toContain("AUTO-MERGE ELIGIBLE");
  });

  it("treats type changes, JSX whitespace, and automatic semicolon changes as reviewable code", () => {
    for (const [before, after, file] of [
      ['export type Permission = "read";\n', 'export type Permission = "write";\n', "view.ts"],
      ["export const View = () => <p>hello world</p>;\n", "export const View = () => <p>helloworld</p>;\n", "view.tsx"],
      ["export function value() { return 42; }\n", "export function value() { return\n42; }\n", "view.ts"]
    ]) {
      const root = repository({ ["src/ui/" + file]: before ?? "" });
      commit(root, "baseline");
      write(root, "src/ui/" + file, after ?? "");
      expect(analyzeDiffAndTier(root, undefined, { gatesPassed: true }).recommendedTier).toBe("Tier 1");
    }
  });

  it("uses CLI --head instead of checkout HEAD and overrides conflicting CI references", () => {
    const root = repository({ "src/core/value.ts": "export const value = 1;\n", "src/ui/view.ts": "export const view = 1;\n" });
    commit(root, "baseline");
    const baseRef = git(root, "rev-parse", "HEAD");
    write(root, "src/core/value.ts", "export const value = 2;\n");
    commit(root, "core change");
    const headRef = git(root, "rev-parse", "HEAD");
    write(root, "src/core/value.ts", "export const value = 1;\n");
    write(root, "src/ui/view.ts", "export const view = 2;\n");
    commit(root, "restore core");
    const child = cli(root, ["diff", "--base", baseRef, "--head", headRef], { CI: "true", CONTROL_GLASS_BASE_REF: "missing-base", CONTROL_GLASS_HEAD_REF: "missing-head" });
    expect(child.status).toBe(0);
    expect(child.stdout).toContain("Tier 2");
    expect(child.stdout).toContain("SENIOR / DOMAIN EXPERT REVIEW REQUIRED");
  }, 20_000);

  it("rejects missing, repeated, and unknown diff arguments for both CLI commands", () => {
    const root = repository({ "baseline.txt": "baseline\n" });
    commit(root, "baseline");
    for (const command of ["diff", "verify"]) {
      for (const args of [["--base"], ["--head"], ["--base", "--head", "HEAD"], ["--base", "HEAD", "--base", "HEAD"], ["--unknown"]]) {
        const child = cli(root, [command, ...args]);
        expect(child.status, command + " " + args.join(" ")).toBe(1);
        expect(child.stdout).not.toContain("Control Glass: PASSED");
      }
    }
  }, 30_000);
});
