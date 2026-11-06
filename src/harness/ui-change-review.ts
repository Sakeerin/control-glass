import fs from "node:fs";
import path from "node:path";
import type ts from "typescript";
import { readGit } from "./runtime.js";
import { loadTypeScript, typeScriptComments } from "./source-analysis.js";

export interface UiDiffContext {
  readonly baseRef: string;
  readonly headRef?: string;
  readonly workingFiles: readonly string[];
  readonly changedFiles: readonly string[];
}

type SyntaxShape = readonly [number, string | readonly SyntaxShape[]];

function canonicalSyntax(content: string, file: string): string | null {
  if (content.startsWith("#!")) return null;
  const ts = loadTypeScript();
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const diagnostics = ts.transpileModule(content, {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve }
  }).diagnostics ?? [];
  if (diagnostics.some(item => item.category === ts.DiagnosticCategory.Error) || typeScriptComments(source).length > 0) return null;
  const shape = (node: ts.Node): SyntaxShape => {
    const children = node.getChildren(source);
    return [node.kind, children.length > 0 ? children.map(shape) : node.kind === ts.SyntaxKind.JsxText ? content.slice(node.pos, node.end) : node.getText(source)];
  };
  return JSON.stringify(shape(source));
}

export function assessUiChange(rootDir: string, file: string, context: UiDiffContext | null): "formatting" | "logic" | "unavailable" {
  if (context === null || !context.changedFiles.includes(file)) return "unavailable";
  if (!/\.tsx?$/.test(file)) return "logic";
  const absolute = path.resolve(rootDir, file);
  const relative = path.relative(path.resolve(rootDir), absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "unavailable";
  const modeChanges = readGit(rootDir, ["diff", "--summary", context.baseRef, ...(context.headRef === undefined ? [] : [context.headRef]), "--", file]);
  if (!modeChanges.ok || modeChanges.value.trim().length > 0) return "logic";
  if (context.headRef !== undefined && context.workingFiles.includes(file)) {
    const workingModes = readGit(rootDir, ["diff", "--summary", "HEAD", "--", file]);
    if (!workingModes.ok || workingModes.value.trim().length > 0) return "logic";
  }
  const before = readGit(rootDir, ["show", context.baseRef + ":" + file]);
  if (!before.ok) return "logic";
  const versions: string[] = [before.value];
  if (context.headRef !== undefined) {
    const after = readGit(rootDir, ["show", context.headRef + ":" + file]);
    if (!after.ok) return "logic";
    versions.push(after.value);
  }
  if (context.workingFiles.includes(file)) {
    try {
      if (!fs.lstatSync(absolute).isFile()) return "logic";
      versions.push(fs.readFileSync(absolute, "utf8"));
    } catch { return "logic"; }
  }
  if (versions.length < 2) return "unavailable";
  const canonical = versions.map(content => canonicalSyntax(content, file));
  if (canonical[0] === null || canonical.some(content => content !== canonical[0])) return "logic";
  return "formatting";
}
