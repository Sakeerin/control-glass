import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach } from "vitest";

const roots: string[] = [];

export function fixture(entries: Readonly<Record<string, string>> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "control-glass-regression-"));
  roots.push(root);
  for (const [relative, content] of Object.entries(entries)) write(root, relative, content);
  return root;
}

export function write(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", [
    "-c", "user.name=Control Glass Tests", "-c", "user.email=tests@example.invalid",
    "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args
  ], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function repository(entries: Readonly<Record<string, string>> = {}): string {
  const root = fixture(entries);
  git(root, "init", "--quiet");
  return root;
}

export function commit(root: string, message: string): void {
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "--no-verify", "-m", message);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("INVALID_FIXTURE_ROOT");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
