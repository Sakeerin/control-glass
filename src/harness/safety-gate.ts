import { isDirectExecution } from "./runtime.js";
import fs from "node:fs";
import path from "node:path";
import { collectSafetyFiles } from "./file-inventory.js";

export interface SafetyFinding {
  readonly file: string;
  readonly line: number;
  readonly category: "SECRET_LEAK" | "DESTRUCTIVE_COMMAND" | "UNSAFE_EXECUTION";
  readonly detail: string;
}

interface PatternRule {
  readonly category: SafetyFinding["category"];
  readonly regex: RegExp;
  readonly detail: string;
}

const SAFETY_PATTERNS: readonly PatternRule[] = [
  {
    category: "SECRET_LEAK",
    regex: /\b(sk-(?:proj-)?[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{30,}|AKIA[0-9A-Z]{16})\b/,
    detail: "Hardcoded API key or cloud credential detected."
  },
  {
    category: "SECRET_LEAK",
    regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    detail: "Private cryptographic key detected in source tree."
  },
  {
    category: "DESTRUCTIVE_COMMAND",
    regex: /\b(DROP\s+TABLE|DROP\s+DATABASE|TRUNCATE\s+TABLE)\b/i,
    detail: "Destructive SQL operation violates Least Privilege guardrail."
  },
  {
    category: "DESTRUCTIVE_COMMAND",
    regex: /\brm\s+-rf\s+(\/|~|\*)/,
    detail: "Destructive shell deletion pattern detected."
  },
  {
    category: "UNSAFE_EXECUTION",
    regex: /\beval\s*\(/,
    detail: "Dynamic code evaluation (eval) is prohibited."
  }
];

export function runSafetyGate(rootDir: string = process.cwd()): {
  readonly passed: boolean;
  readonly scannedFiles: number;
  readonly findings: readonly SafetyFinding[];
} {
  const files = collectSafetyFiles(rootDir);
  const findings: SafetyFinding[] = [];
  let scannedFiles = 0;

  for (const filePath of files) {
    const relativePath = path.relative(rootDir, filePath).split(path.sep).join("/");
    const bytes = fs.readFileSync(filePath);
    if (bytes.includes(0)) continue;
    scannedFiles++;
    const documentation = /\.(?:md|mdx|rst)$/i.test(relativePath);
    const lines = bytes.toString("utf8").split(/\r?\n/);
    lines.forEach((lineText, idx) => {
      for (const rule of SAFETY_PATTERNS) {
        if (documentation && rule.category !== "SECRET_LEAK") continue;
        if (rule.regex.test(lineText)) {
          findings.push({
            file: relativePath,
            line: idx + 1,
            category: rule.category,
            detail: rule.detail
          });
        }
      }
    });
  }

  return {
    passed: findings.length === 0,
    scannedFiles,
    findings
  };
}

if (isDirectExecution(import.meta.url)) {
  const res = runSafetyGate();
  if (!res.passed) {
    console.error(`❌ Safety & Secret Gate failed with ${res.findings.length} finding(s):`);
    for (const f of res.findings) {
      console.error(`  [${f.category}] ${f.file}:${f.line} — ${f.detail}`);
    }
    process.exit(1);
  }
  console.log(`✅ Safety & Secret Gate passed (${res.scannedFiles} files scanned, 0 leaks/hazards).`);
}
