import { loadFeatureMap } from "./project-config.js";
import { readGit, isDirectExecution } from "./runtime.js";

export type ReviewTier = "Tier 0" | "Tier 1" | "Tier 2";
export interface FeatureEntry {
  readonly id: string;
  readonly name: string;
  readonly tier: ReviewTier;
  readonly riskReason: string;
  readonly entrypoints: readonly string[];
  readonly contracts: readonly string[];
  readonly tests: readonly string[];
}
export interface DiffOptions {
  readonly baseRef?: string;
  readonly headRef?: string;
  readonly gatesPassed?: boolean;
}
export interface DiffReviewReport {
  readonly changedFiles: readonly string[];
  readonly impactedFeatures: readonly Pick<FeatureEntry, "id" | "name" | "tier" | "riskReason">[];
  readonly recommendedTier: ReviewTier;
  readonly routingDecision: string;
  readonly status: "known" | "unavailable";
  readonly errors: readonly string[];
}
const TIER_WEIGHT: Record<ReviewTier, number> = { "Tier 0": 0, "Tier 1": 1, "Tier 2": 2 };

function readWorkingFiles(rootDir: string): { files: string[]; errors: string[] } {
  const status = readGit(rootDir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (!status.ok) return { files: [], errors: ["GIT_STATUS_UNAVAILABLE"] };
  const records = status.value.split("\0");
  const files: string[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    files.push(record.slice(3));
    if (/^[RC]|^.[RC]/.test(record.slice(0, 2))) {
      const origin = records[++index];
      if (origin) files.push(origin);
    }
  }
  return { files, errors: [] };
}

function readChangedFiles(rootDir: string, options: DiffOptions): { files: string[]; errors: string[] } {
  const useEnvironment = rootDir === process.cwd();
  const baseRef = options.baseRef ?? (useEnvironment ? process.env["CONTROL_GLASS_BASE_REF"] : undefined);
  const headRef = options.headRef ?? (useEnvironment ? process.env["CONTROL_GLASS_HEAD_REF"] : undefined) ?? "HEAD";
  if (baseRef !== undefined) {
    if (baseRef.startsWith("-") || headRef.startsWith("-")) return { files: [], errors: ["INVALID_DIFF_REFERENCE"] };
    const mergeBase = readGit(rootDir, ["merge-base", baseRef, headRef]);
    if (!mergeBase.ok) return { files: [], errors: ["DIFF_BASE_UNAVAILABLE"] };
    const diff = readGit(rootDir, ["diff", "--name-status", "-z", "--find-renames", mergeBase.value.trim(), headRef, "--"]);
    if (!diff.ok) return { files: [], errors: ["GIT_DIFF_UNAVAILABLE"] };
    const fields = diff.value.split("\0");
    const files: string[] = [];
    for (let index = 0; index < fields.length;) {
      const status = fields[index++];
      if (!status) continue;
      const first = fields[index++];
      if (first) files.push(first);
      if (/^[RC]/.test(status)) {
        const second = fields[index++];
        if (second) files.push(second);
      }
    }
    const working = readWorkingFiles(rootDir);
    return { files: [...files, ...working.files], errors: working.errors };
  }
  if (useEnvironment && process.env["CI"] === "true") return { files: [], errors: ["CI_REQUIRES_EXPLICIT_BASE_REF"] };
  return readWorkingFiles(rootDir);
}

export function analyzeDiffAndTier(rootDir: string = process.cwd(), explicitChangedFiles?: readonly string[], options: DiffOptions = {}): DiffReviewReport {
  const changes = explicitChangedFiles === undefined ? readChangedFiles(rootDir, options) : { files: [...explicitChangedFiles], errors: [] };
  const changedFiles = [...new Set(changes.files.map(file => file.replace(/\\/g, "/")))];
  let features: readonly FeatureEntry[] = [];
  try { features = loadFeatureMap(rootDir).features; }
  catch { changes.errors.push("INVALID_FEATURE_MAP"); }
  let highestTier: ReviewTier = changes.errors.length > 0 ? "Tier 2" : "Tier 0";
  const impacted: DiffReviewReport["impactedFeatures"][number][] = [];
  for (const file of changedFiles) {
    const critical = /^src\/(?:core|Core|harness)\//.test(file) || /(?:^|\/)contracts\.(?:ts|py|go)$/i.test(file) || file.endsWith("/Contracts.php") || file === ".control-glass/tdd-lock.json" || ["feature-map.json", "control-glass.config.json", "AGENTS.md", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"].includes(file) || file.startsWith(".github/workflows/");
    const ui = /^(?:src\/ui|src\/components|components)\//.test(file);
    let fileTier: ReviewTier = critical ? "Tier 2" : ui ? "Tier 0" : "Tier 1";
    for (const feature of features) {
      if (![...feature.entrypoints, ...feature.contracts, ...feature.tests].includes(file)) continue;
      if (!impacted.some(item => item.id === feature.id)) impacted.push({ id: feature.id, name: feature.name, tier: feature.tier, riskReason: feature.riskReason });
      if (TIER_WEIGHT[feature.tier] > TIER_WEIGHT[fileTier]) fileTier = feature.tier;
    }
    if (TIER_WEIGHT[fileTier] > TIER_WEIGHT[highestTier]) highestTier = fileTier;
  }
  const status = changes.errors.length === 0 ? "known" : "unavailable";
  const routingDecision = status === "unavailable" ? "REVIEW BLOCKED: Diff or feature configuration is unavailable."
    : changedFiles.length === 0 ? "NO CHANGES: No merge approval was issued."
    : highestTier === "Tier 2" ? "SENIOR / DOMAIN EXPERT REVIEW REQUIRED."
    : highestTier === "Tier 1" ? "TASK OWNER REVIEW REQUIRED."
    : options.gatesPassed === true ? "AUTO-MERGE ELIGIBLE: All required gates passed for this low-risk diff."
    : "LOW-RISK CLASSIFICATION: All verification gates must pass before merge approval.";
  return { changedFiles, impactedFeatures: impacted, recommendedTier: highestTier, routingDecision, status, errors: changes.errors };
}

if (isDirectExecution(import.meta.url)) {
  const report = analyzeDiffAndTier();
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "known") process.exitCode = 1;
}
