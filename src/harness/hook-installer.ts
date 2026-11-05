import fs from "node:fs";
import path from "node:path";
import { readGit, isDirectExecution } from "./runtime.js";

const PRE_COMMIT_HOOK_SCRIPT = "#!/bin/sh\nset -eu\nCONTROL_GLASS_MANAGED_HOOK=1\nhook_dir=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\nif [ -x \"$hook_dir/pre-commit.control-glass-original\" ]; then \"$hook_dir/pre-commit.control-glass-original\" \"$@\"; fi\nif ! git diff --quiet --; then echo \"Control Glass requires tracked working files to match the staged snapshot.\" >&2; exit 1; fi\nif [ -f src/harness/control-glass.ts ]; then npm run verify; else npx --no-install control-glass verify; fi\n";
const GITHUB_ACTIONS_WORKFLOW = "# control-glass-managed-workflow\nname: Control Glass Verification Gate\non:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\npermissions:\n  contents: read\nenv:\n  CONTROL_GLASS_BASE_REF: ${{ github.event.pull_request.base.sha || github.event.before }}\n  CONTROL_GLASS_HEAD_REF: ${{ github.event.pull_request.head.sha || github.sha }}\n  CONTROL_GLASS_APPROVED_LOCK_SHA256: ${{ vars.CONTROL_GLASS_APPROVED_LOCK_SHA256 }}\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n          persist-credentials: false\n      - uses: actions/setup-node@v4\n        with:\n          node-version: \"22\"\n      - name: Install Node dependencies\n        if: hashFiles('package-lock.json') != ''\n        run: npm ci\n      - name: Install consumer Node dependencies without a lock\n        if: hashFiles('package.json') != '' && hashFiles('package-lock.json') == ''\n        run: npm install\n      - name: Install standalone Control Glass for consumer projects\n        if: hashFiles('src/harness/control-glass.ts') == ''\n        run: |\n          npm install --prefix \"$RUNNER_TEMP/control-glass-cli\" --no-save --package-lock=false github:Sakeerin/control-glass\n          echo \"$RUNNER_TEMP/control-glass-cli/node_modules/.bin\" >> \"$GITHUB_PATH\"\n      - uses: actions/setup-python@v5\n        if: hashFiles('pyproject.toml', 'requirements.txt', 'mypy.ini') != ''\n        with:\n          python-version: \"3.12\"\n      - name: Install Python verification tools\n        if: hashFiles('pyproject.toml', 'requirements.txt', 'mypy.ini') != ''\n        run: |\n          python -m pip install mypy pytest\n          if [ -f requirements.txt ]; then python -m pip install -r requirements.txt; fi\n      - uses: actions/setup-go@v5\n        if: hashFiles('go.mod') != ''\n        with:\n          go-version-file: go.mod\n      - name: Install PHP dependencies and require declared verification tools\n        if: hashFiles('composer.json') != ''\n        run: |\n          php --version\n          composer install --no-interaction --prefer-dist\n          test -f vendor/bin/phpstan\n          test -f vendor/bin/phpunit\n      - name: Verify\n        run: |\n          if [ -f src/harness/control-glass.ts ]; then npm run verify; else control-glass verify; fi\n";

export function installGitAndCiHooks(rootDir: string = process.cwd()): { readonly installedPaths: readonly string[]; readonly preservedPaths: readonly string[]; readonly conflicts: readonly string[] } {
  const installed: string[] = [];
  const preserved: string[] = [];
  const conflicts: string[] = [];
  const hooks = readGit(rootDir, ["rev-parse", "--git-path", "hooks"]);
  if (hooks.ok) {
    const hooksDirectory = path.resolve(rootDir, hooks.value.trim());
    fs.mkdirSync(hooksDirectory, { recursive: true });
    const hookPath = path.join(hooksDirectory, "pre-commit");
    const backupPath = path.join(hooksDirectory, "pre-commit.control-glass-original");
    const existing = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, "utf8") : "";
    if (existing && !existing.includes("CONTROL_GLASS_MANAGED_HOOK=1")) {
      if (fs.existsSync(backupPath)) conflicts.push(hookPath);
      else { fs.copyFileSync(hookPath, backupPath); preserved.push(backupPath); }
    }
    if (!conflicts.includes(hookPath)) {
      fs.writeFileSync(hookPath, PRE_COMMIT_HOOK_SCRIPT, { encoding: "utf8", mode: 0o755 });
      installed.push(hookPath);
    }
  }
  const workflowPath = path.join(rootDir, ".github/workflows/control-glass.yml");
  if (fs.existsSync(workflowPath) && !fs.readFileSync(workflowPath, "utf8").includes("# control-glass-managed-workflow")) conflicts.push(workflowPath);
  else {
    fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
    fs.writeFileSync(workflowPath, GITHUB_ACTIONS_WORKFLOW, "utf8");
    installed.push(".github/workflows/control-glass.yml");
  }
  return { installedPaths: installed, preservedPaths: preserved, conflicts };
}

if (isDirectExecution(import.meta.url)) {
  const report = installGitAndCiHooks();
  console.log(JSON.stringify(report, null, 2));
  if (report.conflicts.length > 0) process.exitCode = 1;
}
