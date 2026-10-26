import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  collectPolyglotSourceFiles,
  detectLanguageFromFile,
  lintNonTsSourceText
} from "./polyglot-engine.js";

export interface LintViolation {
  readonly file: string;
  readonly line: number;
  readonly ruleId:
    | "DUNE_NO_COMMENTS"
    | "DUNE_NO_LINTER_SUPPRESSION"
    | "DUNE_BOUNDARY_VIOLATION"
    | "DUNE_NO_EXPLICIT_ANY"
    | "DUNE_NO_TYPE_ASSERTION_ESCAPE"
    | "DUNE_NO_CONSOLE_IN_DOMAIN"
    | "DUNE_PHP_STRICT_TYPES_REQUIRED";
  readonly message: string;
}

interface BoundaryConfig {
  readonly pathPrefix: string;
  readonly forbiddenImports: readonly string[];
  readonly description: string;
}

interface FeatureMapSchema {
  readonly architecturalBoundaries?: Record<string, BoundaryConfig>;
}

const DEFAULT_BOUNDARIES: Record<string, BoundaryConfig> = {
  ui: {
    pathPrefix: "src/ui/",
    forbiddenImports: ["src/infra/", "node:fs", "node:child_process", "fs", "child_process"],
    description: "Renderer / Presentation layer"
  },
  features: {
    pathPrefix: "src/features/",
    forbiddenImports: ["node:child_process", "child_process"],
    description: "Single Paved Path domain features"
  },
  core: {
    pathPrefix: "src/core/",
    forbiddenImports: ["src/ui/", "src/features/"],
    description: "Foundational Branded Types and contracts"
  }
};

function loadBoundariesSafe(rootDir: string): Record<string, BoundaryConfig> {
  const featureMapPath = path.join(rootDir, "feature-map.json");
  if (!fs.existsSync(featureMapPath)) {
    return DEFAULT_BOUNDARIES;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(featureMapPath, "utf8")) as FeatureMapSchema;
    return parsed.architecturalBoundaries ?? DEFAULT_BOUNDARIES;
  } catch {
    return DEFAULT_BOUNDARIES;
  }
}

function getLineNumber(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function checkNoComments(sourceFile: ts.SourceFile, relativePath: string): LintViolation[] {
  const violations: LintViolation[] = [];
  const rawText = sourceFile.getFullText();
  const text = rawText.startsWith("#!") ? rawText.replace(/^#!.*(?:\r?\n|$)/, "\n") : rawText;
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text
  );

  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const startPos = scanner.getTokenPos();
      const commentText = scanner.getTokenText();
      const isSuppression = /(@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable)/.test(
        commentText
      );
      violations.push({
        file: relativePath,
        line: getLineNumber(sourceFile, startPos),
        ruleId: isSuppression ? "DUNE_NO_LINTER_SUPPRESSION" : "DUNE_NO_COMMENTS",
        message: isSuppression
          ? "Compiler or linter suppression directives (@ts-ignore, @ts-expect-error, eslint-disable) are strictly forbidden."
          : "Comments are strictly prohibited in Dune codebase. Do not leave band-aid explanations; use expressive types and function names."
      });
    }
    token = scanner.scan();
  }
  return violations;
}

function resolveRelativeImportTarget(importerRelativePath: string, moduleSpecifier: string): string {
  if (!moduleSpecifier.startsWith(".")) {
    return moduleSpecifier;
  }
  const importerDir = path.posix.dirname(importerRelativePath);
  return path.posix.normalize(path.posix.join(importerDir, moduleSpecifier));
}

function checkModuleSpecifierAgainstBoundaries(
  sourceFile: ts.SourceFile,
  nodePos: number,
  relativePath: string,
  rawSpec: string,
  boundaries: Record<string, BoundaryConfig>,
  violations: LintViolation[]
): void {
  const resolvedTarget = resolveRelativeImportTarget(relativePath, rawSpec);
  for (const boundary of Object.values(boundaries)) {
    if (relativePath.startsWith(boundary.pathPrefix)) {
      for (const forbidden of boundary.forbiddenImports) {
        if (rawSpec === forbidden || resolvedTarget.startsWith(forbidden)) {
          violations.push({
            file: relativePath,
            line: getLineNumber(sourceFile, nodePos),
            ruleId: "DUNE_BOUNDARY_VIOLATION",
            message: `Boundary lock violated: '${relativePath}' (${boundary.pathPrefix}) cannot import '${rawSpec}' (matches forbidden '${forbidden}').`
          });
        }
      }
    }
  }
}

