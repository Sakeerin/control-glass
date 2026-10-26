import fs from "node:fs";
import path from "node:path";

export type SupportedLanguage = "typescript" | "python" | "go" | "php";

export interface PolyglotViolation {
  readonly file: string;
  readonly line: number;
  readonly language: SupportedLanguage;
  readonly ruleId:
    | "DUNE_NO_COMMENTS"
    | "DUNE_NO_LINTER_SUPPRESSION"
    | "DUNE_BOUNDARY_VIOLATION"
    | "DUNE_NO_EXPLICIT_ANY"
    | "DUNE_NO_CONSOLE_IN_DOMAIN"
    | "DUNE_PHP_STRICT_TYPES_REQUIRED";
  readonly message: string;
}

export interface PolyglotSlopFinding {
  readonly file: string;
  readonly line: number;
  readonly language: SupportedLanguage;
  readonly kind:
    | "EMPTY_CATCH_BLOCK"
    | "DEBUG_LEFTOVER"
    | "SWALLOWED_ERROR_RESULT";
  readonly description: string;
}

export interface BoundaryRule {
  readonly pathPrefix: string;
  readonly forbiddenImports: readonly string[];
}

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "vendor",
  ".git",
  ".venv",
  "venv",
  "__pycache__",
  ".control-glass"
]);

export function detectLanguageFromFile(filePath: string): SupportedLanguage | null {
  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) return "typescript";
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".go")) return "go";
  if (filePath.endsWith(".php")) return "php";
  return null;
}

export function detectProjectLanguages(rootDir: string = process.cwd()): readonly SupportedLanguage[] {
  const detected = new Set<SupportedLanguage>();
  if (fs.existsSync(path.join(rootDir, "tsconfig.json")) || fs.existsSync(path.join(rootDir, "package.json"))) {
    detected.add("typescript");
  }
  if (
    fs.existsSync(path.join(rootDir, "pyproject.toml")) ||
    fs.existsSync(path.join(rootDir, "requirements.txt"))
  ) {
    detected.add("python");
  }
  if (fs.existsSync(path.join(rootDir, "go.mod"))) {
    detected.add("go");
  }
  if (fs.existsSync(path.join(rootDir, "composer.json"))) {
    detected.add("php");
  }

  for (const file of collectPolyglotSourceFiles(rootDir)) {
    const lang = detectLanguageFromFile(file);
    if (lang) detected.add(lang);
  }

  return Array.from(detected);
}

export function collectPolyglotSourceFiles(
  rootDir: string,
  subDirs: readonly string[] = ["src", "app", "pkg", "internal", "cmd"]
): string[] {
  const results: string[] = [];

  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const lang = detectLanguageFromFile(entry.name);
        const isTestFile =
          entry.name.endsWith(".spec.ts") ||
          entry.name.endsWith(".test.ts") ||
          entry.name.endsWith("_test.py") ||
          entry.name.startsWith("test_") ||
          entry.name.endsWith("_test.go") ||
          entry.name.endsWith("Test.php");
        if (lang && !isTestFile) {
          results.push(full);
        }
      }
    }
  };

  for (const sub of subDirs) {
    walk(path.join(rootDir, sub));
  }

  return results;
}

