import { describe, expect, it } from "vitest";
import {
  createIdempotencyKey,
  createNonEmptyText,
  createSatang
} from "../src/core/contracts.js";
import {
  applySettlementDebit,
  type LedgerAccountState
} from "../src/features/ledger/settlement.js";

describe("Precision Financial Ledger (Knight Capital Safeguard)", () => {
  it("debits Satang deterministically and blocks duplicate idempotency keys", () => {
    const accId = createNonEmptyText("ACC-001");
    const initialBal = createSatang(100_000);
    const txKey = createIdempotencyKey("tx-settlement-2026-0001");
    const debitAmt = createSatang(25_000);

    expect(accId.ok && initialBal.ok && txKey.ok && debitAmt.ok).toBe(true);
    if (!accId.ok || !initialBal.ok || !txKey.ok || !debitAmt.ok) return;

    const state: LedgerAccountState = {
      accountId: accId.value,
      balanceSatang: initialBal.value,
      processedKeys: new Set()
    };

    const firstResult = applySettlementDebit(state, {
      idempotencyKey: txKey.value,
      debitAmount: debitAmt.value
    });

    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) return;
    expect(firstResult.value.balanceSatang).toBe(75_000);

    const replayResult = applySettlementDebit(firstResult.value, {
      idempotencyKey: txKey.value,
      debitAmount: debitAmt.value
    });
    expect(replayResult).toEqual({ ok: false, error: "DUPLICATE_TRANSACTION" });
  });
});
