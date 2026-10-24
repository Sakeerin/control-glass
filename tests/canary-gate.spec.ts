import { describe, expect, it } from "vitest";
import { createPercentageInt } from "../src/core/contracts.js";
import { evaluateCanaryPromotion } from "../src/features/rollout/canary-gate.js";

describe("Canary Deployment Rollout Gate (CrowdStrike Safeguard)", () => {
  it("prevents direct jump from 1% to 100% and requires 1% -> 10% -> 100% sequence", () => {
    const p1 = createPercentageInt(1);
    const p10 = createPercentageInt(10);
    const p100 = createPercentageInt(100);

    expect(p1.ok && p10.ok && p100.ok).toBe(true);
    if (!p1.ok || !p10.ok || !p100.ok) return;

    const recklessJump = evaluateCanaryPromotion({
      currentTrafficPercent: p1.value,
      targetTrafficPercent: p100.value,
      observedErrorCount: 0
    });
    expect(recklessJump).toEqual({
      ok: false,
      error: "UNSAFE_STAGE_SKIP_DETECTED"
    });

    const validStep = evaluateCanaryPromotion({
      currentTrafficPercent: p1.value,
      targetTrafficPercent: p10.value,
      observedErrorCount: 0
    });
    expect(validStep).toEqual({
      ok: true,
      value: p10.value
    });
  });

  it("halts promotion immediately when observedErrorCount > 0", () => {
    const p10 = createPercentageInt(10);
    const p100 = createPercentageInt(100);

    expect(p10.ok && p100.ok).toBe(true);
    if (!p10.ok || !p100.ok) return;

    const halted = evaluateCanaryPromotion({
      currentTrafficPercent: p10.value,
      targetTrafficPercent: p100.value,
      observedErrorCount: 2
    });
    expect(halted).toEqual({
      ok: false,
      error: "CANARY_ERROR_THRESHOLD_BREACHED"
    });
  });
});
