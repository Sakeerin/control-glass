import ts from "typescript";

export interface SourceRange {
  readonly start: number;
  readonly end: number;
  readonly replacement?: string;
}

export function typeScriptComments(sourceFile: ts.SourceFile): readonly SourceRange[] {
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
  const comments: SourceRange[] = [];
  const strings: SourceRange[] = [];
  let index = 0;
  while (index < text.length) {
    const current = text[index];
    const lineStart = text.lastIndexOf("\n", index - 1) + 1;
    const prefix = text.slice(lineStart, index);
    if (language === "php" && text.startsWith("<<<", index)) {
      const opener = /^<<<[ \t]*(['"]?)([a-zA-Z_][a-zA-Z0-9_]*)\1[^\r\n]*\r?\n/.exec(text.slice(index));
      if (opener?.[2]) {
        const endPattern = new RegExp("^[ \\t]*" + opener[2] + "(?=;?\\s*$)", "m");
        const tail = text.slice(index + opener[0].length);
        const close = endPattern.exec(tail);
        const end = close ? index + opener[0].length + close.index + close[0].length : text.length;
        strings.push({ start: index, end });
        index = end;
        continue;
      }
    }
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
      ((language === "python" || language === "php") && current === "#" && !(language === "php" && text[index + 1] === "["));
    if (lineComment) {
      let end = text.indexOf("\n", index);
      if (end === -1) end = text.length;
      if (language === "php") {
        const closeTag = text.indexOf("?>", index);
        if (closeTag !== -1 && closeTag < end) end = closeTag;
      }
      const comment = text.slice(index, end).trim();
      const directive = (index === 0 && comment.startsWith("#!")) ||
        (language === "go" && /^\/\/(?:go:build| \+build)\b/.test(comment));
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
