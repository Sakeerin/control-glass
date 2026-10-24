---
name: arena
description: Contract-Driven Design Competition (upgrades pstack /arena & /architect). Compares 2-3 competing architectures and selects the winner using an objective Continuum of Control scorecard.
---

# Contract-Driven Architecture Arena (`/arena`)

Use this skill when designing a new subsystem or refactoring complex domain logic. Instead of subjective debate, pit **2 to 3 competing designs** against each other and score them mathematically on the **Continuum of Control**.

## Arena Procedure
1. **Generate Competing Proposals (Design A vs Design B):**
   - Define the exact TypeScript signatures (`Brand<T>`, `Result<T, E>`) and file locations for each candidate design.
2. **Score Each Design on the Control Glass Rubric (0–100 pts):**
   - **Level 1 Compile-Time Impossibility (40 pts):** Does the type signature make invalid states and unit mismatches uncompilable?
   - **Boundary Isolation & Tier Impact (30 pts):** Does it stay within a single boundary (`feature-map.json`) and minimize `Tier 2` blast radius?
   - **Zero-Indirection Simplicity (20 pts):** Does it follow the Single Paved Path without speculative abstractions or wrapper classes?
   - **Empirical Testability (10 pts):** Can it be verified deterministically in `< 10ms` with zero mocks/I/O?
3. **Declare the Winner & Freeze Spec:**
   - Select the highest-scoring design, write its contracts into `src/core/contracts.ts`, lock the tests (`npx control-glass lock`), and proceed to implementation.
