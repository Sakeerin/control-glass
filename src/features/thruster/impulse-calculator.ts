import {
  type NewtonSeconds,
  type PoundForceSeconds,
  type Result,
  createNewtonSeconds,
  err
} from "../../core/contracts.js";

const LBF_TO_NEWTON_FACTOR = 4.4482216152605;

export function convertPoundForceToNewtonSeconds(
  imperialImpulse: PoundForceSeconds
): Result<NewtonSeconds, "INVALID_NEWTON_SECONDS"> {
  const converted = Number((imperialImpulse * LBF_TO_NEWTON_FACTOR).toFixed(6));
  return createNewtonSeconds(converted);
}

export function accumulateOrbitalImpulse(
  currentImpulse: NewtonSeconds,
  burnImpulse: NewtonSeconds,
  maxSafeImpulse: NewtonSeconds
): Result<NewtonSeconds, "IMPULSE_LIMIT_EXCEEDED" | "INVALID_NEWTON_SECONDS"> {
  const totalRaw = Number((currentImpulse + burnImpulse).toFixed(6));
  if (totalRaw > maxSafeImpulse) {
    return err("IMPULSE_LIMIT_EXCEEDED");
  }
  return createNewtonSeconds(totalRaw);
}