function checkAstRules(
  sourceFile: ts.SourceFile,
  relativePath: string,
  boundaries: Record<string, BoundaryConfig>
): LintViolation[] {
  const violations: LintViolation[] = [];
  const isHarnessFile = relativePath.startsWith("src/harness/");

  function visit(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      violations.push({
        file: relativePath,
        line: getLineNumber(sourceFile, node.getStart(sourceFile)),
        ruleId: "DUNE_NO_EXPLICIT_ANY",
        message: "Usage of 'any' breaks Level 1 Contract guarantees. Use Branded Types or unknown with Zod."
      });
    }

    if (ts.isAsExpression(node)) {
      const typeText = node.type.getText(sourceFile);
      if (typeText === "any" || typeText === "unknown") {
        violations.push({
          file: relativePath,
          line: getLineNumber(sourceFile, node.getStart(sourceFile)),
          ruleId: "DUNE_NO_TYPE_ASSERTION_ESCAPE",
          message: `Type assertion 'as ${typeText}' is prohibited outside validated brand constructors.`
        });
      }
    }

    if (
      !isHarnessFile &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(sourceFile) === "console"
    ) {
      violations.push({
        file: relativePath,
        line: getLineNumber(sourceFile, node.getStart(sourceFile)),
        ruleId: "DUNE_NO_CONSOLE_IN_DOMAIN",
        message: "Direct console output is forbidden in domain/UI layers. Return structured Result values."
      });
    }

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      checkModuleSpecifierAgainstBoundaries(
        sourceFile,
        node.getStart(sourceFile),
        relativePath,
        node.moduleSpecifier.text,
        boundaries,
        violations
      );
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkModuleSpecifierAgainstBoundaries(
        sourceFile,
        node.getStart(sourceFile),
        relativePath,
        node.moduleSpecifier.text,
        boundaries,
        violations
      );
    }

    if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const firstArg = node.arguments[0];
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequireCall =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      if ((isDynamicImport || isRequireCall) && firstArg && ts.isStringLiteral(firstArg)) {
        checkModuleSpecifierAgainstBoundaries(
          sourceFile,
          node.getStart(sourceFile),
          relativePath,
          firstArg.text,
          boundaries,
          violations
        );
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

export function runDuneLinter(rootDir: string = process.cwd()): {
  readonly passed: boolean;
  readonly checkedFiles: number;
  readonly violations: readonly LintViolation[];
} {
  const boundaries = loadBoundariesSafe(rootDir);
  const allFiles = collectPolyglotSourceFiles(rootDir);
  const violations: LintViolation[] = [];

  for (const filePath of allFiles) {
    const relativePath = path.relative(rootDir, filePath).split(path.sep).join("/");
    const content = fs.readFileSync(filePath, "utf8");
    const lang = detectLanguageFromFile(filePath);

    if (lang === "typescript") {
      const sourceFile = ts.createSourceFile(
        relativePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      );

      violations.push(...checkNoComments(sourceFile, relativePath));
      violations.push(...checkAstRules(sourceFile, relativePath, boundaries));
    } else if (lang === "python" || lang === "go" || lang === "php") {
      violations.push(...lintNonTsSourceText(content, relativePath, lang, boundaries));
    }
  }

  return {
    passed: violations.length === 0,
    checkedFiles: allFiles.length,
    violations
  };
}

if (
  import.meta.url === `file://${path.resolve(process.argv[1] ?? "").replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("dune-linter.ts")
) {
  const result = runDuneLinter();
  if (!result.passed) {
    console.error(`❌ Dune AST Linter failed with ${result.violations.length} violation(s):`);
    for (const v of result.violations) {
      console.error(`  [${v.ruleId}] ${v.file}:${v.line} — ${v.message}`);
    }
    process.exit(1);
  }
  console.log(`✅ Dune AST Linter passed (${result.checkedFiles} files verified, 0 violations).`);
}
