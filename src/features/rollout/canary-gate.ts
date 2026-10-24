import {
  type PercentageInt,
  type Result,
  err,
  ok
} from "../../core/contracts.js";

export interface CanaryPromotionInput {
  readonly currentTrafficPercent: PercentageInt;
  readonly targetTrafficPercent: PercentageInt;
  readonly observedErrorCount: number;
}

const ALLOWED_TRANSITIONS: Readonly<Record<number, number>> = {
  1: 10,
  10: 100
};

export function evaluateCanaryPromotion(
  input: CanaryPromotionInput
): Result<
  PercentageInt,
  "CANARY_ERROR_THRESHOLD_BREACHED" | "UNSAFE_STAGE_SKIP_DETECTED"
> {
  if (input.observedErrorCount > 0) {
    return err("CANARY_ERROR_THRESHOLD_BREACHED");
  }

  const allowedNextStage = ALLOWED_TRANSITIONS[input.currentTrafficPercent];
  if (allowedNextStage !== input.targetTrafficPercent) {
    return err("UNSAFE_STAGE_SKIP_DETECTED");
  }

  return ok(input.targetTrafficPercent);
}
