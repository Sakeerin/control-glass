import fs from "node:fs";
import path from "node:path";

const PRE_COMMIT_HOOK_SCRIPT = `#!/bin/sh
echo "🔬 [Control Glass] Running pre-commit verification gate..."
npm run verify
`;

const GITHUB_ACTIONS_WORKFLOW = `name: Control Glass Verification Gate

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  control-glass-verify:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Run Control Glass 6-Gate Pipeline
        run: npm run verify

      - name: Run Deslop & AST Dependency Mapper
        run: |
          npx tsx src/harness/deslop.ts
          npx tsx src/harness/auto-mapper.ts
          npx tsx src/harness/bench.ts
`;

export function installGitAndCiHooks(rootDir: string = process.cwd()): {
  readonly installedPaths: readonly string[];
} {
  const installed: string[] = [];

  const gitHooksDir = path.join(rootDir, ".git", "hooks");
  if (fs.existsSync(path.join(rootDir, ".git"))) {
    fs.mkdirSync(gitHooksDir, { recursive: true });
    const preCommitPath = path.join(gitHooksDir, "pre-commit");
    fs.writeFileSync(preCommitPath, PRE_COMMIT_HOOK_SCRIPT, { encoding: "utf8", mode: 0o755 });
    installed.push(".git/hooks/pre-commit");
  }

  const workflowDir = path.join(rootDir, ".github", "workflows");
  fs.mkdirSync(workflowDir, { recursive: true });
  const workflowPath = path.join(workflowDir, "control-glass.yml");
  fs.writeFileSync(workflowPath, GITHUB_ACTIONS_WORKFLOW, "utf8");
  installed.push(".github/workflows/control-glass.yml");

  return { installedPaths: installed };
}

if (process.argv[1]?.endsWith("hook-installer.ts")) {
  const res = installGitAndCiHooks();
  console.log(`🔒 Installed Zero-Bypass Hooks & CI Gates: ${res.installedPaths.join(", ")}`);
}
