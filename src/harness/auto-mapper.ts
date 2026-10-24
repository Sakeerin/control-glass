import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface FileDependencyNode {
  readonly file: string;
  readonly layer: "core" | "features" | "ui" | "harness" | "other";
  readonly imports: readonly string[];
  readonly importedBy: readonly string[];
  readonly exportedSymbols: readonly string[];
}

export interface DependencyGraphArtifact {
  readonly generatedAt: string;
  readonly totalFiles: number;
  readonly nodes: Record<string, FileDependencyNode>;
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

function classifyLayer(relPath: string): FileDependencyNode["layer"] {
  if (relPath.startsWith("src/core/")) return "core";
  if (relPath.startsWith("src/features/")) return "features";
  if (relPath.startsWith("src/ui/")) return "ui";
  if (relPath.startsWith("src/harness/")) return "harness";
  return "other";
}

function resolveImportToRelPath(importerRel: string, spec: string): string {
  if (!spec.startsWith(".")) {
    return spec;
  }
  const dir = path.posix.dirname(importerRel);
  const normalized = path.posix.normalize(path.posix.join(dir, spec));
  return normalized.endsWith(".js")
    ? normalized.slice(0, -3) + ".ts"
    : normalized;
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

export function buildDependencyGraph(rootDir: string = process.cwd()): DependencyGraphArtifact {
  const srcFiles = collectTsFiles(path.join(rootDir, "src"));
  const rawImports: Record<string, string[]> = {};
  const rawExports: Record<string, string[]> = {};
  const reverseImports: Record<string, Set<string>> = {};

  for (const absPath of srcFiles) {
    const relPath = path.relative(rootDir, absPath).split(path.sep).join("/");
    rawImports[relPath] = [];
    rawExports[relPath] = [];
    if (!reverseImports[relPath]) {
      reverseImports[relPath] = new Set();
    }

    const content = fs.readFileSync(absPath, "utf8");
    const sf = ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    sf.forEachChild((node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = resolveImportToRelPath(relPath, node.moduleSpecifier.text);
        rawImports[relPath]?.push(target);
        if (!reverseImports[target]) {
          reverseImports[target] = new Set();
        }
        reverseImports[target]?.add(relPath);
      }

      if (hasExportModifier(node)) {
        if (
          (ts.isFunctionDeclaration(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isTypeAliasDeclaration(node) ||
            ts.isClassDeclaration(node)) &&
          node.name
        ) {
          rawExports[relPath]?.push(node.name.text);
        } else if (ts.isVariableStatement(node)) {
          for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              rawExports[relPath]?.push(decl.name.text);
            }
          }
        }
      }
    });
  }

  const nodes: Record<string, FileDependencyNode> = {};
  for (const relPath of Object.keys(rawImports)) {
    nodes[relPath] = {
      file: relPath,
      layer: classifyLayer(relPath),
      imports: rawImports[relPath] ?? [],
      importedBy: Array.from(reverseImports[relPath] ?? []),
      exportedSymbols: rawExports[relPath] ?? []
    };
  }

  const artifact: DependencyGraphArtifact = {
    generatedAt: new Date().toISOString(),
    totalFiles: Object.keys(nodes).length,
    nodes
  };

  const outPath = path.join(rootDir, ".control-glass", "dependency-graph.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

  return artifact;
}

if (process.argv[1]?.endsWith("auto-mapper.ts")) {
  const graph = buildDependencyGraph();
  console.log(
    `🗺️  Auto-Mapper built AST dependency graph (${graph.totalFiles} files mapped -> .control-glass/dependency-graph.json).`
  );
}
