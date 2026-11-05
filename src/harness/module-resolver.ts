import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export function loadCompilerOptions(rootDir: string): ts.CompilerOptions {
  const configPath = path.join(rootDir, "tsconfig.json");
  if (!fs.existsSync(configPath)) return { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve };
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error("INVALID_TYPESCRIPT_CONFIGURATION");
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, rootDir);
  if (parsed.errors.some(error => error.code !== 18003)) throw new Error("INVALID_TYPESCRIPT_CONFIGURATION");
  return parsed.options;
}

export function resolveProjectImport(rootDir: string, importer: string, specifier: string, options: ts.CompilerOptions): string {
  const resolved = ts.resolveModuleName(specifier, path.join(rootDir, importer), options, ts.sys).resolvedModule;
  if (resolved && !resolved.isExternalLibraryImport) return path.relative(rootDir, resolved.resolvedFileName).split(path.sep).join("/");
  if (specifier.startsWith(".")) return path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  return specifier;
}
