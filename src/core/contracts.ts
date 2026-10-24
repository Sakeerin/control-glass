import { z } from "zod";

declare const BrandSymbol: unique symbol;

export type Brand<T, B extends string> = T & { readonly [BrandSymbol]: B };

export type Result<T, E extends string = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends string>(error: E): Result<never, E> {
  return { ok: false, error };
}

export type NewtonSeconds = Brand<number, "NewtonSeconds">;
export type PoundForceSeconds = Brand<number, "PoundForceSeconds">;
export type Satang = Brand<number, "Satang">;
export type NonEmptyText = Brand<string, "NonEmptyText">;
export type IdempotencyKey = Brand<string, "IdempotencyKey">;

const FinitePositiveNumberSchema = z.number().finite().nonnegative();
const SafeIntegerSchema = z.number().int().safe();
const NonEmptyTextSchema = z.string().trim().min(1);

export function createNewtonSeconds(raw: number): Result<NewtonSeconds, "INVALID_NEWTON_SECONDS"> {
  const parsed = FinitePositiveNumberSchema.safeParse(raw);
  if (!parsed.success) {
    return err("INVALID_NEWTON_SECONDS");
  }
  return ok(parsed.data as NewtonSeconds);
}

export function createPoundForceSeconds(
  raw: number
): Result<PoundForceSeconds, "INVALID_POUND_FORCE_SECONDS"> {
  const parsed = FinitePositiveNumberSchema.safeParse(raw);
  if (!parsed.success) {
    return err("INVALID_POUND_FORCE_SECONDS");
  }
  return ok(parsed.data as PoundForceSeconds);
}

export function createSatang(raw: number): Result<Satang, "INVALID_SATANG_INTEGER"> {
  const parsed = SafeIntegerSchema.safeParse(raw);
  if (!parsed.success) {
    return err("INVALID_SATANG_INTEGER");
  }
  return ok(parsed.data as Satang);
}

export function createNonEmptyText(raw: string): Result<NonEmptyText, "EMPTY_TEXT_FORBIDDEN"> {
  const parsed = NonEmptyTextSchema.safeParse(raw);
  if (!parsed.success) {
    return err("EMPTY_TEXT_FORBIDDEN");
  }
  return ok(parsed.data as NonEmptyText);
}

export function createIdempotencyKey(
  raw: string
): Result<IdempotencyKey, "INVALID_IDEMPOTENCY_KEY"> {
  const parsed = z.string().trim().min(8).max(128).safeParse(raw);
  if (!parsed.success) {
    return err("INVALID_IDEMPOTENCY_KEY");
  }
  return ok(parsed.data as IdempotencyKey);
}

export interface TelemetryReadoutViewModel {
  readonly missionName: NonEmptyText;
  readonly totalImpulseNs: NewtonSeconds;
  readonly status: "NOMINAL" | "WARNING";
}
