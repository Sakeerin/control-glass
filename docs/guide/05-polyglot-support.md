# 05 — Polyglot Support (TypeScript, Python, Go, and PHP)

`control-glass` v3.0 is a **Universal Polyglot Agentic Harness**. Whether your backend or full-stack project is written in **TypeScript/Node.js**, **Python**, **Go (Golang)**, or **PHP (Laravel/Symfony)**, `control-glass` enforces the exact same **Michelin Kitchen** rules, **Dune Linter**, **Deslop Engine**, **Auto-Dependency Mapper**, and **SHA-256 TDD Lock**.

---

## 1. Bootstrapping Any Language (`npx control-glass init --lang`)

You can initialize `control-glass` with starter **Level 1 Branded Contract Templates** for your language of choice:

```bash
# Initialize for Python (creates src/core/contracts.py)
npx control-glass init --lang python

# Initialize for Go (creates src/core/contracts.go)
npx control-glass init --lang go

# Initialize for PHP (creates src/Core/Contracts.php)
npx control-glass init --lang php

# Initialize all languages at once
npx control-glass init --lang all
```

Check which languages `control-glass` automatically detects in your project at any time:
```bash
npx control-glass languages
```

---

## 2. How the 7 Gates Work Across Languages

| Control Layer | 🟦 TypeScript (`.ts`) | 🐍 Python (`.py`) | 🐹 Go (`.go`) | 🐘 PHP (`.php`) |
| :--- | :--- | :--- | :--- | :--- |
| **Level 1: Branded Contracts** | `Brand<T, Name>` + `Result<T, E>` | `typing.NewType` + `@dataclass(frozen=True) Ok/Err` | Distinct Types (`type Satang int64`) + `(T, error)` | `final readonly class` Value Objects + `declare(strict_types=1);` |
| **Dune Rule: `DUNE_NO_COMMENTS`** | Blocks `//`, `/* */` | Blocks `#`, `"""` *(preserves `#!`)* | Blocks `//`, `/* */` *(preserves `//go:build`)* | Blocks `//`, `#`, `/* */` *(preserves `#[Attribute]`)* |
| **Dune Rule: `DUNE_NO_LINTER_SUPPRESSION`** | Blocks `@ts-ignore`, `eslint-disable` | Blocks `# type: ignore`, `# noqa` | Blocks `//nolint` | Blocks `@phpstan-ignore`, `@psalm-suppress` |
| **Dune Rule: `DUNE_NO_EXPLICIT_ANY`** | Blocks `: any`, `as unknown` | Blocks `typing.Any` | Blocks `interface{}`, `any` | Blocks `mixed` & enforces `declare(strict_types=1);` |
| **Dune Rule: `DUNE_NO_CONSOLE_IN_DOMAIN`** | Blocks `console.*` | Blocks `print(...)` | Blocks `fmt.Print*` | Blocks `var_dump`, `dd`, `print_r`, `echo` |
| **Dune Rule: `DUNE_BOUNDARY_VIOLATION`** | `import` / `require()` | `import x` / `from x import y` | `import "..."` | `use Namespace\...;` / `require_once` |
| **Deslop Engine (`npx control-glass deslop --fix`)** | Strips comments + flags `catch {}` & `debugger` | Strips `#` + flags `except: pass` & `breakpoint()` | Strips `//` + flags `_ = err` swallowed errors | Strips `//`, `#` + flags `catch (...) {}` & `xdebug_break()` |
| **SHA-256 TDD Lock (`npx control-glass lock --phase=spec-freeze`)** | `*.spec.ts`, `*.test.ts`, `contracts.ts` | `test_*.py`, `*_test.py`, `contracts.py` | `*_test.go`, `contracts.go` | `*Test.php`, `Contracts.php` |

---

## 3. Level 1 Branded Contract Examples by Language

The numeric starter contracts follow the existing TypeScript specification:

| Contract | Accepted values | Invalid-value error |
| :--- | :--- | :--- |
| `NewtonSeconds` | Finite numbers greater than or equal to zero | `INVALID_NEWTON_SECONDS` |
| `PoundForceSeconds` | Finite numbers greater than or equal to zero | `INVALID_POUND_FORCE_SECONDS` |
| `Satang` | Signed integers from -9,007,199,254,740,991 through 9,007,199,254,740,991, inclusive | `INVALID_SATANG_INTEGER` |

Both impulse contracts allow zero and positive fractions. They reject negative numbers, `NaN`, and either infinity. Every language provides a validating factory for each of these three numeric contracts.

`Satang` permits negative amounts, matching TypeScript. Python requires an `int` and explicitly rejects booleans; Go requires an `int64`; PHP requires an `int` with strict caller types. Python and PHP reject floating-point inputs, including `1.0`, for this integer factory. JavaScript represents integers as `number` values and validates their integrality and safe range.

Python returns `Err`, Go returns a non-nil error, and PHP throws `InvalidArgumentException` for invalid numeric values. Go rejects incompatible input types at compile time, while PHP raises `TypeError` under strict caller types. PHP callers must also declare `strict_types=1`: the caller's setting controls scalar coercion ([PHP type declarations](https://www.php.net/manual/en/language.types.declarations.php)).

### 🐍 Python (`src/core/contracts.py`)
```python
from dataclasses import dataclass
from typing import Generic, NewType, TypeVar, Union

T = TypeVar("T")
E = TypeVar("E")

NewtonSeconds = NewType("NewtonSeconds", float)
PoundForceSeconds = NewType("PoundForceSeconds", float)
Satang = NewType("Satang", int)
```

The generated `create_newton_seconds` and `create_pound_force_seconds` factories check finiteness and reject booleans, coercible strings, and integers that overflow a floating-point value. `create_satang` checks the signed safe-integer range without coercing its input.

### 🐹 Go (`src/core/contracts.go`)
```go
package core

import "errors"

type NewtonSeconds float64
type Satang int64

var ErrInvalidSatangInteger = errors.New("INVALID_SATANG_INTEGER")

const maxSafeSatang int64 = 9007199254740991

func CreateSatang(raw int64) (Satang, error) {
	if raw < -maxSafeSatang || raw > maxSafeSatang {
		return 0, ErrInvalidSatangInteger
	}
	return Satang(raw), nil
}
```

### 🐘 PHP (`src/Core/Contracts.php`)
```php
<?php
declare(strict_types=1);

namespace ControlGlass\Core;

use InvalidArgumentException;

final readonly class Satang
{
    private const MAX_SAFE_INTEGER = 9007199254740991;

    private function __construct(public int $value) {}

    public static function fromInt(int $raw): self
    {
        if ($raw < -self::MAX_SAFE_INTEGER || $raw > self::MAX_SAFE_INTEGER) {
            throw new InvalidArgumentException('INVALID_SATANG_INTEGER');
        }
        return new self($raw);
    }
}
```

`NewtonSeconds::fromFloat` and `PoundForceSeconds::fromFloat` additionally reject non-finite values. The templates require PHP 8.2 or later; the shared `Satang` range requires a 64-bit PHP runtime.

## 4. Verification and existing projects

The repository's `npm run verify` executes the generated contracts with actual Python, Go, and PHP runtimes. Contributors need Python 3.10+, Go 1.22+, and 64-bit PHP 8.2+ on `PATH`, in addition to the Node development dependencies. Add portable runtime directories to `PATH` before verification. Missing runtimes fail the tests instead of skipping their checks.

Initialization preserves existing contract files. These changes apply to newly generated templates; existing consumer projects should review and port the validation changes, then freeze their updated contracts during their own approved Phase 1.
