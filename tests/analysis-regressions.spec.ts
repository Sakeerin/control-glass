import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { runDeslopEngine } from "../src/harness/deslop.js";
import { runDuneLinter } from "../src/harness/dune-linter.js";
import { buildDependencyGraph } from "../src/harness/auto-mapper.js";
import { runSafetyGate } from "../src/harness/safety-gate.js";
import { stripNonTsComments, scanNonTsSlop } from "../src/harness/polyglot-engine.js";
import { writeTddLockManifest, verifyTddLock } from "../src/harness/tdd-guard.js";
import { fixture, repository } from "./review-fixtures.contract.js";

describe("Reviewed source analysis regressions", () => {
  it("preserves token separation and automatic semicolon insertion when removing TypeScript comments", () => {
    const root = fixture({ "src/value.ts": "export const value = 1 +/* gap */+2;\nexport function result() { return/* line\n*/42; }\n" });
    expect(runDeslopEngine(root, true).passed).toBe(true);
    const cleaned = fs.readFileSync(path.join(root, "src/value.ts"), "utf8");
    const emitted = ts.transpileModule(cleaned, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022 } });
    expect((emitted.diagnostics ?? []).map(diagnostic => diagnostic.code)).toEqual([]);
    expect(cleaned).not.toContain("++2");
    expect(cleaned).toMatch(/return[^\S\n]*\n/);
  });

  it("preserves Python multiline string data and all executable code after it", () => {
    const source = 'query = """\nSELECT 1 # data\n"""\nvalue = 42\n';
    expect(stripNonTsComments(source, "python").cleanedText).toBe(source);
    expect(stripNonTsComments(source, "python").removedCount).toBe(0);
  });

  it("preserves Go raw string data and PHP heredoc data", () => {
    const go = 'package main\nvar data = `first\n// data\nlast`\n';
    const php = '<?php\ndeclare(strict_types=1);\n$data = <<<TXT\n// data\nTXT;\n';
    expect(stripNonTsComments(go, "go").cleanedText).toBe(go);
    expect(stripNonTsComments(php, "php").cleanedText).toBe(php);
  });

  it("keeps a Python docstring-only function syntactically inhabited", () => {
    const cleaned = stripNonTsComments('def empty():\n    """documentation"""\n', "python").cleanedText;
    expect(cleaned).toContain("pass");
  });

  it("does not classify JSX text, regex literals, or template literal text as comments", () => {
    const root = fixture({
      "src/ui/Card.tsx": 'export const Card = () => <p>https://example.com</p>;\n',
      "src/pattern.ts": 'export const pattern = /[/*]/;\nexport const text = `https://example.com`;\n'
    });
    expect(runDuneLinter(root).violations).toEqual([]);
    const original = fs.readFileSync(path.join(root, "src/ui/Card.tsx"), "utf8");
    runDeslopEngine(root, true);
    expect(fs.readFileSync(path.join(root, "src/ui/Card.tsx"), "utf8")).toBe(original);
  });

  it("rejects import-equals, crypto, and aliases resolving to infrastructure from UI", () => {
    const root = fixture({
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
      "src/ui/view.ts": 'import fs = require("node:fs");\nimport { createHash } from "node:crypto";\nimport { database } from "@/infra/database";\nexport const values = [fs, createHash, database];\n',
      "src/infra/database.ts": "export const database = 1;\n"
    });
    const violations = runDuneLinter(root).violations.filter(v => v.ruleId === "DUNE_BOUNDARY_VIOLATION");
    expect(violations.length).toBeGreaterThanOrEqual(3);
  });

  it("covers root source files, command entrypoints, and command tests consistently", () => {
    const key = "sk-" + "A".repeat(32);
    const root = repository({
      "main.py": "print(1)\n",
      "cmd/main.go": 'package main\nvar key = "' + key + '"\n',
      "cmd/main_test.go": "package main\n"
    });
    expect(runDuneLinter(root).violations.some(v => v.file === "main.py")).toBe(true);
    expect(runSafetyGate(root).findings.some(v => v.file === "cmd/main.go")).toBe(true);
    const manifest = writeTddLockManifest(root, { phase: "spec-freeze" });
    expect(manifest.files).toHaveProperty("cmd/main_test.go");
    expect(verifyTddLock(root).passed).toBe(true);
  });

  it("resolves extensionless imports, TSX exports, and barrel reexports", () => {
    const root = fixture({
      "src/Card.tsx": "export const Card = () => <p>ok</p>;\n",
      "src/App.tsx": 'import { Card } from "./Card";\nexport const App = Card;\n',
      "src/index.ts": 'export { Card } from "./Card.js";\n'
    });
    const graph = buildDependencyGraph(root);
    expect(graph.nodes["src/App.tsx"]?.imports).toContain("src/Card.tsx");
    expect(graph.nodes["src/index.ts"]?.imports).toContain("src/Card.tsx");
    expect(graph.nodes["src/Card.tsx"]?.importedBy).toEqual(expect.arrayContaining(["src/App.tsx", "src/index.ts"]));
  });

  it("does not flag debugger text inside data strings and catches multiline empty PHP catches", () => {
    expect(scanNonTsSlop('message = "breakpoint()"\n', "main.py", "python")).toEqual([]);
    expect(scanNonTsSlop("try {} catch (Throwable $error) {\n}\n", "main.php", "php").some(v => v.kind === "EMPTY_CATCH_BLOCK")).toBe(true);
  });
});
