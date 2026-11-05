import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { DiffOptions, DiffReviewReport } from "../src/harness/diff-reviewer.js";
import { repository, write, git, commit } from "./review-fixtures.contract.js";

function rootForms(root: string): readonly string[] {
  return [".", "./", root, root + path.sep, root + path.sep + "." + path.sep];
}

function reportsFrom(root: string, targets: readonly string[], environment: Readonly<Record<string, string>> = {}, options: DiffOptions = {}): DiffReviewReport[] {
  const sourceUrl = pathToFileURL(path.resolve("src/harness/diff-reviewer.ts")).href;
  const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
  const script = `import { analyzeDiffAndTier } from ${JSON.stringify(sourceUrl)};
process.stdout.write(JSON.stringify(${JSON.stringify(targets)}.map(root => analyzeDiffAndTier(root, undefined, ${JSON.stringify(options)}))));`;
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "true" };
  delete env["CONTROL_GLASS_BASE_REF"];
  delete env["CONTROL_GLASS_HEAD_REF"];
  Object.assign(env, environment);
  return JSON.parse(execFileSync(process.execPath, ["--import", loader, "--input-type=module", "--eval", script], {
    cwd: root, env, encoding: "utf8", timeout: 15_000
  })) as DiffReviewReport[];
}

function history(): { root: string; baseRef: string; headRef: string } {
  const root = repository({ "src/core/value.ts": "export const value = 1;\n", "src/ui/Card.tsx": "export const card = 1;\n" });
  commit(root, "baseline");
  const baseRef = git(root, "rev-parse", "HEAD");
  write(root, "src/core/value.ts", "export const value = 2;\n");
  commit(root, "critical change");
  write(root, "src/ui/Card.tsx", "export const card = 2;\n");
  commit(root, "presentation change");
  const headRef = git(root, "rev-parse", "HEAD");
  write(root, "later.txt", "outside requested range\n");
  commit(root, "later change");
  return { root, baseRef, headRef };
}

describe("CI diff root paths", () => {
  it("uses the entire CI base and head range for equivalent current-directory paths", () => {
    const { root, baseRef, headRef } = history();
    const reports = reportsFrom(root, rootForms(root), { CONTROL_GLASS_BASE_REF: baseRef, CONTROL_GLASS_HEAD_REF: headRef });
    for (const report of reports) {
      expect(report.status).toBe("known");
      expect([...report.changedFiles].sort()).toEqual(["src/core/value.ts", "src/ui/Card.tsx"]);
      expect(report.recommendedTier).toBe("Tier 2");
      expect(report.errors).toEqual([]);
    }
  });

  it("blocks equivalent current-directory paths when CI has no base reference", () => {
    const root = repository({ "baseline.txt": "baseline\n" });
    commit(root, "baseline");
    for (const report of reportsFrom(root, rootForms(root))) {
      expect(report.status).toBe("unavailable");
      expect(report.errors).toContain("CI_REQUIRES_EXPLICIT_BASE_REF");
      expect(report.recommendedTier).toBe("Tier 2");
      expect(report.routingDecision).toContain("REVIEW BLOCKED");
    }
  });

  it("blocks equivalent current-directory paths when the CI base cannot be resolved", () => {
    const root = repository({ "baseline.txt": "baseline\n" });
    commit(root, "baseline");
    for (const report of reportsFrom(root, rootForms(root), { CONTROL_GLASS_BASE_REF: "missing-ci-base" })) {
      expect(report.status).toBe("unavailable");
      expect(report.errors).toContain("DIFF_BASE_UNAVAILABLE");
      expect(report.recommendedTier).toBe("Tier 2");
    }
  });

  it("lets explicit base and head references override CI values for every equivalent path", () => {
    const { root, baseRef, headRef } = history();
    for (const report of reportsFrom(root, rootForms(root), { CONTROL_GLASS_BASE_REF: "missing-base", CONTROL_GLASS_HEAD_REF: "missing-head" }, { baseRef, headRef })) {
      expect(report.status).toBe("known");
      expect([...report.changedFiles].sort()).toEqual(["src/core/value.ts", "src/ui/Card.tsx"]);
      expect(report.recommendedTier).toBe("Tier 2");
    }
  });

  it("keeps another project's diff isolated from the current project's CI references", () => {
    const current = repository({ "baseline.txt": "current\n" });
    const other = repository({ "src/features/value.ts": "export const value = 1;\n" });
    commit(current, "current baseline");
    commit(other, "other baseline");
    write(other, "src/features/value.ts", "export const value = 2;\n");
    const targets = [other, path.relative(current, other)];
    for (const report of reportsFrom(current, targets, { CONTROL_GLASS_BASE_REF: "missing-base", CONTROL_GLASS_HEAD_REF: "missing-head" })) {
      expect(report.status).toBe("known");
      expect(report.changedFiles).toEqual(["src/features/value.ts"]);
      expect(report.recommendedTier).toBe("Tier 1");
      expect(report.errors).toEqual([]);
    }
  });
});
