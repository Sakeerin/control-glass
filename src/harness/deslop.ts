import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface SlopIssue {
  readonly file: string;
  readonly line: number;
  readonly kind:
    | "COMMENT_SLOP"
    | "EMPTY_CATCH_BLOCK"
    | "TRIVIAL_PASS_THROUGH_WRAPPER"
    | "DEBUG_LEFTOVER";
  readonly description: string;
}

export interface DeslopReport {
  readonly passed: boolean;
  readonly scannedFiles: number;
  readonly cleanedCommentCount: number;
  readonly issues: readonly SlopIssue[];
}

function collectTsFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
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

export function runDeslopEngine(
  rootDir: string = process.cwd(),
  autoFixComments: boolean = false
): DeslopReport {
  const srcFiles = collectTsFiles(path.join(rootDir, "src"));
  const issues: SlopIssue[] = [];
  let cleanedCommentCount = 0;

  for (const absPath of srcFiles) {
    const relPath = path.relative(rootDir, absPath).split(path.sep).join("/");
    const isHarness = relPath.startsWith("src/harness/");
    let content = fs.readFileSync(absPath, "utf8");

    if (autoFixComments) {
      const stripped = stripCommentsFromText(content);
      if (stripped.removedCount > 0) {
        fs.writeFileSync(absPath, stripped.cleanedText, "utf8");
        content = stripped.cleanedText;
        cleanedCommentCount += stripped.removedCount;
      }
    }

    const sf = ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

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

      ts.forEachChild(node, visit);
    };

    visit(sf);
  }

  return {
    passed: issues.length === 0,
    scannedFiles: srcFiles.length,
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
