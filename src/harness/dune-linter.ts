import { isDirectExecution } from "./runtime.js";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { typeScriptComments } from "./source-analysis.js";
import { loadCompilerOptions, resolveProjectImport } from "./module-resolver.js";
import { loadFeatureMap } from "./project-config.js";
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
    | "DUNE_PHP_STRICT_TYPES_REQUIRED"
    | "DUNE_INVALID_CONFIGURATION"
    | "DUNE_INVALID_SYNTAX";
  readonly message: string;
}

interface BoundaryConfig {
  readonly pathPrefix: string;
  readonly forbiddenImports: readonly string[];
  readonly description?: string | undefined;
}

const DEFAULT_BOUNDARIES: Record<string, BoundaryConfig> = {
  ui: {
    pathPrefix: "src/ui/",
    forbiddenImports: ["src/infra/", "node:fs", "node:child_process", "node:crypto", "fs", "child_process", "crypto"],
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
  return loadFeatureMap(rootDir).architecturalBoundaries ?? DEFAULT_BOUNDARIES;
}

function getLineNumber(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function checkNoComments(sourceFile: ts.SourceFile, relativePath: string): LintViolation[] {
  return typeScriptComments(sourceFile).map(range => {
    const suppression = /@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable/.test(sourceFile.text.slice(range.start, range.end));
    return { file: relativePath, line: getLineNumber(sourceFile, range.start), ruleId: suppression ? "DUNE_NO_LINTER_SUPPRESSION" : "DUNE_NO_COMMENTS", message: suppression ? "Compiler and linter suppression is prohibited." : "Use expressive names instead of source comments." };
  });
}

const REACT_COMPONENT_FORBIDDEN_IMPORTS: readonly string[] = [
  "src/infra/",
  "node:fs",
  "node:child_process",
  "node:crypto",
  "crypto",
  "fs",
  "child_process"
];

function checkModuleSpecifierAgainstBoundaries(
  sourceFile: ts.SourceFile,
  nodePos: number,
  relativePath: string,
  rawSpec: string,
  boundaries: Record<string, BoundaryConfig>,
  violations: LintViolation[],
  resolveImport: (importer: string, specifier: string) => string
): void {
  const resolvedTarget = resolveImport(relativePath, rawSpec);
  const lineNum = getLineNumber(sourceFile, nodePos);
  let reported = false;

  for (const boundary of Object.values(boundaries)) {
    if (relativePath.startsWith(boundary.pathPrefix)) {
      for (const forbidden of boundary.forbiddenImports) {
        if (rawSpec === forbidden || resolvedTarget.startsWith(forbidden)) {
          violations.push({
            file: relativePath,
            line: lineNum,
            ruleId: "DUNE_BOUNDARY_VIOLATION",
            message: `Boundary lock violated: '${relativePath}' (${boundary.pathPrefix}) cannot import '${rawSpec}' (matches forbidden '${forbidden}').`
          });
          reported = true;
        }
      }
    }
  }

  const isReactUiFile =
    relativePath.startsWith("src/ui/") ||
    relativePath.endsWith(".tsx") ||
    relativePath.startsWith("src/components/") ||
    relativePath.startsWith("components/");

  if (!reported && isReactUiFile) {
    for (const forbidden of REACT_COMPONENT_FORBIDDEN_IMPORTS) {
      if (rawSpec === forbidden || resolvedTarget.startsWith(forbidden)) {
        violations.push({
          file: relativePath,
          line: lineNum,
          ruleId: "DUNE_BOUNDARY_VIOLATION",
          message: `React/UI boundary lock violated: '${relativePath}' cannot import Node I/O or infrastructure module '${rawSpec}'.`
        });
      }
    }
  }
}

function checkAstRules(
  sourceFile: ts.SourceFile,
  relativePath: string,
  boundaries: Record<string, BoundaryConfig>,
  resolveImport: (importer: string, specifier: string) => string
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

    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
      checkModuleSpecifierAgainstBoundaries(sourceFile, node.getStart(sourceFile), relativePath, node.moduleReference.expression.text, boundaries, violations, resolveImport);
    }

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      checkModuleSpecifierAgainstBoundaries(
        sourceFile,
        node.getStart(sourceFile),
        relativePath,
        node.moduleSpecifier.text,
        boundaries,
        violations,
        resolveImport
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
        violations,
        resolveImport
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
          violations,
          resolveImport
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
  let boundaries: Record<string, BoundaryConfig>;
  let compilerOptions: ts.CompilerOptions;
  try {
    boundaries = loadBoundariesSafe(rootDir);
    compilerOptions = loadCompilerOptions(rootDir);
  } catch {
    return { passed: false, checkedFiles: 0, violations: [{ file: "feature-map.json / tsconfig.json", line: 1, ruleId: "DUNE_INVALID_CONFIGURATION", message: "Invalid project configuration; boundary enforcement cannot continue." }] };
  }
  const resolveImport = (importer: string, specifier: string): string => resolveProjectImport(rootDir, importer, specifier, compilerOptions);
  const allFiles = collectPolyglotSourceFiles(rootDir);
  const violations: LintViolation[] = [];

  for (const filePath of allFiles) {
    const relativePath = path.relative(rootDir, filePath).split(path.sep).join("/");
    const content = fs.readFileSync(filePath, "utf8");
    const lang = detectLanguageFromFile(filePath);

    if (lang === "typescript") {
      const scriptKind = relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      const sourceFile = ts.createSourceFile(
        relativePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        scriptKind
      );

      const syntax = ts.transpileModule(content, { fileName: relativePath, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve } }).diagnostics ?? [];
      for (const diagnostic of syntax.filter(item => item.category === ts.DiagnosticCategory.Error)) {
        violations.push({ file: relativePath, line: getLineNumber(sourceFile, diagnostic.start ?? 0), ruleId: "DUNE_INVALID_SYNTAX", message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " ") });
      }
      violations.push(...checkNoComments(sourceFile, relativePath));
      violations.push(...checkAstRules(sourceFile, relativePath, boundaries, resolveImport));
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

if (isDirectExecution(import.meta.url)) {
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
