import type ts from "typescript";
import { createRequire } from "node:module";
import { parsePhpTokens } from "./native-source-parser.js";

const requireCompiler = createRequire(import.meta.url);

export function loadTypeScript(): typeof import("typescript") {
  const compiler: typeof import("typescript") = requireCompiler("typescript");
  return compiler;
}

export interface SourceRange {
  readonly start: number;
  readonly end: number;
  readonly replacement?: string;
}

export function typeScriptComments(sourceFile: ts.SourceFile): readonly SourceRange[] {
  const ts = loadTypeScript();
  const ranges = new Map<number, SourceRange>();
  function visit(node: ts.Node): void {
    const start = node.getStart(sourceFile, false);
    for (const range of [
      ...(ts.getLeadingCommentRanges(sourceFile.text, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(sourceFile.text, node.pos) ?? [])
    ]) {
      if (range.end <= start) ranges.set(range.pos, { start: range.pos, end: range.end });
    }
    for (const child of node.getChildren(sourceFile)) visit(child);
  }
  visit(sourceFile);
  return [...ranges.values()].sort((a, b) => a.start - b.start);
}

export function replaceSourceRanges(text: string, ranges: readonly SourceRange[]): string {
  let result = "";
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    result += text.slice(cursor, range.start);
    const whitespace = text.slice(range.start, range.end).replace(/[^\r\n]/g, " ");
    result += range.replacement === undefined ? whitespace : range.replacement + whitespace.slice(range.replacement.length);
    cursor = range.end;
  }
  return result + text.slice(cursor);
}

export function tokenizeNonTypeScript(text: string, language: "python" | "go" | "php"): {
  readonly comments: readonly SourceRange[];
  readonly code: string;
} {
  if (language === "php") {
    const comments: SourceRange[] = [];
    const hidden: SourceRange[] = [];
    let stringStart: number | null = null;
    for (const token of parsePhpTokens(text)) {
      if (token.kind === "T_COMMENT" || token.kind === "T_DOC_COMMENT") comments.push(token);
      if (token.kind === "T_START_HEREDOC" || ((token.kind === '"' || token.kind === "`") && stringStart === null)) stringStart = token.start;
      else if (token.kind === "T_END_HEREDOC" || ((token.kind === '"' || token.kind === "`") && stringStart !== null)) {
        if (stringStart !== null) hidden.push({ start: stringStart, end: token.end });
        stringStart = null;
      }
      if (token.kind === "T_CONSTANT_ENCAPSED_STRING" || token.kind === "T_INLINE_HTML") hidden.push(token);
    }
    return { comments, code: replaceSourceRanges(text, [...hidden, ...comments].sort((left, right) => left.start - right.start)) };
  }
  const comments: SourceRange[] = [];
  const strings: SourceRange[] = [];
  let index = 0;
  while (index < text.length) {
    const current = text[index];
    const lineStart = text.lastIndexOf("\n", index - 1) + 1;
    const prefix = text.slice(lineStart, index);
    if (current === '"' || current === "'" || (current === "`" && language !== "python")) {
      const start = index;
      const triple = language === "python" && text.startsWith((current ?? "").repeat(3), index);
      const quote = triple ? (current ?? "").repeat(3) : current;
      index += quote.length;
      while (index < text.length) {
        if (text[index] === "\\" && !(language === "go" && current === "`")) { index += 2; continue; }
        if (text.startsWith(quote, index)) { index += quote.length; break; }
        index++;
      }
      const range = { start, end: index };
      strings.push(range);
      if (triple && prefix.trim() === "") {
        const previous = text.slice(0, lineStart).trimEnd();
        const lastLine = previous.slice(previous.lastIndexOf("\n") + 1).trim();
        if (previous.length === 0) comments.push(range);
        else if (/^(?:async\s+)?(?:def|class)\b.*:\s*$/.test(lastLine)) comments.push({ ...range, replacement: "pass" });
      }
      continue;
    }
    const lineComment = (language !== "python" && text.startsWith("//", index)) ||
      (language === "python" && current === "#");
    if (lineComment) {
      let end = text.indexOf("\n", index);
      if (end === -1) end = text.length;
      const comment = text.slice(index, end).trim();
      const directive = (index === 0 && comment.startsWith("#!")) ||
        (language === "go" && /^\/\/(?:go:[a-z][a-z0-9]*(?:\s|$)|line\s| \+build\b)/.test(comment));
      if (!directive) comments.push({ start: index, end });
      index = end;
      continue;
    }
    if (language !== "python" && text.startsWith("/*", index)) {
      const close = text.indexOf("*/", index + 2);
      const end = close === -1 ? text.length : close + 2;
      comments.push({ start: index, end });
      index = end;
      continue;
    }
    index++;
  }
  return { comments, code: replaceSourceRanges(text, [...strings, ...comments].sort((a, b) => a.start - b.start)) };
}
