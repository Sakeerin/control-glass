import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { analyzeDiffAndTier } from "../src/harness/diff-reviewer.js";
import { runControlGlass, resolvePolyglotGateCommands } from "../src/harness/control-glass.js";
import { writeTddLockManifest, verifyTddLock } from "../src/harness/tdd-guard.js";
import { handleMcpRequest, CONTROL_GLASS_MCP_TOOLS } from "../src/harness/mcp-server.js";
import { syncVendorConfigs } from "../src/harness/vendor-sync.js";
import { installGitAndCiHooks } from "../src/harness/hook-installer.js";
import { initControlGlassProject } from "../src/harness/cli.js";
import { fixture, repository, write, git, commit } from "./review-fixtures.contract.js";

describe("Reviewed verification and integration regressions", () => {
  it("fails required PHP gates when their configured executables do not exist", () => {
    const root = repository({ "composer.json": "{}", "src/Broken.php": "<?php\ndeclare(strict_types=1);\nfunction broken(: void {}\n" });
    writeTddLockManifest(root, { phase: "spec-freeze" });
    commit(root, "baseline");
    const report = runControlGlass(root, { silent: true });
    expect(report.overallPassed).toBe(false);
    expect(report.gates.typecheck.passed).toBe(false);
    expect(report.gates.unitAndContractTests.passed).toBe(false);
  });

  it("uses consumer test scripts and explicit configured verification commands", () => {
    const root = fixture({ "package.json": '{"scripts":{"test":"jest"}}' });
    expect(resolvePolyglotGateCommands(root).testCommands).toContain("npm test");
    write(root, "control-glass.config.json", JSON.stringify({ staticCheckCommands: ["node --version"], testCommands: ["node --version"] }));
    expect(resolvePolyglotGateCommands(root)).toMatchObject({ staticCheckCommands: ["node --version"], testCommands: ["node --version"] });
  });

  it("reports skipped unconfigured checks without treating them as passes", () => {
    const root = repository({ "src/value.ts": "export const value = 1;\n" });
    writeTddLockManifest(root, { phase: "spec-freeze" });
    commit(root, "baseline");
    const report = runControlGlass(root, { silent: true });
    expect(report.overallPassed).toBe(false);
    expect(report.gates.typecheck).toMatchObject({ passed: false, status: "skipped" });
    expect(report.gates.unitAndContractTests.passed).toBe(false);
  });

  it("records source provenance and changes its digest when implementation changes", () => {
    const root = repository({ "src/value.ts": "export const value = 1;\n", "control-glass.config.json": '{"staticCheckCommands":["node --version"],"testCommands":["node --version"]}' });
    writeTddLockManifest(root, { phase: "spec-freeze" });
    commit(root, "baseline");
    const before = runControlGlass(root, { silent: true });
    expect(before.overallPassed).toBe(true);
    expect(before.provenance.gitHead).toBe(git(root, "rev-parse", "HEAD"));
    write(root, "src/value.ts", "export const value = 2;\n");
    const after = runControlGlass(root, { silent: true });
    expect(after.provenance.sourceTreeHash).not.toBe(before.provenance.sourceTreeHash);
  });

  it("classifies the entire explicit PR range and both sides of a rename", () => {
    const root = repository({ "src/core/contracts.ts": "export type Value = string;\n", "src/ui/Card.tsx": "export const value = 1;\n" });
    commit(root, "baseline");
    const baseRef = git(root, "rev-parse", "HEAD");
    write(root, "src/core/contracts.ts", "export type Value = number;\n");
    commit(root, "critical change");
    write(root, "src/ui/Card.tsx", "export const value = 2;\n");
    commit(root, "presentation change");
    expect(analyzeDiffAndTier(root, undefined, { baseRef, headRef: "HEAD" }).recommendedTier).toBe("Tier 2");
    git(root, "mv", "src/ui/Card.tsx", "src/core/Card.ts");
    expect(analyzeDiffAndTier(root).recommendedTier).toBe("Tier 2");
  });

  it("never auto-approves unavailable Git or mixed mapped UI and unregistered backend changes", () => {
    const root = fixture({ "feature-map.json": JSON.stringify({ features: [{ id: "card", name: "Card", tier: "Tier 0", riskReason: "presentation", entrypoints: ["src/ui/Card.tsx"], contracts: [], tests: [] }] }) });
    expect(analyzeDiffAndTier(root).recommendedTier).toBe("Tier 2");
    expect(analyzeDiffAndTier(root).routingDecision).not.toContain("AUTO-MERGE ELIGIBLE");
    expect(analyzeDiffAndTier(root, ["src/ui/Card.tsx", "src/features/payment.ts"]).recommendedTier).toBe("Tier 1");
    expect(analyzeDiffAndTier(root, ["src/ui/Card.tsx"]).routingDecision).not.toContain("AUTO-MERGE ELIGIBLE");
  });

  it("rejects a rehashed test manifest until an explicit specification freeze", () => {
    const root = repository({ "tests/example.spec.ts": "export const expected = 1;\n" });
    writeTddLockManifest(root, { phase: "spec-freeze" });
    commit(root, "approved baseline");
    const changed = "export const expected = 2;\n";
    write(root, "tests/example.spec.ts", changed);
    const manifestPath = path.join(root, ".control-glass/tdd-lock.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { files: Record<string, string> };
    manifest.files["tests/example.spec.ts"] = crypto.createHash("sha256").update(changed).digest("hex");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(verifyTddLock(root).passed).toBe(false);
    writeTddLockManifest(root, { phase: "spec-freeze" });
    expect(verifyTddLock(root).passed).toBe(true);
  });

  it("runs static and test gates through MCP without writing protocol logs", () => {
    const root = repository({ "control-glass.config.json": JSON.stringify({ staticCheckCommands: ['node -e "process.exit(7)"'], testCommands: ["node --version"] }) });
    writeTddLockManifest(root, { phase: "spec-freeze" });
    commit(root, "baseline");
    const response = handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "control_glass_verify_gates", arguments: {} } }, root);
    const result = response?.result as { content: Array<{ text: string }>; isError?: boolean };
    const evidence = JSON.parse(result.content[0]?.text ?? "{}") as { overallPassed: boolean; gates: { typecheck: { passed: boolean }; unitAndContractTests: { passed: boolean } } };
    expect(evidence.overallPassed).toBe(false);
    expect(evidence.gates.typecheck.passed).toBe(false);
    expect(evidence.gates.unitAndContractTests.passed).toBe(true);
    expect(result.isError).toBe(true);
  });

  it("rejects malformed MCP tool arguments and never exposes test relocking", () => {
    const root = fixture({ "src/value.ts": "export const value = 1; // preserve on invalid input\n" });
    const before = fs.readFileSync(path.join(root, "src/value.ts"), "utf8");
    const response = handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "control_glass_deslop", arguments: { fix: "false" } } }, root);
    expect(response?.error?.code).toBe(-32602);
    expect(fs.readFileSync(path.join(root, "src/value.ts"), "utf8")).toBe(before);
    expect(CONTROL_GLASS_MCP_TOOLS.some(tool => String(tool.name) === "control_glass_lock_tests")).toBe(false);
  });

  it("preserves existing instructions and MCP servers while generating all advertised vendor targets", () => {
    const root = fixture({ "CLAUDE.md": "EXISTING PROJECT RULES\n", "AGENTS.md": "EXISTING AGENT RULES\n", "mcp_config.json": '{"mcpServers":{"existing":{"command":"existing"}}}' });
    syncVendorConfigs(root);
    syncVendorConfigs(root);
    expect(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8")).toContain("EXISTING PROJECT RULES");
    expect(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8")).toContain("EXISTING AGENT RULES");
    const config = JSON.parse(fs.readFileSync(path.join(root, "mcp_config.json"), "utf8")) as { mcpServers: Record<string, unknown> };
    expect(config.mcpServers).toHaveProperty("existing");
    expect(config.mcpServers).toHaveProperty("control-glass");
    expect(fs.existsSync(path.join(root, ".agent/skills/control-glass-mode/SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "skills/control-glass-mode/SKILL.md"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8").match(/Universal Polyglot & Multi-Vendor Agent Contract/g)).toHaveLength(1);
  });

  it("preserves existing hooks and creates a consumer workflow without undefined npm scripts", () => {
    const root = repository({ "package.json": '{"scripts":{"test":"jest"}}' });
    write(root, ".git/hooks/pre-commit", "#!/bin/sh\nexit 0\n");
    installGitAndCiHooks(root);
    expect(fs.readFileSync(path.join(root, ".git/hooks/pre-commit.control-glass-original"), "utf8")).toContain("exit 0");
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/control-glass.yml"), "utf8");
    expect(workflow).toContain("control-glass verify");
    expect(workflow).not.toContain("npm run bench");
    expect(workflow).toContain("CONTROL_GLASS_BASE_REF");
    expect(workflow).toContain("phpstan");
    expect(workflow).toContain("pytest");
  });

  it("never rebaselines an existing lock when init is repeated", () => {
    const root = repository({ "tests/example.spec.ts": "export const expected = 1;\n" });
    initControlGlassProject(root);
    const before = fs.readFileSync(path.join(root, ".control-glass/tdd-lock.json"), "utf8");
    write(root, "tests/example.spec.ts", "export const expected = 2;\n");
    initControlGlassProject(root);
    expect(fs.readFileSync(path.join(root, ".control-glass/tdd-lock.json"), "utf8")).toBe(before);
    expect(verifyTddLock(root).passed).toBe(false);
  });

  it("imports the public library from a consumer named cli.js without executing its CLI", () => {
    const root = fixture();
    const entry = path.join(root, "cli.js");
    const sourceUrl = pathToFileURL(path.resolve("src/index.ts")).href;
    write(root, "package.json", '{"type":"module"}');
    write(root, "cli.js", `import { createSatang } from ${JSON.stringify(sourceUrl)};\nif (createSatang(1).ok) process.stdout.write("LIBRARY_OK");\n`);
    const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
    const output = execFileSync(process.execPath, ["--import", loader, entry, "languages"], { cwd: root, encoding: "utf8" });
    expect(output).toBe("LIBRARY_OK");
  });
});
