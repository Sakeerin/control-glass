import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNonEmptyText } from "../src/core/contracts.js";
import { buildDependencyGraph } from "../src/harness/auto-mapper.js";
import { runControlGlass } from "../src/harness/control-glass.js";
import { runDeslopEngine } from "../src/harness/deslop.js";
import { analyzeDiffAndTier } from "../src/harness/diff-reviewer.js";
import { runDuneLinter } from "../src/harness/dune-linter.js";
import { handleMcpRequest } from "../src/harness/mcp-server.js";
import { runSafetyGate } from "../src/harness/safety-gate.js";
import { verifyTddLock, writeTddLockManifest } from "../src/harness/tdd-guard.js";
import { buildVendorRequestPayload, createVendorModelConfig } from "../src/vendors/llm-gateway.js";
import { commit, fixture, git, repository, write } from "./review-fixtures.contract.js";

const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const cliPath = path.resolve("src/harness/cli.ts");
const commands = { staticCheckCommands: ["node --version"], testCommands: ["node --version"] };

afterEach(() => vi.unstubAllEnvs());

function project(entries: Readonly<Record<string, string>> = {}): string {
  const root = repository({ ".gitignore": ".control-glass/*\n!.control-glass/tdd-lock.json\n", "control-glass.config.json": JSON.stringify(commands), ...entries });
  writeTddLockManifest(root, { phase: "spec-freeze" });
  commit(root, "approved baseline");
  return root;
}

function outputProject(source: string): string {
  return project({ "control-glass.config.json": JSON.stringify({ ...commands, testCommands: ["node tools/emit.cjs"] }), "tools/emit.cjs": source });
}

function cli(root: string, args: readonly string[], overrides: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "false" };
  for (const key of ["CONTROL_GLASS_BASE_REF", "CONTROL_GLASS_HEAD_REF", "CONTROL_GLASS_LOCK_BASE_REF", "CONTROL_GLASS_APPROVED_LOCK_SHA256"]) delete env[key];
  return spawnSync(process.execPath, ["--import", loader, cliPath, ...args], { cwd: root, env: { ...env, ...overrides }, encoding: "utf8", timeout: 20_000 });
}

function nativeUi(file: string, source: string, forbidden: string): string {
  return fixture({ [file]: source, "feature-map.json": JSON.stringify({ architecturalBoundaries: { ui: { pathPrefix: "src/ui/", forbiddenImports: [forbidden] } } }) });
}

