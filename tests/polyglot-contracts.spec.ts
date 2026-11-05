import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createNewtonSeconds, createPoundForceSeconds, createSatang } from "../src/core/contracts.js";
import { initControlGlassProject } from "../src/harness/cli.js";
import { fixture, write } from "./review-fixtures.contract.js";

interface NumericCase { readonly label: string; readonly raw: number; readonly accepted: boolean; }
interface Observation { readonly id: string; readonly ok: boolean; readonly value: number | null; readonly error: string | null; }
type NumericContract = "newton" | "pound" | "satang";
type NativeLanguage = "python" | "go" | "php";

const impulses: readonly NumericCase[] = [
  { label: "zero", raw: 0, accepted: true },
  { label: "fraction", raw: 0.125, accepted: true },
  { label: "maximum-finite", raw: Number.MAX_VALUE, accepted: true },
  { label: "negative", raw: -1, accepted: false },
  { label: "nan", raw: NaN, accepted: false },
  { label: "infinity", raw: Infinity, accepted: false },
  { label: "negative-infinity", raw: -Infinity, accepted: false }
];
const integerAmounts: readonly NumericCase[] = [
  { label: "zero", raw: 0, accepted: true },
  { label: "positive", raw: 25000, accepted: true },
  { label: "negative", raw: -25000, accepted: true },
  { label: "maximum-safe", raw: 9007199254740991, accepted: true },
  { label: "minimum-safe", raw: -9007199254740991, accepted: true },
  { label: "above-maximum", raw: 9007199254740992, accepted: false },
  { label: "below-minimum", raw: -9007199254740992, accepted: false }
];
const invalidAmounts: readonly NumericCase[] = [
  { label: "fraction", raw: 1.5, accepted: false },
  { label: "nan", raw: NaN, accepted: false },
  { label: "infinity", raw: Infinity, accepted: false },
  { label: "negative-infinity", raw: -Infinity, accepted: false }
];
const errors: Record<NumericContract, string> = { newton: "INVALID_NEWTON_SECONDS", pound: "INVALID_POUND_FORCE_SECONDS", satang: "INVALID_SATANG_INTEGER" };
const numericCases = [
  ...impulses.map(value => ({ contract: "newton" as const, ...value })),
  ...impulses.map(value => ({ contract: "pound" as const, ...value })),
  ...integerAmounts.map(value => ({ contract: "satang" as const, ...value }))
];

function expectedNumbers(): Observation[] {
  return numericCases.map(value => ({ id: value.contract + ":" + value.label, ok: value.accepted, value: value.accepted ? value.raw : null, error: value.accepted ? null : errors[value.contract] }));
}

function nativeProject(language: NativeLanguage): string {
  const root = fixture();
  initControlGlassProject(root, language);
  return root;
}

function literal(value: number, language: NativeLanguage): string {
  if (Number.isNaN(value)) return { python: 'float("nan")', go: "math.NaN()", php: "NAN" }[language];
  if (value === Infinity) return { python: 'float("inf")', go: "math.Inf(1)", php: "INF" }[language];
  if (value === -Infinity) return { python: '-float("inf")', go: "math.Inf(-1)", php: "-INF" }[language];
  return String(value);
}

function runNative(command: string, args: readonly string[], root: string): Observation[] {
  return JSON.parse(execFileSync(command, [...args], { cwd: root, encoding: "utf8", timeout: 120_000, env: { ...process.env, PYTHONPATH: root, GOWORK: "off", GOTOOLCHAIN: "local", GOPROXY: "off", GOSUMDB: "off" } })) as Observation[];
}

const pythonRecorder = `import json
from src.core.contracts import create_newton_seconds, create_pound_force_seconds, create_satang

def record(identifier, result):
    return {"id": identifier, "ok": result.ok, "value": result.value if result.ok else None, "error": None if result.ok else result.error}
`;

const phpRecorder = `<?php
declare(strict_types=1);
require __DIR__ . '/src/Core/Contracts.php';
use ControlGlass\\Core\\NewtonSeconds;
use ControlGlass\\Core\\PoundForceSeconds;
use ControlGlass\\Core\\Satang;

function record(string $id, callable $factory): array {
    try {
        $value = $factory();
        return ['id' => $id, 'ok' => true, 'value' => $value->value, 'error' => null];
    } catch (InvalidArgumentException $error) {
        return ['id' => $id, 'ok' => false, 'value' => null, 'error' => $error->getMessage()];
    } catch (TypeError $error) {
        return ['id' => $id, 'ok' => false, 'value' => null, 'error' => 'TYPE_ERROR'];
    }
}
`;

