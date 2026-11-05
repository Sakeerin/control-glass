import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { type Result, ok, err } from "../core/contracts.js";

export function isDirectExecution(moduleUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(path.resolve(entry)).href === moduleUrl;
}

export function readGit(rootDir: string, args: readonly string[]): Result<string, "GIT_UNAVAILABLE"> {
  try {
    return ok(execFileSync("git", [...args], { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000, maxBuffer: 16 * 1024 * 1024 }));
  } catch {
    return err("GIT_UNAVAILABLE");
  }
}
