---
name: setup-control-glass
description: Initializes Control Glass in any existing TypeScript/Node.js repository (creates feature-map.json, AGENTS.md, and .control-glass/tdd-lock.json).
---

# Setup Control Glass (`setup-control-glass`)

Use this skill when a developer installs the `control-glass` plugin into a new or existing project and wants to bootstrap the Michelin Kitchen harness.

## Setup Steps
1. Run the initializer CLI in the project root:
   ```bash
   npx control-glass init
   ```
2. Inspect the generated `feature-map.json` and customize `architecturalBoundaries` and `features` to match the repository's directory layout.
3. Add the Single Paved Path scripts to `package.json`:
   ```json
   {
     "scripts": {
       "verify": "control-glass verify",
       "lint:dune": "control-glass lint",
       "guard:safety": "control-glass safety",
       "guard:tdd": "control-glass tdd-check",
       "lock:tests": "control-glass lock",
       "review:diff": "control-glass diff"
     }
   }
   ```
4. Run `npx control-glass verify` to establish baseline empirical verification.
