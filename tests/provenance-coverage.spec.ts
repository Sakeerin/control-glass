import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runControlGlass } from "../src/harness/control-glass.js";
import { writeTddLockManifest } from "../src/harness/tdd-guard.js";
import { repository, write, commit } from "./review-fixtures.contract.js";

const commandConfig = JSON.stringify({ staticCheckCommands: ["node --version"], testCommands: ["node --version"] });

function project(entries: Readonly<Record<string, string>> = {}): string {
  const root = repository({ "src/value.ts": "export const value = 1;\n", "control-glass.config.json": commandConfig, ...entries });
  writeTddLockManifest(root, { phase: "spec-freeze" });
  commit(root, "baseline");
  return root;
}

function sourceHash(root: string): string {
  const evidence = runControlGlass(root, { silent: true });
  expect(evidence.overallPassed).toBe(true);
  return evidence.provenance.sourceTreeHash;
}

function expectContentChanges(paths: readonly string[]): void {
  const root = project(Object.fromEntries(paths.map(file => [file, "original\n"])));
  let previous = sourceHash(root);
  for (const file of paths) {
    write(root, file, "updated\n");
    const current = sourceHash(root);
    expect(current, file).not.toBe(previous);
    previous = current;
  }
}

describe("Verification input provenance", () => {
  it("covers workflows and YAML, TOML, INI, CFG, and XML configuration", () => {
    expectContentChanges([".github/workflows/verify.yml", ".github/actions/check/action.yaml", "pyproject.toml", "mypy.ini", "setup.cfg", "phpunit.xml"]);
  }, 30_000);

  it("covers native dependency manifests and lock files", () => {
    expectContentChanges(["go.mod", "go.sum", "go.work", "composer.lock", "poetry.lock", "requirements-dev.txt"]);
  }, 30_000);

  it("covers policies, executable scripts, extensionless inputs, and arbitrary file formats", () => {
    expectContentChanges(["AGENTS.md", "skills/custom/SKILL.md", "scripts/check.mjs", "scripts/check.sh", ".npmrc", "Dockerfile", "config/custom.input"]);
  }, 30_000);

  it("changes when configuration is added, renamed, or deleted", () => {
    const root = project();
    const hashes = [sourceHash(root)];
    write(root, "settings.yaml", "enabled: true\n");
    hashes.push(sourceHash(root));
    fs.renameSync(path.join(root, "settings.yaml"), path.join(root, "renamed.yaml"));
    hashes.push(sourceHash(root));
    fs.unlinkSync(path.join(root, "renamed.yaml"));
    expect(new Set(hashes).size).toBe(3);
    expect(sourceHash(root)).toBe(hashes[0]);
  });

  it("stays stable across generated evidence, dependency, build, cache, and Git metadata changes", () => {
    const root = project();
    const before = sourceHash(root);
    for (const file of ["node_modules/package/index.js", "dist/output.js", "vendor/package/composer.json", ".venv/config.ini", "coverage/report.xml", ".cache/generated.yaml", ".pytest_cache/state", ".git/provenance-note", ".control-glass/evidence-latest.json", ".control-glass/dependency-graph.json", ".control-glass/bench-latest.json"]) {
      write(root, file, "generated output\n");
    }
    expect(sourceHash(root)).toBe(before);
    expect(sourceHash(root)).toBe(before);
    const manifestPath = path.join(root, ".control-glass/tdd-lock.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { updatedAt: string; files: Readonly<Record<string, string>> };
    write(root, ".control-glass/tdd-lock.json", JSON.stringify({ ...manifest, updatedAt: "2030-01-01T00:00:00.000Z" }) + "\n");
    commit(root, "new trusted manifest metadata");
    expect(sourceHash(root)).not.toBe(before);
  });

  it("blocks successful evidence when a verification command changes a YAML input", () => {
    const root = project({
      "settings.yaml": "enabled: false\n",
      "mutate.cjs": "require('node:fs').writeFileSync('settings.yaml', 'enabled: true\\n');\n",
      "control-glass.config.json": JSON.stringify({ staticCheckCommands: ["node --version"], testCommands: ["node mutate.cjs"] })
    });
    const evidence = runControlGlass(root, { silent: true });
    expect(evidence.gates.typecheck.passed).toBe(true);
    expect(evidence.gates.unitAndContractTests.passed).toBe(true);
    expect(evidence.overallPassed).toBe(false);
    expect(evidence.errors).toContain("SOURCE_CHANGED_DURING_VERIFICATION");
  });

  it("distinguishes binary content containing separators from multiple file records", () => {
    const root = project({ "a.input": "b\0c.input\0d" });
    const singleFileHash = sourceHash(root);
    write(root, "a.input", "b");
    write(root, "c.input", "d");
    expect(sourceHash(root)).not.toBe(singleFileHash);
  });

  it("is independent of absolute root locations and input creation order", () => {
    const inputs = { "a/value.ini": "value=1\n", "a0.custom": "value=2\n" };
    const first = project(inputs);
    const second = project(Object.fromEntries(Object.entries(inputs).reverse()));
    write(second, ".control-glass/tdd-lock.json", fs.readFileSync(path.join(first, ".control-glass/tdd-lock.json"), "utf8"));
    commit(second, "identical approved manifest");
    expect(sourceHash(first)).toBe(sourceHash(second));
  });

  it("fails closed instead of silently omitting symlinked verification inputs", () => {
    const root = project({ "config/settings.yaml": "enabled: true\n" });
    fs.symlinkSync(path.join(root, "config"), path.join(root, "config-alias"), "junction");
    const evidence = runControlGlass(root, { silent: true });
    expect(evidence.overallPassed).toBe(false);
    expect(evidence.errors.some(error => error.includes("SYMLINK_PROVENANCE_UNSUPPORTED"))).toBe(true);
  });
});
