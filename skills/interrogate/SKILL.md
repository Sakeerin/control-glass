---
name: interrogate
description: Adversarial Red-Team Code Review skill. Interrogates changes against the 4 Historical Disaster Safeguards (Mars Orbiter, Knight Capital, Google Cloud, CrowdStrike) and Dependency Graph blast radius.
---

# Adversarial Red-Team Review (`/interrogate`)

Use this skill (or invoke the `interrogator` subagent) before shipping any `Tier 1` or `Tier 2` change.

## Step 1: Compute Exact Blast Radius
1. Run the AST Dependency Mapper and Diff Classifier:
   ```bash
   npx control-glass map
   npx control-glass diff
   ```
2. Inspect `.control-glass/dependency-graph.json` (`importedBy` array) for every modified file to see all downstream consumers.

## Step 2: The 4 Historical Disaster Interrogation Matrix
Challenge every modified function against these four failure modes:

1. **Mars Climate Orbiter Check (Unit & Contract Ambiguity):**
   - Are raw `number` or `string` primitives passed across module boundaries?
   - *Mandate:* Reject unless wrapped in a validated `Brand<T, Name>` constructor (`NewtonSeconds`, `Satang`, `PercentageInt`).
2. **Knight Capital Check (State Replay & Idempotency):**
   - What happens if this function or message handler is called twice with the same payload?
   - *Mandate:* Require explicit `IdempotencyKey` tracking or pure idempotent transitions.
3. **Google Cloud 2025 Check (Null / Empty / Unhandled Crash):**
   - Can an empty string, `NaN`, `Infinity`, or out-of-bounds array index cause an unhandled exception?
   - *Mandate:* All fallible operations must return `Result<T, E>` (`ok` / `err`) validated by Zod.
4. **CrowdStrike Check (Unstaged Blast Radius):**
   - If this touches `Tier 2` logic, is it gated behind a Canary rollout (`1% -> 10% -> 100%`)?

## Step 3: Verdict
Output a structured **Interrogation Verdict (`APPROVED` | `REJECTED_WITH_COUNTEREXAMPLE`)** listing exact file/line vulnerabilities found.
