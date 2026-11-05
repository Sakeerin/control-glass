import fs from "node:fs";
import path from "node:path";
import { collectProjectFiles, isSourceFile, isTestFile } from "./file-inventory.js";
import { tokenizeNonTypeScript, replaceSourceRanges } from "./source-analysis.js";

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

export function collectPolyglotSourceFiles(rootDir: string, subDirs?: readonly string[]): string[] {
  const roots = subDirs ? subDirs.map(directory => path.join(rootDir, directory)) : [rootDir];
  return [...new Set(roots.flatMap(collectProjectFiles))].filter(file => isSourceFile(file) && !isTestFile(path.basename(file)));
}

export function lintNonTsSourceText(
  sourceText: string,
  relativePath: string,
  lang: Exclude<SupportedLanguage, "typescript">,
  boundaries: Record<string, BoundaryRule> = {}
): PolyglotViolation[] {
  const violations: PolyglotViolation[] = [];
  const tokenized = tokenizeNonTypeScript(sourceText, lang);
  const rawLines = sourceText.split(/\r?\n/);
  const add = (ruleId: PolyglotViolation["ruleId"], line: number, message: string): void => {
    violations.push({ file: relativePath, line, language: lang, ruleId, message });
  };
  if (lang === "php" && !/declare\s*\(\s*strict_types\s*=\s*1\s*\)\s*;/.test(tokenized.code)) {
    add("DUNE_PHP_STRICT_TYPES_REQUIRED", 1, "PHP requires declare(strict_types=1).");
  }
  for (const range of tokenized.comments) {
    const text = sourceText.slice(range.start, range.end);
    const suppression = /type:\s*ignore|noqa|pylint:\s*disable|nolint|@phpstan-ignore|@psalm-suppress/.test(text);
    add(suppression ? "DUNE_NO_LINTER_SUPPRESSION" : "DUNE_NO_COMMENTS", sourceText.slice(0, range.start).split("\n").length,
      suppression ? "Linter suppression is prohibited." : "Use expressive names instead of source comments.");
  }
  let inGoImports = false;
  tokenized.code.split(/\r?\n/).forEach((code, index) => {
    if (lang === "go" && /^\s*import\s*\(/.test(code)) inGoImports = true;
    if (lang === "go" && /^\s*\)/.test(code)) inGoImports = false;
    const line = index + 1;
    const weak = lang === "python" ? /\bAny\b/.test(code) : lang === "go" ? /\binterface\s*\{\s*\}|(?:[)\]]|\b\w+)\s+any\b|\]any\b/.test(code) : /:\s*mixed\b|\bmixed\s+\$/.test(code);
    if (weak) add("DUNE_NO_EXPLICIT_ANY", line, "Weak types break validated domain contracts.");
    const output = lang === "python" ? /\bprint\s*\(/.test(code) : lang === "go" ? /\bfmt\.Print(?:ln|f)?\s*\(/.test(code) : /\b(?:var_dump|print_r|dd|dump)\s*\(|\becho\s+/.test(code);
    if (output) add("DUNE_NO_CONSOLE_IN_DOMAIN", line, "Return structured results instead of direct output.");
    const rawLine = rawLines[index] ?? "";
    if (code.trim().length > 0 || inGoImports) {
      for (const imported of extractImportsFromLine(rawLine, lang)) {
        for (const boundary of Object.values(boundaries)) {
          if (relativePath.startsWith(boundary.pathPrefix) && boundary.forbiddenImports.some(forbidden => imported === forbidden || imported.includes(forbidden))) {
            add("DUNE_BOUNDARY_VIOLATION", line, "Import crosses a forbidden architectural boundary.");
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
    const goMatch = /["`]([^"`]+)["`]/.exec(trimmed);
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

export function scanNonTsSlop(sourceText: string, relativePath: string, lang: Exclude<SupportedLanguage, "typescript">): PolyglotSlopFinding[] {
  const findings: PolyglotSlopFinding[] = [];
  const code = tokenizeNonTypeScript(sourceText, lang).code;
  const patterns: readonly { readonly kind: PolyglotSlopFinding["kind"]; readonly pattern: RegExp }[] = lang === "python"
    ? [{ kind: "EMPTY_CATCH_BLOCK", pattern: /\bexcept(?:\s+[^:\n]+)?:\s*pass\b/g }, { kind: "DEBUG_LEFTOVER", pattern: /\b(?:breakpoint|pdb\.set_trace)\s*\(/g }]
    : lang === "go"
      ? [{ kind: "SWALLOWED_ERROR_RESULT", pattern: /(?:^|\n)\s*_\s*=\s*err\b|,\s*_\s*:?=\s*[a-zA-Z0-9_.]+\(/g }]
      : [{ kind: "EMPTY_CATCH_BLOCK", pattern: /\bcatch\s*\([^)]+\)\s*\{\s*\}/g }, { kind: "DEBUG_LEFTOVER", pattern: /\bxdebug_break\s*\(/g }];
  for (const rule of patterns) {
    for (const match of code.matchAll(rule.pattern)) {
      findings.push({ file: relativePath, line: code.slice(0, match.index).split("\n").length, language: lang, kind: rule.kind, description: "Handle errors explicitly and remove debugger calls." });
    }
  }
  return findings;
}

export function stripNonTsComments(sourceText: string, lang: Exclude<SupportedLanguage, "typescript">): { readonly cleanedText: string; readonly removedCount: number } {
  const ranges = tokenizeNonTypeScript(sourceText, lang).comments;
  return { cleanedText: replaceSourceRanges(sourceText, ranges), removedCount: ranges.length };
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