describe("Numeric contract parity across generated languages", () => {
  it("keeps the TypeScript impulse specification finite and nonnegative", () => {
    for (const create of [createNewtonSeconds, createPoundForceSeconds]) {
      for (const value of impulses) {
        const result = create(value.raw);
        expect(result.ok).toBe(value.accepted);
        if (result.ok) expect(result.value).toBe(value.raw);
      }
    }
  });

  it("keeps the TypeScript Satang specification signed, integral, and within the safe range", () => {
    for (const value of [...integerAmounts, ...invalidAmounts]) {
      const result = createSatang(value.raw);
      expect(result.ok).toBe(value.accepted);
      if (result.ok) expect(result.value).toBe(value.raw);
      else expect(result.error).toBe("INVALID_SATANG_INTEGER");
    }
  });

  it("executes the generated Python factories against the shared numeric specification", () => {
    const root = nativeProject("python");
    const factories = { newton: "create_newton_seconds", pound: "create_pound_force_seconds", satang: "create_satang" };
    const calls = numericCases.map(value => `record(${JSON.stringify(value.contract + ":" + value.label)}, ${factories[value.contract]}(${literal(value.raw, "python")}))`);
    write(root, "probe.py", pythonRecorder + `\nprint(json.dumps([${calls.join(",\n")}], allow_nan=False))\n`);
    expect(runNative("python", ["probe.py"], root)).toEqual(expectedNumbers());
  });

  it("rejects Python booleans, coercible values, fractional money, and overflowing integers", () => {
    const root = nativeProject("python");
    const invalidImpulses = ["True", "False", '"1"', "None", "[]", "{}", "10 ** 400"];
    const invalidSatang = [...invalidImpulses, "1.0", "1.5", 'float("nan")', 'float("inf")'];
    const calls = [
      ...["create_newton_seconds", "create_pound_force_seconds"].flatMap(factory => invalidImpulses.map((raw, index) => `record("${factory}:${index}", ${factory}(${raw}))`)),
      ...invalidSatang.map((raw, index) => `record("create_satang:${index}", create_satang(${raw}))`)
    ];
    const expected = [
      ...["create_newton_seconds", "create_pound_force_seconds"].flatMap((factory, factoryIndex) => invalidImpulses.map((_, index) => ({ id: factory + ":" + index, ok: false, value: null, error: factoryIndex === 0 ? errors.newton : errors.pound }))),
      ...invalidSatang.map((_, index) => ({ id: "create_satang:" + index, ok: false, value: null, error: errors.satang }))
    ];
    write(root, "probe.py", pythonRecorder + `\nprint(json.dumps([${calls.join(",\n")}], allow_nan=False))\n`);
    expect(runNative("python", ["probe.py"], root)).toEqual(expected);
  });

  it("executes the generated Go factories against the shared numeric specification", () => {
    const root = nativeProject("go");
    write(root, "go.mod", "module example.invalid/contracts\n\ngo 1.22\n");
    const calls = numericCases.map(value => `${value.contract}(${JSON.stringify(value.contract + ":" + value.label)}, ${literal(value.raw, "go")})`);
    write(root, "cmd/probe/main.go", `package main
import (
    "encoding/json"
    "math"
    "os"
    core "example.invalid/contracts/src/core"
)
type observation struct {
    ID string \`json:"id"\`
    OK bool \`json:"ok"\`
    Value *float64 \`json:"value"\`
    Error *string \`json:"error"\`
}
func record(id string, value float64, err error) observation {
    if err != nil { message := err.Error(); return observation{ID: id, Error: &message} }
    return observation{ID: id, OK: true, Value: &value}
}
func newton(id string, raw float64) observation { value, err := core.CreateNewtonSeconds(raw); return record(id, float64(value), err) }
func pound(id string, raw float64) observation { value, err := core.CreatePoundForceSeconds(raw); return record(id, float64(value), err) }
func satang(id string, raw int64) observation { value, err := core.CreateSatang(raw); return record(id, float64(value), err) }
func main() {
    if err := json.NewEncoder(os.Stdout).Encode([]observation{${calls.join(",\n")}}); err != nil { panic(err) }
}
`);
    expect(runNative("go", ["run", "./cmd/probe"], root)).toEqual(expectedNumbers());
  }, 120_000);

  it("keeps Go booleans and fractional money outside the factory input types", () => {
    const root = nativeProject("go");
    write(root, "go.mod", "module example.invalid/contracts\n\ngo 1.22\n");
    for (const expression of ["CreateNewtonSeconds(true)", "CreateSatang(true)", "CreateSatang(1.5)"]) {
      write(root, "src/core/invalid_test.go", `package core\nfunc invalidInput() { _, _ = ${expression} }\n`);
      const result = spawnSync("go", ["test", "./src/core"], { cwd: root, encoding: "utf8", timeout: 120_000, env: { ...process.env, GOWORK: "off", GOTOOLCHAIN: "local", GOPROXY: "off", GOSUMDB: "off" } });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("cannot use");
    }
  }, 120_000);

  it("executes the generated PHP factories against the shared numeric specification", () => {
    const root = nativeProject("php");
    const factories = { newton: "NewtonSeconds::fromFloat", pound: "PoundForceSeconds::fromFloat", satang: "Satang::fromInt" };
    const calls = numericCases.map(value => `record(${JSON.stringify(value.contract + ":" + value.label)}, fn() => ${factories[value.contract]}(${literal(value.raw, "php")}))`);
    write(root, "probe.php", phpRecorder + `\necho json_encode([${calls.join(",\n")}], JSON_THROW_ON_ERROR);\n`);
    expect(runNative("php", ["probe.php"], root)).toEqual(expectedNumbers());
  });

  it("rejects PHP coercible inputs and fractional money under strict caller types", () => {
    const root = nativeProject("php");
    const factories = ["NewtonSeconds::fromFloat", "PoundForceSeconds::fromFloat", "Satang::fromInt"];
    const invalidInputs = ["true", "false", "'1'", "null", "[]"];
    const calls = factories.flatMap((factory, factoryIndex) => [...invalidInputs, ...(factoryIndex === 2 ? ["1.0", "1.5", "NAN", "INF"] : [])].map((raw, index) => `record("${factoryIndex}:${index}", fn() => ${factory}(${raw}))`));
    const expected = factories.flatMap((_, factoryIndex) => [...invalidInputs, ...(factoryIndex === 2 ? ["1.0", "1.5", "NAN", "INF"] : [])].map((_, index) => ({ id: factoryIndex + ":" + index, ok: false, value: null, error: "TYPE_ERROR" })));
    write(root, "probe.php", phpRecorder + `\necho json_encode([${calls.join(",\n")}], JSON_THROW_ON_ERROR);\n`);
    expect(runNative("php", ["probe.php"], root)).toEqual(expected);
  });
});
