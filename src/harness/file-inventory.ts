import fs from "node:fs";
import path from "node:path";

const IGNORED_DIRECTORIES = new Set([
  ".git", "node_modules", "dist", "vendor", ".venv", "venv", "__pycache__",
  ".control-glass", "coverage", ".next", ".nuxt", ".cache", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox"
]);

export function isTestFile(name: string): boolean {
  return /\.(spec|test)\.tsx?$/.test(name) || /(^test_.*|.*_test)\.py$/.test(name) ||
    name.endsWith("_test.go") || name.endsWith("Test.php") || name.endsWith(".contract.ts");
}

export function isContractFile(name: string): boolean {
  return /^contracts\.(ts|py|go)$/i.test(name) || name === "Contracts.php";
}

export function isSourceFile(name: string): boolean {
  const extension = path.extname(name);
  return new Set([".ts", ".tsx", ".py", ".go", ".php"]).has(extension);
}

export function collectProjectFiles(rootDir: string): string[] {
  const files: string[] = [];
  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) visit(full);
      else if (entry.isFile() && (isSourceFile(entry.name) || entry.name.endsWith(".json") || /^\.env(?:\.|$)/.test(entry.name))) files.push(full);
    }
  }
  if (fs.existsSync(rootDir)) visit(rootDir);
  return files.sort();
}

export function collectProvenanceFiles(rootDir: string): string[] {
  const root = path.resolve(rootDir);
  const files: string[] = [];
  function relative(file: string): string {
    return path.relative(root, file).split(path.sep).join("/");
  }
  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.name === ".git" || ((entry.isDirectory() || entry.isSymbolicLink()) && IGNORED_DIRECTORIES.has(entry.name))) continue;
      if (entry.isSymbolicLink()) throw new Error("SYMLINK_PROVENANCE_UNSUPPORTED: " + relative(full));
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  if (fs.existsSync(root)) visit(root);
  const lockFile = path.join(root, ".control-glass/tdd-lock.json");
  if (fs.existsSync(lockFile)) {
    const entry = fs.lstatSync(lockFile);
    if (entry.isSymbolicLink()) throw new Error("SYMLINK_PROVENANCE_UNSUPPORTED: .control-glass/tdd-lock.json");
    if (!entry.isFile()) throw new Error("INVALID_PROVENANCE_INPUT: .control-glass/tdd-lock.json");
    files.push(lockFile);
  }
  return files.sort((first, second) => {
    const left = relative(first);
    const right = relative(second);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
