import { isDirectExecution } from "./runtime.js";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { loadCompilerOptions, resolveProjectImport } from "./module-resolver.js";
import { collectModuleReferences } from "./module-references.js";
import {
  collectPolyglotSourceFiles,
  detectLanguageFromFile,
  extractNonTsImports,
  type SupportedLanguage
} from "./polyglot-engine.js";

export interface FileDependencyNode {
  readonly file: string;
  readonly language: SupportedLanguage;
  readonly layer: "core" | "features" | "ui" | "harness" | "vendors" | "other";
  readonly imports: readonly string[];
  readonly importedBy: readonly string[];
  readonly exportedSymbols: readonly string[];
}

export interface DependencyGraphArtifact {
  readonly generatedAt: string;
  readonly totalFiles: number;
  readonly nodes: Record<string, FileDependencyNode>;
  readonly unresolvedImports: readonly { readonly file: string; readonly line: number }[];
}

function classifyLayer(relPath: string): FileDependencyNode["layer"] {
  const lower = relPath.toLowerCase();
  if (lower.startsWith("src/core/") || lower.includes("/core/")) return "core";
  if (lower.startsWith("src/features/") || lower.includes("/features/")) return "features";
  if (lower.startsWith("src/ui/") || lower.includes("/ui/")) return "ui";
  if (lower.startsWith("src/harness/")) return "harness";
  if (lower.startsWith("src/vendors/")) return "vendors";
  return "other";
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node);
  return Boolean(
    modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function extractNonTsExports(
  content: string,
  lang: Exclude<SupportedLanguage, "typescript">
): string[] {
  const exports: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (lang === "python") {
      const pyMatch = /^(?:def|class)\s+([a-zA-Z0-9_]+)/.exec(trimmed);
      if (pyMatch?.[1] && !pyMatch[1].startsWith("_")) {
        exports.push(pyMatch[1]);
      }
    } else if (lang === "go") {
      const goMatch = /^(?:func|type|var|const)\s+([A-Z][a-zA-Z0-9_]*)/.exec(trimmed);
      if (goMatch?.[1]) {
        exports.push(goMatch[1]);
      }
    } else if (lang === "php") {
      const phpMatch = /^(?:final\s+|readonly\s+)*(?:class|interface|trait|enum|public\s+function)\s+([a-zA-Z0-9_]+)/.exec(
        trimmed
      );
      if (phpMatch?.[1]) {
        exports.push(phpMatch[1]);
      }
    }
  }
  return exports;
}

export function buildDependencyGraph(rootDir: string = process.cwd()): DependencyGraphArtifact {
  const srcFiles = collectPolyglotSourceFiles(rootDir);
  const compilerOptions = loadCompilerOptions(rootDir);
  const rawImports: Record<string, string[]> = {};
  const rawExports: Record<string, string[]> = {};
  const fileLangs: Record<string, SupportedLanguage> = {};
  const reverseImports: Record<string, Set<string>> = {};
  const unresolvedImports: { file: string; line: number }[] = [];

  for (const absPath of srcFiles) {
    const relPath = path.relative(rootDir, absPath).split(path.sep).join("/");
    const lang = detectLanguageFromFile(absPath) ?? "typescript";
    fileLangs[relPath] = lang;
    rawImports[relPath] = [];
    rawExports[relPath] = [];
    if (!reverseImports[relPath]) {
      reverseImports[relPath] = new Set();
    }

    const content = fs.readFileSync(absPath, "utf8");

    if (lang === "typescript") {
      const scriptKind = relPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      const sf = ts.createSourceFile(
        relPath,
        content,
        ts.ScriptTarget.Latest,
        true,
        scriptKind
      );

      const recordImport = (specifier: string): void => {
        const target = resolveProjectImport(rootDir, relPath, specifier, compilerOptions);
        if (!rawImports[relPath]?.includes(target)) rawImports[relPath]?.push(target);
        if (!reverseImports[target]) reverseImports[target] = new Set();
        reverseImports[target]?.add(relPath);
      };
      const visit = (node: ts.Node): void => {
        if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) rawExports[relPath]?.push(element.name.text);
        }
        if (hasExportModifier(node)) {
          if ((ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node)) && node.name) rawExports[relPath]?.push(node.name.text);
          else if (ts.isVariableStatement(node)) {
            for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name)) rawExports[relPath]?.push(declaration.name.text);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      for (const reference of collectModuleReferences(sf)) {
        if (reference.specifier === null) unresolvedImports.push({ file: relPath, line: sf.getLineAndCharacterOfPosition(reference.position).line + 1 });
        else recordImport(reference.specifier);
      }
    } else {
      for (const { specifier } of extractNonTsImports(content, lang)) {
        if (!rawImports[relPath]?.includes(specifier)) rawImports[relPath]?.push(specifier);
        if (!reverseImports[specifier]) reverseImports[specifier] = new Set();
        reverseImports[specifier]?.add(relPath);
      }
      rawExports[relPath]?.push(...extractNonTsExports(content, lang));
    }
  }

  const nodes: Record<string, FileDependencyNode> = {};
  for (const relPath of Object.keys(rawImports)) {
    nodes[relPath] = {
      file: relPath,
      language: fileLangs[relPath] ?? "typescript",
      layer: classifyLayer(relPath),
      imports: rawImports[relPath] ?? [],
      importedBy: Array.from(reverseImports[relPath] ?? []),
      exportedSymbols: rawExports[relPath] ?? []
    };
  }

  const artifact: DependencyGraphArtifact = {
    generatedAt: new Date().toISOString(),
    totalFiles: Object.keys(nodes).length,
    nodes,
    unresolvedImports
  };

  const outPath = path.join(rootDir, ".control-glass", "dependency-graph.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

  return artifact;
}

if (isDirectExecution(import.meta.url)) {
  const graph = buildDependencyGraph();
  console.log(
    `🗺️  Auto-Mapper built Polyglot AST dependency graph (${graph.totalFiles} files mapped -> .control-glass/dependency-graph.json).`
  );
}
