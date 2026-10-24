---
name: diff-consequence-reviewer
description: Sub-agent skill for Phase 3 Orchestration—analyzing git diffs against feature-map.json, evaluating blast radius, and routing PRs to Tier 0, Tier 1, or Tier 2.
---

# Diff & Consequence Reviewer Skill (Bottleneck Relief)

Use this skill (or delegate to a `research` subagent with this skill) to reduce human Code Review overload by 400%.

## Review Procedure
1. Run the automated Diff & Tier classifier:
   ```bash
   npx control-glass diff
   ```
2. Cross-reference changed files with `feature-map.json`:
   - **Tier 0 (Auto-Approve):** Changes isolated to low-risk UI formatting (`src/ui/`) with 100% Control Glass pass and zero contract changes.
   - **Tier 1 (Task Owner Review):** Standard feature logic updates with intact TDD locks.
   - **Tier 2 (Senior/Domain Expert Review):** Any modification to `src/core/contracts.ts`, `src/harness/`, financial settlement, or orbital physics calculations.
3. Produce a concise **Consequence Summary** highlighting:
   - Blast radius & affected features
   - Contract & TDD Lock integrity status
   - Assigned Review Tier & recommended deployment strategy (`1% -> 10% -> 100%` Canary rollout for Tier 2).