function maskStringsPreserveLength(line: string): string {
  return line
    .replace(/"(?:\\.|[^"\\])*"/g, (m) => " ".repeat(m.length))
    .replace(/'(?:\\.|[^'\\])*'/g, (m) => " ".repeat(m.length))
    .replace(/`(?:\\.|[^`\\])*`/g, (m) => " ".repeat(m.length));
}

function isAllowedDirectiveComment(lang: SupportedLanguage, lineIdx: number, trimmedComment: string): boolean {
  if (lineIdx === 0 && trimmedComment.startsWith("#!")) {
    return true;
  }
  if (lang === "go" && (trimmedComment.startsWith("//go:build") || trimmedComment.startsWith("// +build"))) {
    return true;
  }
  return false;
}

export function lintNonTsSourceText(
  sourceText: string,
  relativePath: string,
  lang: Exclude<SupportedLanguage, "typescript">,
  boundaries: Record<string, BoundaryRule> = {}
): PolyglotViolation[] {
  const violations: PolyglotViolation[] = [];
  const lines = sourceText.split(/\r?\n/);

  if (lang === "php") {
    const hasStrictTypes = /declare\s*\(\s*strict_types\s*=\s*1\s*\)\s*;/.test(sourceText);
    if (!hasStrictTypes) {
      violations.push({
        file: relativePath,
        line: 1,
        language: "php",
        ruleId: "DUNE_PHP_STRICT_TYPES_REQUIRED",
        message: "PHP files in Dune codebase must declare 'declare(strict_types=1);' at the top."
      });
    }
  }

  let inMultiLineComment = false;

  lines.forEach((rawLine, idx) => {
    const lineNum = idx + 1;
    const trimmed = rawLine.trim();

    if (inMultiLineComment) {
      if (trimmed.includes("*/")) {
        inMultiLineComment = false;
      }
      return;
    }

    const codeOnly = maskStringsPreserveLength(rawLine);

    if ((lang === "go" || lang === "php") && codeOnly.includes("/*")) {
      const commentStart = rawLine.slice(codeOnly.indexOf("/*"));
      const isSuppression = /(@phpstan-ignore|@psalm-suppress|nolint)/.test(commentStart);
      violations.push({
        file: relativePath,
        line: lineNum,
        language: lang,
        ruleId: isSuppression ? "DUNE_NO_LINTER_SUPPRESSION" : "DUNE_NO_COMMENTS",
        message: isSuppression
          ? `Linter suppression directive is prohibited in ${lang.toUpperCase()} codebase.`
          : `Comments are strictly prohibited in Dune ${lang.toUpperCase()} codebase.`
      });
      if (!codeOnly.includes("*/")) {
        inMultiLineComment = true;
      }
    }

    if (lang === "python" && (trimmed.startsWith('"""') || trimmed.startsWith("'''"))) {
      violations.push({
        file: relativePath,
        line: lineNum,
        language: "python",
        ruleId: "DUNE_NO_COMMENTS",
        message: "Docstring/multi-line comments are prohibited in Dune Python codebase. Use expressive type annotations."
      });
    }

    if ((lang === "python" || lang === "php") && codeOnly.includes("#")) {
      const hashIdx = codeOnly.indexOf("#");
      const isPhpAttribute = lang === "php" && rawLine.slice(hashIdx).startsWith("#[");
      if (!isPhpAttribute) {
        const commentPart = rawLine.slice(hashIdx).trim();
        if (!isAllowedDirectiveComment(lang, idx, commentPart)) {
          const isSuppression = /(type:\s*ignore|noqa|pylint:\s*disable|@phpstan-ignore)/.test(
            commentPart
          );
          violations.push({
            file: relativePath,
            line: lineNum,
            language: lang,
            ruleId: isSuppression ? "DUNE_NO_LINTER_SUPPRESSION" : "DUNE_NO_COMMENTS",
            message: isSuppression
              ? `Suppression comment ('${commentPart}') is forbidden.`
              : `Comments ('#') are strictly prohibited in Dune ${lang.toUpperCase()} codebase.`
          });
        }
      }
    }

    if ((lang === "go" || lang === "php") && codeOnly.includes("//")) {
      const slashIdx = codeOnly.indexOf("//");
      const commentPart = rawLine.slice(slashIdx).trim();
      if (!isAllowedDirectiveComment(lang, idx, commentPart)) {
        const isSuppression = /(nolint|@phpstan-ignore|@psalm-suppress)/.test(commentPart);
        violations.push({
          file: relativePath,
          line: lineNum,
          language: lang,
          ruleId: isSuppression ? "DUNE_NO_LINTER_SUPPRESSION" : "DUNE_NO_COMMENTS",
          message: isSuppression
            ? `Suppression comment ('${commentPart}') is forbidden.`
            : `Comments ('//') are strictly prohibited in Dune ${lang.toUpperCase()} codebase.`
        });
      }
    }

    if (lang === "python") {
      if (/\bAny\b/.test(codeOnly)) {
        violations.push({
          file: relativePath,
          line: lineNum,
          language: "python",
          ruleId: "DUNE_NO_EXPLICIT_ANY",
          message: "Usage of 'Any' in Python breaks Level 1 Contract guarantees. Use typing.NewType or frozen dataclasses."
        });
      }
      if (/\bprint\s*\(/.test(codeOnly)) {
        violations.push({
          file: relativePath,
          line: lineNum,
          language: "python",
          ruleId: "DUNE_NO_CONSOLE_IN_DOMAIN",
          message: "Direct 'print()' output is forbidden in Python domain code. Return Result values."
        });
      }
    }

    if (lang === "go") {
      if (/\binterface\s*\{\s*\}|\bany\b/.test(codeOnly)) {
        violations.push({
          file: relativePath,
          line: lineNum,
          language: "go",
          ruleId: "DUNE_NO_EXPLICIT_ANY",
          message: "Usage of 'interface{}' or 'any' in Go breaks Level 1 Contract guarantees. Use distinct types or generics."
        });
      }
      if (/\bfmt\.Print(ln|f)?\s*\(/.test(codeOnly)) {
        violations.push({
          file: relativePath,
          line: lineNum,
          language: "go",
          ruleId: "DUNE_NO_CONSOLE_IN_DOMAIN",
          message: "Direct 'fmt.Print*' output is forbidden in Go domain code. Return explicit (T, error)."
        });
      }
    }

    if (lang === "php") {
      if (/:\s*mixed\b|\bmixed\s+\$/.test(codeOnly)) {
        violations.push({
          file: relativePath,
          line: lineNum,
          language: "php",
          ruleId: "DUNE_NO_EXPLICIT_ANY",
          message: "Usage of 'mixed' type in PHP breaks Level 1 Contract guarantees. Use strict readonly Value Objects."
        });
      }
      if (/\b(var_dump|print_r|dd|dump)\s*\(|\becho\s+/.test(codeOnly)) {
        violations.push({
          file: relativePath,
          line: lineNum,
          language: "php",
          ruleId: "DUNE_NO_CONSOLE_IN_DOMAIN",
          message: "Direct debug/output ('var_dump', 'dd', 'print_r', 'echo') is forbidden in PHP domain code."
        });
      }
    }

    const importedSpecs = extractImportsFromLine(rawLine, lang);
    for (const spec of importedSpecs) {
      for (const boundary of Object.values(boundaries)) {
        if (relativePath.startsWith(boundary.pathPrefix)) {
          for (const forbidden of boundary.forbiddenImports) {
            if (spec === forbidden || spec.includes(forbidden)) {
              violations.push({
                file: relativePath,
                line: lineNum,
                language: lang,
                ruleId: "DUNE_BOUNDARY_VIOLATION",
                message: `Boundary lock violated: '${relativePath}' cannot import '${spec}' (matches forbidden '${forbidden}').`
              });
            }
          }
        }
      }
    }
  });

  return violations;
}

export function extractImportsFromLine(
  rawLine: string,
  lang: Exclude<SupportedLanguage, "typescript">
): string[] {
  const trimmed = rawLine.trim();
  const specs: string[] = [];

  if (lang === "python") {
    const fromMatch = /^from\s+([a-zA-Z0-9_.]+)\s+import\b/.exec(trimmed);
    if (fromMatch?.[1]) specs.push(fromMatch[1]);
    const importMatch = /^import\s+([a-zA-Z0-9_.]+)/.exec(trimmed);
    if (importMatch?.[1]) specs.push(importMatch[1]);
  } else if (lang === "go") {
    const goMatch = /"([^"]+)"/.exec(trimmed);
    if (
      goMatch?.[1] &&
      (trimmed.startsWith("import ") || (!trimmed.includes("=") && !trimmed.includes("(")))
    ) {
      specs.push(goMatch[1]);
    }
  } else if (lang === "php") {
    const useMatch = /^use\s+([a-zA-Z0-9_\\]+)\s*;/.exec(trimmed);
    if (useMatch?.[1]) specs.push(useMatch[1]);
    const reqMatch = /\b(?:require|require_once|include|include_once)\s*\(?\s*['"]([^'"]+)['"]/.exec(
      trimmed
    );
    if (reqMatch?.[1]) specs.push(reqMatch[1]);
  }

  return specs;
}

export function scanNonTsSlop(
  sourceText: string,
  relativePath: string,
  lang: Exclude<SupportedLanguage, "typescript">
): PolyglotSlopFinding[] {
  const findings: PolyglotSlopFinding[] = [];
  const lines = sourceText.split(/\r?\n/);

  lines.forEach((rawLine, idx) => {
    const lineNum = idx + 1;
    const trimmed = rawLine.trim();
    const nextTrimmed = lines[idx + 1]?.trim() ?? "";

    if (lang === "python") {
      if (/^except(\s+[^:]+)?:\s*pass\b/.test(trimmed) || (/^except(\s+[^:]+)?:$/.test(trimmed) && nextTrimmed === "pass")) {
        findings.push({
          file: relativePath,
          line: lineNum,
          language: "python",
          kind: "EMPTY_CATCH_BLOCK",
          description: "Swallowing exceptions via 'except: pass' is AI slop. Return an explicit Err Result."
        });
      }
      if (/\b(breakpoint|pdb\.set_trace)\s*\(/.test(trimmed)) {
        findings.push({
          file: relativePath,
          line: lineNum,
          language: "python",
          kind: "DEBUG_LEFTOVER",
          description: "Leftover Python debugger statement ('breakpoint()' or 'pdb.set_trace()') detected."
        });
      }
    }

    if (lang === "go") {
      if (/^\s*_\s*=\s*err\b/.test(rawLine) || /,\s*_\s*:?=\s*[a-zA-Z0-9_.]+\(/.test(rawLine)) {
        findings.push({
          file: relativePath,
          line: lineNum,
          language: "go",
          kind: "SWALLOWED_ERROR_RESULT",
          description: "Blank-identifier error suppression ('_ = err') is prohibited in Go domain logic."
        });
      }
    }

    if (lang === "php") {
      if (/catch\s*\([^)]+\)\s*\{\s*\}/.test(trimmed)) {
        findings.push({
          file: relativePath,
          line: lineNum,
          language: "php",
          kind: "EMPTY_CATCH_BLOCK",
          description: "Empty 'catch (...) {}' block swallows exceptions in PHP."
        });
      }
      if (/\bxdebug_break\s*\(/.test(trimmed)) {
        findings.push({
          file: relativePath,
          line: lineNum,
          language: "php",
          kind: "DEBUG_LEFTOVER",
          description: "Leftover 'xdebug_break()' debugger call detected."
        });
      }
    }
  });

  return findings;
}

export function stripNonTsComments(
  sourceText: string,
  lang: Exclude<SupportedLanguage, "typescript">
): { readonly cleanedText: string; readonly removedCount: number } {
  const lines = sourceText.split(/\r?\n/);
  let removedCount = 0;
  const outLines: string[] = [];

  lines.forEach((rawLine, idx) => {
    const codeOnly = maskStringsPreserveLength(rawLine);

    if (lang === "python" || lang === "php") {
      const hashIdx = codeOnly.indexOf("#");
      const isPhpAttr = lang === "php" && hashIdx !== -1 && rawLine.slice(hashIdx).startsWith("#[");
      if (hashIdx !== -1 && !isPhpAttr) {
        const commentPart = rawLine.slice(hashIdx).trim();
        if (!isAllowedDirectiveComment(lang, idx, commentPart)) {
          removedCount++;
          const before = rawLine.slice(0, hashIdx).trimEnd();
          if (before.length > 0) {
            outLines.push(before);
          }
          return;
        }
      }
    }

    if (lang === "go" || lang === "php") {
      const slashIdx = codeOnly.indexOf("//");
      if (slashIdx !== -1) {
        const commentPart = rawLine.slice(slashIdx).trim();
        if (!isAllowedDirectiveComment(lang, idx, commentPart)) {
          removedCount++;
          const before = rawLine.slice(0, slashIdx).trimEnd();
          if (before.length > 0) {
            outLines.push(before);
          }
          return;
        }
      }
    }

    outLines.push(rawLine);
  });

  return {
    cleanedText: outLines.join("\n"),
    removedCount
  };
}

export const POLYGLOT_CONTRACT_TEMPLATES: Record<Exclude<SupportedLanguage, "typescript">, {
  readonly targetPath: string;
  readonly content: string;
}> = {
  python: {
    targetPath: "src/core/contracts.py",
    content: `from dataclasses import dataclass
