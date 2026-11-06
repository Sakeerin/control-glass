import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { collectProjectFiles, isTestFile, isContractFile } from "./file-inventory.js";
import { readGit, isDirectExecution } from "./runtime.js";

const ManifestSchema = z.object({ updatedAt: z.string(), files: z.record(z.string().regex(/^[a-f0-9]{64}$/)) });
const ReceiptSchema = z.object({ manifestHash: z.string(), headCommit: z.string().nullable() });
export type TddLockManifest = z.infer<typeof ManifestSchema>;
export interface SpecFreezeOptions { readonly phase: "spec-freeze" | "initialization"; }
export interface TddLockOptions { readonly baseRef?: string; }
const LOCK_FILE_REL_PATH = ".control-glass/tdd-lock.json";

function digest(text: string): string {
  return crypto.createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}
function lockedFiles(rootDir: string): string[] {
  return collectProjectFiles(rootDir).filter(file => isTestFile(path.basename(file)) || isContractFile(path.basename(file)));
}
function receiptPath(rootDir: string): string | null {
  const result = readGit(rootDir, ["rev-parse", "--git-path", "control-glass/spec-freeze.json"]);
  return result.ok ? path.resolve(rootDir, result.value.trim()) : null;
}
function headCommit(rootDir: string): string | null {
  const head = readGit(rootDir, ["rev-parse", "--verify", "HEAD"]);
  return head.ok ? head.value.trim() : null;
}
function manifestTrusted(rootDir: string, content: string, options: TddLockOptions): boolean {
  const currentHash = digest(content);
  const useEnvironment = path.resolve(rootDir) === process.cwd();
  const dedicatedBase = useEnvironment ? process.env["CONTROL_GLASS_LOCK_BASE_REF"] : undefined;
  const baselineRef = dedicatedBase ?? options.baseRef ?? (useEnvironment ? process.env["CONTROL_GLASS_BASE_REF"] : undefined) ?? "HEAD";
  if (baselineRef.startsWith("-")) return false;
  const baseline = readGit(rootDir, ["show", baselineRef + ":" + LOCK_FILE_REL_PATH]);
  if (baseline.ok && digest(baseline.value) === currentHash) return true;
  if (useEnvironment && process.env["CONTROL_GLASS_APPROVED_LOCK_SHA256"] === currentHash) return true;
  if (useEnvironment && process.env["CI"] === "true") return false;
  const receipt = receiptPath(rootDir);
  if (receipt === null || !fs.existsSync(receipt)) return false;
  try {
    const parsed = ReceiptSchema.parse(JSON.parse(fs.readFileSync(receipt, "utf8")));
    return parsed.manifestHash === currentHash && parsed.headCommit === headCommit(rootDir);
  } catch { return false; }
}

export function writeTddLockManifest(rootDir: string = process.cwd(), options?: SpecFreezeOptions): TddLockManifest {
  if (options === undefined) throw new Error("SPEC_FREEZE_PHASE_REQUIRED");
  const fullLockPath = path.join(rootDir, LOCK_FILE_REL_PATH);
  if (options.phase === "initialization" && fs.existsSync(fullLockPath)) return ManifestSchema.parse(JSON.parse(fs.readFileSync(fullLockPath, "utf8")));
  if (path.resolve(rootDir) === process.cwd() && process.env["CI"] === "true") throw new Error("SPEC_FREEZE_IS_NOT_ALLOWED_IN_CI");
  const files: Record<string, string> = {};
  for (const file of lockedFiles(rootDir)) files[path.relative(rootDir, file).split(path.sep).join("/")] = digest(fs.readFileSync(file, "utf8"));
  const manifest: TddLockManifest = { updatedAt: new Date().toISOString(), files };
  const content = JSON.stringify(manifest, null, 2) + "\n";
  fs.mkdirSync(path.dirname(fullLockPath), { recursive: true });
  fs.writeFileSync(fullLockPath, content, "utf8");
  const receipt = receiptPath(rootDir);
  if (receipt !== null) {
    fs.mkdirSync(path.dirname(receipt), { recursive: true });
    fs.writeFileSync(receipt, JSON.stringify({ manifestHash: digest(content), headCommit: headCommit(rootDir) }, null, 2) + "\n", "utf8");
  }
  return manifest;
}

export function verifyTddLock(rootDir: string = process.cwd(), options: TddLockOptions = {}): { readonly passed: boolean; readonly violations: readonly string[] } {
  const fullLockPath = path.join(rootDir, LOCK_FILE_REL_PATH);
  if (!fs.existsSync(fullLockPath)) return { passed: false, violations: ["TDD manifest missing. Freeze tests explicitly during Phase 1."] };
  try {
    const content = fs.readFileSync(fullLockPath, "utf8");
    const manifest = ManifestSchema.parse(JSON.parse(content));
    const violations: string[] = [];
    if (!manifestTrusted(rootDir, content, options)) violations.push("UNTRUSTED_TDD_MANIFEST: Requires an approved baseline or explicit Phase 1 freeze receipt.");
    for (const [relative, expected] of Object.entries(manifest.files)) {
      const absolute = path.resolve(rootDir, relative);
      const within = path.relative(path.resolve(rootDir), absolute);
      if (path.isAbsolute(relative) || within.startsWith("..") || path.isAbsolute(within)) { violations.push("INVALID_LOCK_PATH"); continue; }
      if (!fs.existsSync(absolute)) violations.push("Locked file deleted: " + relative);
      else if (digest(fs.readFileSync(absolute, "utf8")) !== expected) violations.push("Locked file modified: " + relative);
    }
    for (const file of lockedFiles(rootDir)) {
      const relative = path.relative(rootDir, file).split(path.sep).join("/");
      if (!(relative in manifest.files)) violations.push("Unregistered test or contract: " + relative);
    }
    return { passed: violations.length === 0, violations };
  } catch { return { passed: false, violations: ["INVALID_TDD_MANIFEST"] }; }
}

if (isDirectExecution(import.meta.url)) {
  if (process.argv.includes("--update-lock")) {
    if (!process.argv.includes("--phase=spec-freeze")) throw new Error("Explicit --phase=spec-freeze is required.");
    const manifest = writeTddLockManifest(process.cwd(), { phase: "spec-freeze" });
    console.log("Phase 1 tests and contracts frozen: " + Object.keys(manifest.files).length);
  } else {
    const result = verifyTddLock();
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  }
}
