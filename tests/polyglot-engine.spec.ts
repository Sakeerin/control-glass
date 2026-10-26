import { describe, expect, it } from "vitest";
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

    const goCode = 'url := "https://example.com//path" // strip go comment';
    const strippedGo = stripNonTsComments(goCode, "go");
    expect(strippedGo.removedCount).toBe(1);
    expect(strippedGo.cleanedText).toContain("https://example.com//path");
    expect(strippedGo.cleanedText).not.toContain("strip go comment");
  });
});
