import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface TddLockManifest {
  readonly updatedAt: string;
  readonly files: Record<string, string>;
}

const LOCK_FILE_REL_PATH = ".control-glass/tdd-lock.json";

function collectFilesRecursive(
  dirPath: string,
  predicate: (fileName: string) => boolean
): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const results: string[] = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursive(full, predicate));
    } else if (entry.isFile() && predicate(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function collectLockedFiles(rootDir: string): string[] {
  const isSpecOrContract = (name: string): boolean =>
    name.endsWith(".spec.ts") ||
    name.endsWith(".test.ts") ||
    name.endsWith(".spec.tsx") ||
    name.endsWith(".test.tsx") ||
    name.endsWith(".contract.ts") ||
    name.endsWith("_test.py") ||
    (name.startsWith("test_") && name.endsWith(".py")) ||
    name.endsWith("_test.go") ||
    name.endsWith("Test.php") ||
    name === "contracts.py" ||
    name === "contracts.go" ||
    name === "Contracts.php";

  const files = new Set<string>();
  for (const dir of ["tests", "src", "app", "pages", "components", "server", "lib", "pkg", "internal"]) {
    for (const f of collectFilesRecursive(path.join(rootDir, dir), isSpecOrContract)) {
      files.add(f);
    }
  }

  const coreContract = path.join(rootDir, "src/core/contracts.ts");
  if (fs.existsSync(coreContract)) {
    files.add(coreContract);
  }

  return Array.from(files);
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
