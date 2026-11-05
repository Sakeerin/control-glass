# Verification contract and migration

`control-glass verify` and `control_glass_verify_gates` execute the same seven-stage pipeline. The library returns evidence instead of terminating its host process. The CLI sets a failing exit status when evidence is unsuccessful, and MCP returns `isError: true`.

## Required checks fail closed

Missing executables, invalid configuration, unavailable diff information, failed commands, and required checks without commands prevent overall success. A skipped check is not a pass. Evidence records each executed command, output, duration, and status, together with the source digest, Git HEAD, Node version, and Control Glass version.

Node projects use their existing `npm test` script. TypeScript projects with `tsconfig.json` use the installed TypeScript compiler. Python uses `mypy` and `pytest`; Go uses `go vet` and `go test`; PHP uses the project's PHPStan and PHPUnit executables. Declare and install these tools in the consumer project.

Override command selection explicitly with `control-glass.config.json`:

```json
{
  "staticCheckCommands": ["npm run typecheck"],
  "testCommands": ["npm test"],
  "timeoutMs": 120000
}
```

Commands execute with the project's privileges. Keep this configuration under review. Do not point the test command back at `verify`, which would recurse. Empty command lists leave the required gate skipped and unsuccessful.

## Evidence input digest

`provenance.sourceTreeHash` uses a separate inventory that includes every regular workspace file, regardless of extension. It covers workflows and actions, YAML/TOML/INI/CFG/XML configuration, native manifests and lock files, policy and skill documents, executable scripts, extensionless files, and binary assets. Untracked and Git-ignored input files are included, such as local `.env` files.

The following directory names are excluded at every depth:

| Category | Excluded directories |
| :--- | :--- |
| Git and generated verification artifacts | `.git`, `.control-glass` |
| Dependencies and environments | `node_modules`, `vendor`, `.venv`, `venv` |
| Build output and caches | `dist`, `coverage`, `.next`, `.nuxt`, `.cache`, `__pycache__`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `.tox` |

The `.control-glass/tdd-lock.json` input is included explicitly. Git's `.git` pointer file used by worktrees is excluded along with Git directories. Generated evidence, dependency graphs, and benchmark reports remain outside the digest, so repeated verification stays stable.

The v2 digest sorts normalized relative paths and combines each path with the SHA-256 of that file's raw bytes under the `control-glass-provenance-v2` domain tag. Per-file digests prevent embedded binary separators from making one file indistinguishable from several file records. Adding, deleting, or renaming an included file changes the digest, as does editing its contents. Absolute checkout locations do not affect it; byte differences, including line endings, do.

Verification compares the input digest before and after running its checks. Changes to any included input block successful evidence with `SOURCE_CHANGED_DURING_VERIFICATION`. Put generated command output in an excluded output or cache directory. Unreadable inputs and symlinks within the included scope fail provenance instead of being silently omitted; excluded dependency and output links remain outside that scope.

The broader inventory and v2 record format change existing digest values. Generate fresh evidence after upgrading. Source analysis and safety scanning retain their existing file-selection rules.

## Review the entire change

Use an explicit PR base and head:

```sh
control-glass verify --base origin/main --head HEAD
control-glass diff --base origin/main
```

CI sets `CONTROL_GLASS_BASE_REF` and `CONTROL_GLASS_HEAD_REF`. The classifier compares the merge base with the requested head and includes both paths of a rename. Local checks without an explicit range inspect staged, unstaged, and untracked changes. They do not infer a PR from the most recent commit.

Unavailable Git data blocks approval. Unregistered backend files receive at least Tier 1 even when changed alongside registered Tier 0 UI files. Critical contracts, verification code, policies, locks, and workflow changes require Tier 2. A Tier 0 classification alone does not authorize a merge; the full verification engine must supply successful gate results.

## Freeze tests explicitly

During an approved Phase 1, write requirements and failing tests, then run:

```sh
npm run lock:tests
```

For an installed consumer CLI, use:

```sh
control-glass lock --phase=spec-freeze
```

The explicit freeze writes a manifest and a local receipt in Git metadata, bound to the current HEAD and manifest digest. Re-running `init` preserves an existing manifest. MCP does not expose a tool that rewrites test locks.

Verification compares the manifest against the trusted baseline. Locally, a matching Phase 1 receipt authorizes the pending specification change. CI ignores local receipts. If a PR intentionally changes the lock, a trusted maintainer must configure the repository variable `CONTROL_GLASS_APPROVED_LOCK_SHA256` with the SHA-256 digest of the exact approved manifest, with CRLF normalized to LF. The generated workflow passes this variable into verification. `CONTROL_GLASS_LOCK_BASE_REF` can select a distinct trusted lock baseline.

A hash alone does not establish who approved a specification. Protect the base branch, the workflow, and the repository variable. The local receipt supports the development workflow; the CI baseline and externally controlled digest establish the approval boundary.

## Preserve consumer configuration

Vendor sync updates marked Control Glass sections while preserving other instructions. MCP configuration is merged without removing other servers or replacing an existing custom Control Glass server. Packaged skills are copied to `skills/` and `.agent/skills/`; modified skill files are preserved and reported as conflicts.

Hook installation saves an existing hook as `pre-commit.control-glass-original` and chains it. It refuses to replace an unmanaged workflow. The generated CI installs required language tools and invokes the installed CLI for consumers; it does not assume consumer `verify` or `bench` npm scripts exist. PHP projects must declare PHPStan and PHPUnit in Composer. Review the generated workflow for project-specific dependency setup.

The pre-commit hook rejects tracked unstaged changes so verification sees the staged content. Configure the CI job as a required branch check to enforce the merge policy remotely.

## Source analysis boundaries

The source, safety, and TDD gates share one file inventory, including root files and `cmd/`, while excluding dependencies, build output, and verification artifacts. TypeScript analysis resolves aliases, extensionless modules, TSX, reexports, and import-equals declarations.

Comment removal preserves token separation and newlines. Non-TypeScript scanning tracks strings, Python triple-quoted text, Go raw strings, and PHP heredoc text. It is a lexical guardrail; required native static checks and tests remain responsible for language correctness. Review autofix diffs before committing.