describe("Verification input and output contracts", () => {
  it("redacts recognized stdout secrets from API evidence, persisted JSON, and MCP responses", () => {
    const token = "sk-" + "R".repeat(32);
    vi.stubEnv("CG_OUTPUT_VALUE", token);
    const root = outputProject('process.stdout.write(process.env.CG_OUTPUT_VALUE);\n');
    const report = runControlGlass(root, { silent: true });
    expect(report.overallPassed).toBe(true);
    expect(report.gates.unitAndContractTests.output).toContain("[REDACTED]");
    expect(JSON.stringify(report)).not.toContain(token);
    expect(fs.readFileSync(path.join(root, ".control-glass/evidence-latest.json"), "utf8")).not.toContain(token);
    const response = handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "control_glass_verify_gates", arguments: {} } }, root);
    expect(JSON.stringify(response)).not.toContain(token);
    expect(response?.result).toMatchObject({ isError: false });
  }, 20_000);

  it("redacts stderr and failure messages without changing a failed command into a pass", () => {
    const token = "ghp_" + "R".repeat(36);
    vi.stubEnv("CG_OUTPUT_VALUE", token);
    const root = outputProject('process.stderr.write(process.env.CG_OUTPUT_VALUE);\nprocess.exitCode = 7;\n');
    const report = runControlGlass(root, { silent: true });
    expect(report.overallPassed).toBe(false);
    expect(report.gates.unitAndContractTests.status).toBe("failed");
    expect(JSON.stringify(report)).not.toContain(token);
    expect(report.gates.unitAndContractTests.output).toContain("[REDACTED]");
  });

  it("redacts opaque environment credentials and preserves ordinary output", () => {
    const token = 'opaque-"quoted"\ncredential';
    vi.stubEnv("CONTROL_GLASS_PASSWORD", token);
    const root = outputProject('process.stdout.write("SUCCESS 42\\n" + process.env.CONTROL_GLASS_PASSWORD);\n');
    const report = runControlGlass(root, { silent: true });
    expect(report.overallPassed).toBe(true);
    expect(report.gates.unitAndContractTests.output).toContain("SUCCESS 42");
    expect(report.gates.unitAndContractTests.output).not.toContain(token);
    expect(report.gates.unitAndContractTests.output).toContain("[REDACTED]");
    expect(() => JSON.parse(fs.readFileSync(path.join(root, ".control-glass/evidence-latest.json"), "utf8"))).not.toThrow();
  });

  it("redacts the entire private-key block including its body", () => {
    const body = "NOT_A_REAL_KEY_BODY";
    const root = outputProject('process.stdout.write("-----BEGIN " + "PRIVATE KEY-----\\n" + "NOT_A_REAL_KEY_BODY" + "\\n-----END " + "PRIVATE KEY-----");\n');
    const output = runControlGlass(root, { silent: true }).gates.unitAndContractTests.output;
    expect(output).not.toContain(body);
    expect(output).toContain("[REDACTED]");
  });

  it("freezes helper and fixture files in conventional test directories regardless of extension", () => {
    const entries = Object.fromEntries(["tests/support.cjs", "test/expected.json", "__tests__/data.csv", "spec/expected.txt", "specs/helper.js", "fixtures/case.yaml", "__fixtures__/response.xml"].map(file => [file, "approved\n"]));
    const root = repository(entries);
    fs.writeFileSync(path.join(root, "tests/binary.dat"), Buffer.from([0, 1, 2, 255]));
    const manifest = writeTddLockManifest(root, { phase: "spec-freeze" });
    for (const file of [...Object.keys(entries), "tests/binary.dat"]) expect(manifest.files, file).toHaveProperty(file);
    commit(root, "approved baseline");
    expect(verifyTddLock(root).passed).toBe(true);
  });

  it("rejects a changed expected fixture even when the assertion file is untouched", () => {
    const root = project({ "tests/expected.json": '{"value":1}', "tests/value.spec.ts": 'export const expectedFile = "./expected.json";\n' });
    const assertion = fs.readFileSync(path.join(root, "tests/value.spec.ts"), "utf8");
    write(root, "tests/expected.json", '{"value":2}');
    expect(verifyTddLock(root).passed).toBe(false);
    expect(fs.readFileSync(path.join(root, "tests/value.spec.ts"), "utf8")).toBe(assertion);
  });

  it("detects added, deleted, and renamed helper files", () => {
    for (const operation of ["add", "delete", "rename"]) {
      const root = project({ "tests/helper.cjs": "module.exports = 1;\n" });
      if (operation === "add") write(root, "tests/new-helper.cjs", "module.exports = 2;\n");
      else if (operation === "delete") fs.unlinkSync(path.join(root, "tests/helper.cjs"));
      else fs.renameSync(path.join(root, "tests/helper.cjs"), path.join(root, "tests/renamed.cjs"));
      expect(verifyTddLock(root).passed, operation).toBe(false);
    }
  });

  it("normalizes text line endings while hashing binary fixture bytes exactly", () => {
    const root = repository({ "tests/expected.txt": "first\nsecond\n" });
    fs.writeFileSync(path.join(root, "tests/asset.bin"), Buffer.from([0, 13, 10, 255]));
    writeTddLockManifest(root, { phase: "spec-freeze" });
    commit(root, "baseline");
    write(root, "tests/expected.txt", "first\r\nsecond\r\n");
    expect(verifyTddLock(root).passed).toBe(true);
    fs.writeFileSync(path.join(root, "tests/asset.bin"), Buffer.from([0, 10, 255]));
    expect(verifyTddLock(root).passed).toBe(false);
  });

  it("freezes explicitly declared test inputs outside test folders and their selecting configuration", () => {
    const root = repository({ "support/expectation.json": '{"value":1}', "control-glass.config.json": JSON.stringify({ ...commands, testLockFiles: ["support/expectation.json"] }) });
    const manifest = writeTddLockManifest(root, { phase: "spec-freeze" });
    expect(manifest.files).toHaveProperty("support/expectation.json");
    expect(manifest.files).toHaveProperty("control-glass.config.json");
    commit(root, "baseline");
    write(root, "control-glass.config.json", JSON.stringify(commands));
    expect(verifyTddLock(root).passed).toBe(false);
  });

  it("rejects missing, excluded, and escaping explicit test inputs before overwriting a lock", () => {
    for (const file of ["../outside.json", "missing.json", "node_modules/package/input.json"]) {
      const root = project();
      const before = fs.readFileSync(path.join(root, ".control-glass/tdd-lock.json"), "utf8");
      write(root, "control-glass.config.json", JSON.stringify({ ...commands, testLockFiles: [file] }));
      expect(() => writeTddLockManifest(root, { phase: "spec-freeze" }), file).toThrow();
      expect(fs.readFileSync(path.join(root, ".control-glass/tdd-lock.json"), "utf8")).toBe(before);
    }
  });

  it("resolves parenthesized, concatenated, and constant dynamic imports consistently", () => {
    for (const expression of ['import(("node:fs"))', 'import("node:" + "fs")', 'import(target)', 'import(`node:${part}`)']) {
      const root = fixture({ "src/ui/view.ts": 'const part = "fs";\nconst target = "node:" + part;\nexport const load = () => ' + expression + ';\n' });
      expect(runDuneLinter(root).violations.some(item => item.ruleId === "DUNE_BOUNDARY_VIOLATION"), expression).toBe(true);
      expect(buildDependencyGraph(root).nodes["src/ui/view.ts"]?.imports).toContain("node:fs");
    }
  });

  it("resolves constants by lexical scope instead of matching an unrelated outer binding", () => {
    const root = fixture({ "src/ui/view.ts": 'const target = "node:fs";\nexport function load() { const target = "./safe.js"; return import(target); }\n', "src/ui/safe.ts": "export const value = 1;\n" });
    expect(runDuneLinter(root).passed).toBe(true);
    expect(buildDependencyGraph(root).nodes["src/ui/view.ts"]?.imports).toContain("src/ui/safe.ts");
    expect(buildDependencyGraph(root).nodes["src/ui/view.ts"]?.imports).not.toContain("node:fs");
  });

  it("blocks unresolved dynamic imports in restricted layers and exposes incomplete graph references", () => {
    const root = fixture({ "src/ui/view.ts": "export function load(target: string) { return import(target); }\n" });
    expect(runDuneLinter(root).passed).toBe(false);
    expect(buildDependencyGraph(root)).toMatchObject({ unresolvedImports: [expect.objectContaining({ file: "src/ui/view.ts" })] });
    const harness = fixture({ "src/harness/load.ts": "export function load(target: string) { return import(target); }\n" });
    expect(runDuneLinter(harness).passed).toBe(true);
    expect(buildDependencyGraph(harness)).toMatchObject({ unresolvedImports: [expect.objectContaining({ file: "src/harness/load.ts" })] });
  });

  it("checks native require aliases and module.require calls", () => {
    for (const source of ['const load = require;\nexport const value = load(("node:fs"));\n', 'export const value = module.require("node:fs");\n']) {
      const root = fixture({ "src/ui/view.ts": source });
      expect(runDuneLinter(root).passed).toBe(false);
      expect(buildDependencyGraph(root).nodes["src/ui/view.ts"]?.imports).toContain("node:fs");
    }
  });

  it("blocks angle-bracket and parenthesized unknown assertion escapes", () => {
    for (const source of ["export const value = <unknown>1;\n", "export const value = 1 as (unknown);\n", "export const value = [] as Array<unknown>;\n"]) {
      const root = fixture({ "src/value.ts": source });
      expect(runDuneLinter(root).violations.some(item => item.ruleId === "DUNE_NO_TYPE_ASSERTION_ESCAPE"), source).toBe(true);
    }
  });

  it("reads complete Python import syntax including semicolons, continuations, and aliases", () => {
    for (const source of ["import os; import subprocess\n", "import os, \\\n    subprocess as process\n", "from subprocess import (\n    run as execute,\n)\n"]) {
      const root = nativeUi("src/ui/view.py", source, "subprocess");
      expect(runDuneLinter(root).passed, source).toBe(false);
      expect(buildDependencyGraph(root).nodes["src/ui/view.py"]?.imports).toContain("subprocess");
    }
  });

  it("keeps PHP code after heredoc comma, parenthesis, and concatenation terminators visible", () => {
    for (const statement of ['$items = [<<<TXT\nbody\nTXT,\n];', '$text = sprintf("%s", <<<TXT\nbody\nTXT);', '$text = <<<TXT\nbody\nTXT . "tail";']) {
      const root = nativeUi("src/ui/view.php", "<?php\ndeclare(strict_types=1);\n" + statement + "\nuse App\\Infra\\Client;\n", "App\\Infra");
      expect(runDuneLinter(root).passed, statement).toBe(false);
      expect(buildDependencyGraph(root).nodes["src/ui/view.php"]?.imports).toContain("App\\Infra\\Client");
    }
  });

  it("removes comments after PHP heredoc data without changing valid source", () => {
    const source = "<?php\ndeclare(strict_types=1);\n$items = [<<<TXT\n// literal data\nTXT,\n];\n// remove explanation\n";
    const root = fixture({ "src/value.php": source });
    expect(runDeslopEngine(root, true).passed).toBe(true);
    const cleaned = fs.readFileSync(path.join(root, "src/value.php"), "utf8");
    expect(cleaned).toContain("// literal data");
    expect(cleaned).not.toContain("remove explanation");
    expect(spawnSync("php", ["-l", path.join(root, "src/value.php")], { encoding: "utf8" }).status).toBe(0);
  });

  it("handles grouped PHP imports with whitespace, aliases, functions, and constants", () => {
    const source = "<?php\ndeclare(strict_types=1);\nuse App\\Infra\\{\n Client as Remote,\n function connect as open,\n const MODE\n};\n";
    const root = nativeUi("src/ui/view.php", source, "App\\Infra");
    expect(runDuneLinter(root).passed).toBe(false);
    expect(buildDependencyGraph(root).nodes["src/ui/view.php"]?.imports).toEqual(expect.arrayContaining(["App\\Infra\\Client", "App\\Infra\\connect", "App\\Infra\\MODE"]));
  });

  it("parses Python and PHP source without executing project code", () => {
    const root = fixture();
    const sentinel = path.join(root, "must-not-exist");
    write(root, "src/value.py", "from pathlib import Path\nPath(" + JSON.stringify(sentinel) + ').write_text("unexpected")\n');
    write(root, "src/value.php", "<?php\ndeclare(strict_types=1);\nfile_put_contents(" + JSON.stringify(sentinel) + ', "unexpected");\n');
    expect(runDuneLinter(root).passed).toBe(true);
    buildDependencyGraph(root);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it("fails closed when a required native source parser is unavailable", () => {
    const root = fixture({ "src/ui/absent.py": "import subprocess as unavailable_parser_case\n" });
    vi.stubEnv("PATH", path.join(root, "no-executables"));
    expect(runDuneLinter(root).passed).toBe(false);
    expect(() => buildDependencyGraph(root)).toThrow();
  });

  it("decodes UTF-16 LE and BE text before scanning secrets and counting lines", () => {
    const token = "sk-" + "U".repeat(32);
    const text = "ข้อความภาษาไทย\r\nTOKEN=" + token + "\r\n";
    for (const littleEndian of [true, false]) {
      const root = fixture();
      const body = Buffer.from(text, "utf16le");
      if (!littleEndian) body.swap16();
      fs.writeFileSync(path.join(root, "script.ps1"), Buffer.concat([Buffer.from(littleEndian ? [255, 254] : [254, 255]), body]));
      const report = runSafetyGate(root);
      expect(report.passed).toBe(false);
      expect(report.scannedFiles).toBe(1);
      expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ line: 2, category: "SECRET_LEAK" })]));
    }
  });

  it("supports UTF-8 BOM text while retaining ordinary binary exclusions", () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "key.txt"), Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from("sk-" + "B".repeat(32))]));
    fs.writeFileSync(path.join(root, "image.bin"), Buffer.from([0, 1, 2, 255]));
    const report = runSafetyGate(root);
    expect(report.passed).toBe(false);
    expect(report.scannedFiles).toBe(1);
    expect(report.findings).toHaveLength(1);
  });

  it("does not silently skip malformed text with a recognized encoding marker", () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "broken.ps1"), Buffer.from([255, 254, 65]));
    expect(runSafetyGate(root).passed).toBe(false);
  });

  it("rejects retired Claude aliases and dated IDs before building public API requests", () => {
    const prompt = createNonEmptyText("hello");
    if (!prompt.ok) throw new Error("INVALID_TEST_PROMPT");
    for (const model of ["claude-3-7-sonnet-latest", "claude-3-7-sonnet-20250219"]) {
      expect(createVendorModelConfig("anthropic", model)).toMatchObject({ ok: false, error: "RETIRED_VENDOR_MODEL" });
      const branded = createNonEmptyText(model);
      if (!branded.ok) throw new Error("INVALID_TEST_MODEL");
      const config = { vendor: "anthropic" as const, modelId: branded.value, endpointUrl: "https://api.anthropic.com/v1/messages", apiKeyEnvVar: "ANTHROPIC_API_KEY" };
      expect(buildVendorRequestPayload(config, prompt.value, prompt.value, "test-key")).toMatchObject({ ok: false, error: "RETIRED_VENDOR_MODEL" });
    }
  });

  it("preserves custom model selection and independent compatible endpoints", () => {
    expect(createVendorModelConfig("anthropic", "custom-deployment", "https://gateway.example/messages")).toMatchObject({ ok: true, value: { modelId: "custom-deployment" } });
    expect(createVendorModelConfig("anthropic", "claude-3-7-sonnet-latest", "https://gateway.example/messages").ok).toBe(true);
    expect(createVendorModelConfig("openai-compatible", "local-model").ok).toBe(true);
  });

  it("rejects a head reference without a base consistently through library, CLI, and MCP", () => {
    const root = project();
    for (const headRef of ["HEAD", "missing-reference"]) {
      const report = analyzeDiffAndTier(root, undefined, { headRef });
      expect(report.status).toBe("unavailable");
      expect(report.errors).toContain("HEAD_REQUIRES_BASE_REF");
      expect(cli(root, ["diff", "--head", headRef]).status).toBe(1);
      const response = handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "control_glass_diff_tier", arguments: { headRef } } }, root);
      expect(response?.result).toMatchObject({ isError: true });
    }
  }, 20_000);

  it("allows an explicit head with a valid current-project environment base", () => {
    const root = project({ "src/core/value.ts": "export const value = 1;\n" });
    const baseRef = git(root, "rev-parse", "HEAD");
    write(root, "src/core/value.ts", "export const value = 2;\n");
    commit(root, "core change");
    const result = cli(root, ["diff", "--head", "HEAD"], { CONTROL_GLASS_BASE_REF: baseRef });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Tier 2");
  }, 20_000);
});
