---
name: control-glass-mode
description: Primary front-door router skill (inspired by pstack /poteto-mode). Matches engineering tasks to Michelin Kitchen playbooks, copies verbatim checklists, and enforces 6-gate Control Glass verification.
---

# Route Work Through `/control-glass-mode`

`/control-glass-mode` is the primary front door and orchestrator for the **Control Glass** plugin. Instead of micromanaging individual skills, invoke `/control-glass-mode` with your goal and completion criteria.

## 1. The Router Pattern (How to Execute)

Whenever `/control-glass-mode` is invoked:

1. **Classify the Request:** Match the user's goal to one of the Playbooks in `skills/control-glass-mode/playbooks/`:
   - **New Feature / Contract Addition** -> `skills/control-glass-mode/playbooks/feature.md`
   - **Bug Report / Incident / Regression** -> `skills/control-glass-mode/playbooks/bug.md`
   - **Tech Debt / Anti-Pattern / AST Rule Authoring** -> `skills/control-glass-mode/playbooks/gardener.md`
   - **PR Triage / Blast Radius / Tiered Review** -> `skills/control-glass-mode/playbooks/review.md`
2. **Copy Verbatim Checklist:** Read the matched playbook file and copy its step-by-step checklist **verbatim** into your active tracking plan before editing any files. Do not skip investigation or lock steps.
3. **Orchestrate Specialized Skills:** Invoke companion skills (`pac-tdd-workflow`, `control-glass-verify`, `dune-gardener`, `diff-consequence-reviewer`) at the exact stages prescribed by the playbook.
4. **Empirical Proof Gate:** Never claim completion until `npx control-glass verify` (or `npm run verify`) exits with code `0` and produces `.control-glass/evidence-latest.json`.
