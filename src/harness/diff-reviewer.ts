import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

interface FeatureMapDoc {
  readonly features: readonly FeatureEntry[];
}

export interface DiffReviewReport {
  readonly changedFiles: readonly string[];
  readonly impactedFeatures: readonly {
    readonly id: string;
    readonly name: string;
    readonly tier: ReviewTier;
    readonly riskReason: string;
  }[];
  readonly recommendedTier: ReviewTier;
  readonly routingDecision: string;
}

const TIER_WEIGHT: Record<ReviewTier, number> = {
  "Tier 0": 0,
  "Tier 1": 1,
  "Tier 2": 2
};

function getChangedFilesFromGit(rootDir: string): string[] {
  try {
    const statusOut = execSync("git status --porcelain -uall", {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const lines = statusOut
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    return lines.map((line) => line.slice(3).trim().replace(/\\/g, "/"));
  } catch {
    return [];
  }
}

export function analyzeDiffAndTier(
  rootDir: string = process.cwd(),
  explicitChangedFiles?: readonly string[]
): DiffReviewReport {
  const featureMapPath = path.join(rootDir, "feature-map.json");
  const featureMap = JSON.parse(fs.readFileSync(featureMapPath, "utf8")) as FeatureMapDoc;
  const changedFiles = explicitChangedFiles ?? getChangedFilesFromGit(rootDir);

  let highestTier: ReviewTier = "Tier 0";
  const impacted: DiffReviewReport["impactedFeatures"][number][] = [];

  for (const file of changedFiles) {
    if (file.startsWith("src/core/") || file.startsWith("src/harness/")) {
      highestTier = "Tier 2";
    }
    for (const feature of featureMap.features) {
      const allFeatureFiles = [...feature.entrypoints, ...feature.contracts, ...feature.tests];
      if (allFeatureFiles.includes(file)) {
        if (!impacted.some((i) => i.id === feature.id)) {
          impacted.push({
            id: feature.id,
            name: feature.name,
            tier: feature.tier,
            riskReason: feature.riskReason
          });
        }
        if (TIER_WEIGHT[feature.tier] > TIER_WEIGHT[highestTier]) {
          highestTier = feature.tier;
        }
      }
    }
  }

  if (changedFiles.length > 0 && impacted.length === 0 && highestTier === "Tier 0") {
    const onlyUi = changedFiles.every((f) => f.startsWith("src/ui/"));
    if (!onlyUi) {
      highestTier = "Tier 1";
    }
  }

  const routingMap: Record<ReviewTier, string> = {
    "Tier 0":
      "AUTO-MERGE ELIGIBLE: Standard low-risk change verified by Control Glass. Zero human review bottleneck required.",
    "Tier 1":
      "TASK OWNER REVIEW: Moderate feature change. Route to Task Owner with Diff Consequence summary.",
    "Tier 2":
      "SENIOR / DOMAIN EXPERT REVIEW REQUIRED: Touches critical contracts, financial ledger, or orbital physics logic."
  };

  return {
    changedFiles,
    impactedFeatures: impacted,
    recommendedTier: highestTier,
    routingDecision: routingMap[highestTier]
  };
}

if (process.argv[1]?.endsWith("diff-reviewer.ts")) {
  const report = analyzeDiffAndTier();
  console.log("🔍 Diff & Consequence Review Orchestrator (Phase 3):");
  console.log(`  Changed Files (${report.changedFiles.length}):`, report.changedFiles.join(", ") || "None (Clean working tree)");
  console.log(`  Impacted Features (${report.impactedFeatures.length}):`);
  for (const feat of report.impactedFeatures) {
    console.log(`    - [${feat.tier}] ${feat.name}: ${feat.riskReason}`);
  }
  console.log(`  🎯 Recommended Tier: ${report.recommendedTier}`);
  console.log(`  🚦 Decision: ${report.routingDecision}`);
}
