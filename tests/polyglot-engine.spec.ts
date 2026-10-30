import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePolyglotGateCommands } from "../src/harness/control-glass.js";
import { runDuneLinter } from "../src/harness/dune-linter.js";
import {
  POLYGLOT_CONTRACT_TEMPLATES,
  lintNonTsSourceText,
  scanNonTsSlop,
  stripNonTsComments
} from "../src/harness/polyglot-engine.js";

describe("Polyglot Engine (Python, Go, PHP) Verification & Deslop", () => {
  it("passes clean Python, Go, and PHP contract templates with 0 violations", () => {
    const pyViolations = lintNonTsSourceText(
      POLYGLOT_CONTRACT_TEMPLATES.python.content,
      "src/core/contracts.py",
      "python"
    );
    expect(pyViolations).toEqual([]);

    const goViolations = lintNonTsSourceText(
      POLYGLOT_CONTRACT_TEMPLATES.go.content,
      "src/core/contracts.go",
      "go"
    );
    expect(goViolations).toEqual([]);

    const phpViolations = lintNonTsSourceText(
      POLYGLOT_CONTRACT_TEMPLATES.php.content,
      "src/Core/Contracts.php",
      "php"
    );
    expect(phpViolations).toEqual([]);
  });

  it("catches rogue Python comments, # type: ignore, Any, print(), and except: pass", () => {
    const roguePython = [
      "from typing import Any",
      "import subprocess",
      "# band-aid comment",
      "def compute(x: Any) -> int: # type: ignore",
      "    print(x)",
      "    try:",
      "        return 1",
      "    except Exception:",
      "        pass"
    ].join("\n");

    const violations = lintNonTsSourceText(roguePython, "src/ui/view.py", "python", {
      ui: {
        pathPrefix: "src/ui/",
        forbiddenImports: ["subprocess"]
      }
    });

    const ruleIds = violations.map((v) => v.ruleId);
    expect(ruleIds).toContain("DUNE_NO_COMMENTS");
    expect(ruleIds).toContain("DUNE_NO_LINTER_SUPPRESSION");
    expect(ruleIds).toContain("DUNE_NO_EXPLICIT_ANY");
    expect(ruleIds).toContain("DUNE_NO_CONSOLE_IN_DOMAIN");
    expect(ruleIds).toContain("DUNE_BOUNDARY_VIOLATION");

    const slop = scanNonTsSlop(roguePython, "src/ui/view.py", "python");
    expect(slop.some((s) => s.kind === "EMPTY_CATCH_BLOCK")).toBe(true);
  });

  it("catches rogue Go comments, //nolint, interface{}, fmt.Println, and _ = err", () => {
    const rogueGo = [
      "package ui",
      'import "os/exec"',
      "//nolint:errcheck",
      "func Render(payload interface{}) {",
      "    fmt.Println(payload)",
      "    _ = err",
      "}"
    ].join("\n");

    const violations = lintNonTsSourceText(rogueGo, "src/ui/view.go", "go", {
      ui: {
        pathPrefix: "src/ui/",
        forbiddenImports: ["os/exec"]
      }
    });

    const ruleIds = violations.map((v) => v.ruleId);
    expect(ruleIds).toContain("DUNE_NO_LINTER_SUPPRESSION");
    expect(ruleIds).toContain("DUNE_NO_EXPLICIT_ANY");
    expect(ruleIds).toContain("DUNE_NO_CONSOLE_IN_DOMAIN");
    expect(ruleIds).toContain("DUNE_BOUNDARY_VIOLATION");

    const slop = scanNonTsSlop(rogueGo, "src/ui/view.go", "go");
    expect(slop.some((s) => s.kind === "SWALLOWED_ERROR_RESULT")).toBe(true);
  });

  it("catches rogue PHP missing strict_types, mixed, var_dump, and empty catch {}", () => {
    const roguePhp = [
      "<?php",
      "namespace App\\Ui;",
      "use App\\Infra\\Database;",
      "// workaround comment",
      "function render(mixed $data): void {",
      "    var_dump($data);",
      "    try { } catch (\\Throwable $e) { }",
      "}"
    ].join("\n");

    const violations = lintNonTsSourceText(roguePhp, "src/ui/View.php", "php", {
      ui: {
        pathPrefix: "src/ui/",
        forbiddenImports: ["App\\Infra\\Database"]
      }
    });

    const ruleIds = violations.map((v) => v.ruleId);
    expect(ruleIds).toContain("DUNE_PHP_STRICT_TYPES_REQUIRED");
    expect(ruleIds).toContain("DUNE_NO_COMMENTS");
    expect(ruleIds).toContain("DUNE_NO_EXPLICIT_ANY");
    expect(ruleIds).toContain("DUNE_NO_CONSOLE_IN_DOMAIN");
    expect(ruleIds).toContain("DUNE_BOUNDARY_VIOLATION");

    const slop = scanNonTsSlop(roguePhp, "src/ui/View.php", "php");
    expect(slop.some((s) => s.kind === "EMPTY_CATCH_BLOCK")).toBe(true);
  });

  it("strips comments cleanly in Python, Go, and PHP while preserving URLs inside strings", () => {
    const pyCode = 'url = "https://example.com#anchor" # strip this\nx = 1';
    const strippedPy = stripNonTsComments(pyCode, "python");
    expect(strippedPy.removedCount).toBe(1);
    expect(strippedPy.cleanedText).toContain("https://example.com#anchor");
    expect(strippedPy.cleanedText).not.toContain("strip this");

    const goCode = 'url := "https://example.com//path" // strip go comment\n/* multi-line\nblock comment */\nx := 1';
    const strippedGo = stripNonTsComments(goCode, "go");
    expect(strippedGo.removedCount).toBe(2);
    expect(strippedGo.cleanedText).toContain("https://example.com//path");
    expect(strippedGo.cleanedText).not.toContain("strip go comment");
    expect(strippedGo.cleanedText).not.toContain("block comment");

    const pyDoc = '"""\nMulti-line docstring\n"""\nx = 42';
    const strippedDoc = stripNonTsComments(pyDoc, "python");
    expect(strippedDoc.removedCount).toBe(1);
    expect(strippedDoc.cleanedText.trim()).toBe("x = 42");
  });

  it("resolves polyglot static check and test commands for TS, Python, Go, and PHP manifests", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cg-polyglot-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), "[tool.pytest]\n", "utf8");
      fs.writeFileSync(path.join(tmpDir, "go.mod"), "module example.com/app\n", "utf8");
      fs.writeFileSync(path.join(tmpDir, "composer.json"), "{}\n", "utf8");

      const cmds = resolvePolyglotGateCommands(tmpDir);
      expect(cmds.staticCheckCommands).toContain("mypy .");
      expect(cmds.staticCheckCommands).toContain("go vet ./...");
      expect(cmds.staticCheckCommands).toContain("vendor/bin/phpstan analyse");
      expect(cmds.testCommands).toContain("pytest");
      expect(cmds.testCommands).toContain("go test ./...");
      expect(cmds.testCommands).toContain("vendor/bin/phpunit");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("enforces React .tsx component boundary lock against importing node:fs or src/infra/", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cg-react-tsx-"));
    try {
      const compDir = path.join(tmpDir, "components");
      fs.mkdirSync(compDir, { recursive: true });
      fs.writeFileSync(
        path.join(compDir, "Widget.tsx"),
        'import fs from "node:fs";\nexport function Widget() { return <div>{typeof fs}</div>; }\n',
        "utf8"
      );

      const res = runDuneLinter(tmpDir);
      expect(res.passed).toBe(false);
      expect(res.violations.some((v) => v.ruleId === "DUNE_BOUNDARY_VIOLATION")).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("parses React JSX (.tsx) components accurately without false-positive type assertion errors", async () => {
    const ts = await import("typescript");
    const tsxCode = [
      "import type { TelemetryReadoutViewModel } from '../core/contracts.js';",
      "export function TelemetryCard(props: { readonly vm: TelemetryReadoutViewModel }) {",
      "  return <section className=\"card\" data-status={props.vm.status}>{props.vm.missionName}</section>;",
      "}"
    ].join("\n");

    const sf = ts.default.createSourceFile(
      "src/ui/TelemetryCard.tsx",
      tsxCode,
      ts.default.ScriptTarget.Latest,
      true,
      ts.default.ScriptKind.TSX
    );
    expect(sf.statements.length).toBe(2);
  });
});
