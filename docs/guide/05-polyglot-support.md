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
| **SHA-256 TDD Lock (`npx control-glass lock`)** | `*.spec.ts`, `*.test.ts`, `contracts.ts` | `test_*.py`, `*_test.py`, `contracts.py` | `*_test.go`, `contracts.go` | `*Test.php`, `Contracts.php` |

---

## 3. Level 1 Branded Contract Examples by Language

### 🐍 Python (`src/core/contracts.py`)
```python
from dataclasses import dataclass
from typing import Generic, NewType, TypeVar, Union

T = TypeVar("T")
E = TypeVar("E")

NewtonSeconds = NewType("NewtonSeconds", float)
Satang = NewType("Satang", int)
```

### 🐹 Go (`src/core/contracts.go`)
```go
package core

import "errors"

type NewtonSeconds float64
type Satang int64

var ErrInvalidSatangInteger = errors.New("INVALID_SATANG_INTEGER")

func CreateSatang(raw int64) (Satang, error) {
	if raw < 0 {
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
    private function __construct(public int $value) {}

    public static function fromInt(int $raw): self
    {
        if ($raw < 0) {
            throw new InvalidArgumentException('INVALID_SATANG_INTEGER');
        }
        return new self($raw);
    }
}
```
