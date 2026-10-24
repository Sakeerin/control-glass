import { describe, expect, it } from "vitest";
import {
  createNewtonSeconds,
  createPoundForceSeconds
} from "../src/core/contracts.js";
import {
  accumulateOrbitalImpulse,
  convertPoundForceToNewtonSeconds
} from "../src/features/thruster/impulse-calculator.js";

describe("Orbital Thruster Impulse Calculator (Mars Orbiter Safeguard)", () => {
  it("converts PoundForceSeconds to NewtonSeconds accurately via explicit contract", () => {
    const imperialRes = createPoundForceSeconds(100);
    expect(imperialRes.ok).toBe(true);
    if (!imperialRes.ok) return;

    const metricRes = convertPoundForceToNewtonSeconds(imperialRes.value);
    expect(metricRes.ok).toBe(true);
    if (!metricRes.ok) return;

    expect(metricRes.value).toBeCloseTo(444.822162, 5);
  });

  it("accumulates impulse safely within limits and rejects exceeding safe threshold", () => {
    const current = createNewtonSeconds(500);
    const burn = createNewtonSeconds(250);
    const maxSafe = createNewtonSeconds(700);

    expect(current.ok && burn.ok && maxSafe.ok).toBe(true);
    if (!current.ok || !burn.ok || !maxSafe.ok) return;

    const exceeded = accumulateOrbitalImpulse(current.value, burn.value, maxSafe.value);
    expect(exceeded).toEqual({ ok: false, error: "IMPULSE_LIMIT_EXCEEDED" });
  });
});