from typing import Generic, NewType, TypeVar, Union

T = TypeVar("T")
E = TypeVar("E")

NewtonSeconds = NewType("NewtonSeconds", float)
PoundForceSeconds = NewType("PoundForceSeconds", float)
Satang = NewType("Satang", int)

@dataclass(frozen=True)
class Ok(Generic[T]):
    value: T
    ok: bool = True

@dataclass(frozen=True)
class Err(Generic[E]):
    error: E
    ok: bool = False

Result = Union[Ok[T], Err[E]]

def create_newton_seconds(raw: float) -> Result[NewtonSeconds, str]:
    if raw < 0.0:
        return Err("INVALID_NEWTON_SECONDS")
    return Ok(NewtonSeconds(raw))

def create_satang(raw: int) -> Result[Satang, str]:
    if raw < 0:
        return Err("INVALID_SATANG_INTEGER")
    return Ok(Satang(raw))
`
  },
  go: {
    targetPath: "src/core/contracts.go",
    content: `package core

import "errors"

type NewtonSeconds float64
type PoundForceSeconds float64
type Satang int64

var ErrInvalidNewtonSeconds = errors.New("INVALID_NEWTON_SECONDS")
var ErrInvalidSatangInteger = errors.New("INVALID_SATANG_INTEGER")

func CreateNewtonSeconds(raw float64) (NewtonSeconds, error) {
	if raw < 0 {
		return 0, ErrInvalidNewtonSeconds
	}
	return NewtonSeconds(raw), nil
}

func CreateSatang(raw int64) (Satang, error) {
	if raw < 0 {
		return 0, ErrInvalidSatangInteger
	}
	return Satang(raw), nil
}
`
  },
  php: {
    targetPath: "src/Core/Contracts.php",
    content: `<?php
declare(strict_types=1);

namespace ControlGlass\\Core;

use InvalidArgumentException;

final readonly class NewtonSeconds
{
    private function __construct(public float $value) {}

    public static function fromFloat(float $raw): self
    {
        if ($raw < 0.0) {
            throw new InvalidArgumentException('INVALID_NEWTON_SECONDS');
        }
        return new self($raw);
    }
}

final readonly class Satang
{
    private function __construct(public int $value) {}

    public static function fromInt(int $raw): self
    {
        if ($raw < 0) {
            throw new InvalidArgumentException('INVALID_SATANG_INTEGER');
        }
        return new self($raw);
    }
}
`
  }
};
