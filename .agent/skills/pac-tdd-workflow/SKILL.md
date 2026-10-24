---
name: pac-tdd-workflow
description: Senior Engineer Playbook (PAC) for Phase 1 Requirement Freezing, Contract Design, Red-Phase TDD Locking, and Single Paved Path Implementation.
---

# PAC Playbook: Contract-First & Locked TDD Workflow

Use this skill when building a new feature or modifying domain logic to prevent **Closed-Loop Testing Errors** and **Interface Contract Mismatches**.

## Step 1: Requirement Freeze & Feature Map Lookup
1. Read `feature-map.json` to identify existing boundaries, contracts, and risk tiers (`Tier 0 | Tier 1 | Tier 2`).
2. Define explicit input/output contracts in `src/core/contracts.ts` using **Branded Types** (`Brand<T, Name>`) and `Result<T, E>`.

## Step 2: Red-Phase Test Authoring & Cryptographic Lock
1. Write failing unit/contract tests in `tests/<feature>.spec.ts` that verify both nominal paths and edge cases (e.g., unit mismatches, duplicate idempotency keys, empty inputs).
2. Run `npm run lock:tests` to record SHA-256 hashes of the contracts and tests in `.control-glass/tdd-lock.json`.

## Step 3: Green-Phase Implementation (Single Paved Path)
1. Implement the feature in `src/features/<domain>/` or `src/ui/` without touching the locked test files.
2. Follow Dune rules: **zero comments**, **no `any`**, **no `console.log`**, and **strict boundary imports**.
3. Register new entrypoints and selectors in `feature-map.json`.

## Step 4: Control Glass Verification
1. Run `npm run verify` to confirm Typecheck, Dune AST Linter, Safety Gate, TDD Lock, and Vitest all pass.
