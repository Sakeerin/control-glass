import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface TddLockManifest {
  readonly updatedAt: string;
  readonly files: Record<string, string>;
}

const LOCK_FILE_REL_PATH = ".control-glass/tdd-lock.json";

function collectLockedFiles(rootDir: string): string[] {
  const testsDir = path.join(rootDir, "tests");
  const files: string[] = [];
  if (fs.existsSync(testsDir)) {
    for (const entry of fs.readdirSync(testsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".spec.ts")) {
        files.push(path.join(testsDir, entry.name));
      }
    }
  }
  const coreContract = path.join(rootDir, "src/core/contracts.ts");
  if (fs.existsSync(coreContract)) {
    files.push(coreContract);
  }
  return files;
}

function sha256File(filePath: string): string {
  const normalizedContent = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  return crypto.createHash("sha256").update(normalizedContent, "utf8").digest("hex");
}

export function writeTddLockManifest(rootDir: string = process.cwd()): TddLockManifest {
  const files = collectLockedFiles(rootDir);
  const hashes: Record<string, string> = {};
  for (const filePath of files) {
    const rel = path.relative(rootDir, filePath).split(path.sep).join("/");
    hashes[rel] = sha256File(filePath);
  }

  const manifest: TddLockManifest = {
    updatedAt: new Date().toISOString(),
    files: hashes
  };

  const fullLockPath = path.join(rootDir, LOCK_FILE_REL_PATH);
  fs.mkdirSync(path.dirname(fullLockPath), { recursive: true });
  fs.writeFileSync(fullLockPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifest;
}

export function verifyTddLock(rootDir: string = process.cwd()): {
  readonly passed: boolean;
  readonly violations: readonly string[];
} {
  const fullLockPath = path.join(rootDir, LOCK_FILE_REL_PATH);
  if (!fs.existsSync(fullLockPath)) {
    return {
      passed: false,
      violations: [
        `TDD Lock manifest missing at ${LOCK_FILE_REL_PATH}. Run 'npm run lock:tests' during Phase 1 Requirement Freeze.`
      ]
    };
  }

  const manifest = JSON.parse(fs.readFileSync(fullLockPath, "utf8")) as TddLockManifest;
  const currentFiles = collectLockedFiles(rootDir);
  const violations: string[] = [];

  for (const [relPath, expectedHash] of Object.entries(manifest.files)) {
    const absPath = path.join(rootDir, relPath);
    if (!fs.existsSync(absPath)) {
      violations.push(`Locked contract/test file was deleted: ${relPath}`);
      continue;
    }
    const actualHash = sha256File(absPath);
    if (actualHash !== expectedHash) {
      violations.push(
        `Closed-Loop Testing Violation: Locked file '${relPath}' was modified without Phase 1 Spec Freeze approval.`
      );
    }
  }

  for (const filePath of currentFiles) {
    const relPath = path.relative(rootDir, filePath).split(path.sep).join("/");
    if (!(relPath in manifest.files)) {
      violations.push(
        `Unregistered test/contract file '${relPath}'. Freeze and lock via 'npm run lock:tests' before implementation.`
      );
    }
  }

  return {
    passed: violations.length === 0,
    violations
  };
}

if (process.argv[1]?.endsWith("tdd-guard.ts")) {
  if (process.argv.includes("--update-lock")) {
    const manifest = writeTddLockManifest();
    console.log(
      `🔒 TDD & Contract Lock updated (${Object.keys(manifest.files).length} files frozen).`
    );
    process.exit(0);
  }

  const check = verifyTddLock();
  if (!check.passed) {
    console.error("❌ TDD Guard failed (Closed-Loop Testing Protection):");
    for (const v of check.violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }
  console.log("✅ TDD Guard passed (All frozen test suites and contracts are intact).");
}
