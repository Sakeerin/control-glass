import {
  type IdempotencyKey,
  type NonEmptyText,
  type Result,
  type Satang,
  createSatang,
  err,
  ok
} from "../../core/contracts.js";

export interface LedgerAccountState {
  readonly accountId: NonEmptyText;
  readonly balanceSatang: Satang;
  readonly processedKeys: ReadonlySet<IdempotencyKey>;
}

export interface SettlementTransferRequest {
  readonly idempotencyKey: IdempotencyKey;
  readonly debitAmount: Satang;
}

export function applySettlementDebit(
  state: LedgerAccountState,
  request: SettlementTransferRequest
): Result<
  LedgerAccountState,
  "DUPLICATE_TRANSACTION" | "NON_POSITIVE_TRANSFER" | "INSUFFICIENT_FUNDS" | "INVALID_SATANG_INTEGER"
> {
  if (state.processedKeys.has(request.idempotencyKey)) {
    return err("DUPLICATE_TRANSACTION");
  }
  if (request.debitAmount <= 0) {
    return err("NON_POSITIVE_TRANSFER");
  }
  if (state.balanceSatang < request.debitAmount) {
    return err("INSUFFICIENT_FUNDS");
  }

  const nextBalanceResult = createSatang(state.balanceSatang - request.debitAmount);
  if (!nextBalanceResult.ok) {
    return nextBalanceResult;
  }

  const updatedKeys = new Set<IdempotencyKey>(state.processedKeys);
  updatedKeys.add(request.idempotencyKey);

  return ok({
    accountId: state.accountId,
    balanceSatang: nextBalanceResult.value,
    processedKeys: updatedKeys
  });
}
