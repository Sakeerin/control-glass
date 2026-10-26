import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  collectPolyglotSourceFiles,
  detectLanguageFromFile,
  scanNonTsSlop,
  stripNonTsComments
} from "./polyglot-engine.js";

export interface SlopIssue {
  readonly file: string;
  readonly line: number;
  readonly kind:
    | "COMMENT_SLOP"
    | "EMPTY_CATCH_BLOCK"
    | "TRIVIAL_PASS_THROUGH_WRAPPER"
    | "DEBUG_LEFTOVER"
    | "SWALLOWED_ERROR_RESULT";
  readonly description: string;
}

export interface DeslopReport {
  readonly passed: boolean;
  readonly scannedFiles: number;
  readonly cleanedCommentCount: number;
  readonly issues: readonly SlopIssue[];
}

function stripCommentsFromText(sourceText: string): {
  readonly cleanedText: string;
  readonly removedCount: number;
} {
  const hasShebang = sourceText.startsWith("#!");
  const firstNewlineIdx = sourceText.indexOf("\n");
  const shebangLine =
    hasShebang && firstNewlineIdx !== -1 ? sourceText.slice(0, firstNewlineIdx + 1) : "";
  const bodyText =
    hasShebang && firstNewlineIdx !== -1 ? sourceText.slice(firstNewlineIdx + 1) : sourceText;

  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    bodyText
  );

  const rangesToRemove: Array<{ readonly start: number; readonly end: number }> = [];
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      rangesToRemove.push({
        start: scanner.getTokenPos(),
        end: scanner.getTextPos()
      });
    }
    token = scanner.scan();
  }

  if (rangesToRemove.length === 0) {
    return { cleanedText: sourceText, removedCount: 0 };
  }

  let cursor = 0;
  let result = "";
  for (const range of rangesToRemove) {
    result += bodyText.slice(cursor, range.start);
    cursor = range.end;
  }
  result += bodyText.slice(cursor);

  const normalizedLines = result
    .split(/\r?\n/)
    .filter((line, idx, arr) => !(line.trim() === "" && arr[idx - 1]?.trim() === ""))
    .join("\n");

  return {
    cleanedText: shebangLine + normalizedLines,
    removedCount: rangesToRemove.length
  };
}

function isTrivialPassThroughFunction(node: ts.FunctionDeclaration): boolean {
  if (!node.body || node.body.statements.length !== 1 || node.parameters.length === 0) {
    return false;
  }
  const stmt = node.body.statements[0];
  if (!stmt || !ts.isReturnStatement(stmt) || !stmt.expression) {
    return false;
  }
  if (!ts.isCallExpression(stmt.expression)) {
    return false;
  }
  const callExpr = stmt.expression;
  if (callExpr.arguments.length !== node.parameters.length) {
    return false;
  }
  return node.parameters.every((param, idx) => {
    const arg = callExpr.arguments[idx];
    return (
      ts.isIdentifier(param.name) &&
      arg !== undefined &&
      ts.isIdentifier(arg) &&
      param.name.text === arg.text
    );
  });
}

export function runDeslopEngine(
  rootDir: string = process.cwd(),
  autoFixComments: boolean = false
): DeslopReport {
  const allFiles = collectPolyglotSourceFiles(rootDir);
  const issues: SlopIssue[] = [];
  let cleanedCommentCount = 0;

  for (const absPath of allFiles) {
    const relPath = path.relative(rootDir, absPath).split(path.sep).join("/");
    const isHarness = relPath.startsWith("src/harness/");
    const lang = detectLanguageFromFile(absPath);
    let content = fs.readFileSync(absPath, "utf8");

    if (lang === "typescript") {
      if (autoFixComments) {
        const stripped = stripCommentsFromText(content);
        if (stripped.removedCount > 0) {
          fs.writeFileSync(absPath, stripped.cleanedText, "utf8");
          content = stripped.cleanedText;
          cleanedCommentCount += stripped.removedCount;
        }
      }

      const sf = ts.createSourceFile(
        relPath,
        content,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      );

      const visit = (node: ts.Node): void => {
        if (ts.isCatchClause(node) && node.block.statements.length === 0 && !isHarness) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          issues.push({
            file: relPath,
            line,
            kind: "EMPTY_CATCH_BLOCK",
            description:
              "Swallowing exceptions via an empty catch block is AI slop. Return an explicit err(...) Result."
          });
        }

        if (ts.isDebuggerStatement(node)) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          issues.push({
            file: relPath,
            line,
            kind: "DEBUG_LEFTOVER",
            description: "Leftover debugger statement detected."
          });
        }

        if (ts.isFunctionDeclaration(node) && isTrivialPassThroughFunction(node)) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const fnName = node.name?.text ?? "anonymous";
          issues.push({
            file: relPath,
            line,
            kind: "TRIVIAL_PASS_THROUGH_WRAPPER",
            description: `Function '${fnName}' is a redundant 1-to-1 pass-through wrapper. Call the underlying function directly.`
          });
        }

        ts.forEachChild(node, visit);
      };

      visit(sf);
    } else if (lang === "python" || lang === "go" || lang === "php") {
      if (autoFixComments) {
        const stripped = stripNonTsComments(content, lang);
        if (stripped.removedCount > 0) {
          fs.writeFileSync(absPath, stripped.cleanedText, "utf8");
          content = stripped.cleanedText;
          cleanedCommentCount += stripped.removedCount;
        }
      }
      const nonTsFindings = scanNonTsSlop(content, relPath, lang);
      for (const f of nonTsFindings) {
        issues.push({
          file: f.file,
          line: f.line,
          kind: f.kind,
          description: f.description
        });
      }
    }
  }

  return {
    passed: issues.length === 0,
    scannedFiles: allFiles.length,
    cleanedCommentCount,
    issues
  };
}

if (process.argv[1]?.endsWith("deslop.ts")) {
  const fix = process.argv.includes("--fix");
  const report = runDeslopEngine(process.cwd(), fix);
  if (report.cleanedCommentCount > 0) {
    console.log(`🧹 Auto-cleaned ${report.cleanedCommentCount} comment block(s).`);
  }
  if (!report.passed) {
    console.error(`❌ Deslop Engine found ${report.issues.length} slop pattern(s):`);
    for (const issue of report.issues) {
      console.error(`  [${issue.kind}] ${issue.file}:${issue.line} — ${issue.description}`);
    }
    process.exit(1);
  }
  console.log(`✅ Deslop Engine passed (${report.scannedFiles} files verified clean of slop).`);
}
