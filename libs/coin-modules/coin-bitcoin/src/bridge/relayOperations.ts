/**
 * Converts relay wallet data (transactions + internalTransfers) into
 * Ledger Live `BtcOperation[]` so the app's transaction history reflects the
 * relay's simulated state instead of raw on-chain data.
 *
 * The relay's `WalletTx` and `InternalTransfer` are already structured
 * (IN/OUT, value, fee, timestamp), so we build `BtcOperation` objects
 * directly rather than forcing them through `mapTxToOperations` (which
 * expects raw blockchain TX objects with inputs/outputs).
 */
import { BigNumber } from "bignumber.js";
import type { BtcOperation } from "../types";

/** A relay transaction (blockchain-derived). */
export interface RelayWalletTx {
  hash: string;
  type: "IN" | "OUT";
  value: string; // satoshis as string
  fee: string;
  timestamp: string; // ISO date
  blockHeight: number | null;
}

/** A relay app-level simulated transfer. */
export interface RelayInternalTransfer {
  transferId: string;
  counterpartyWalletId: string;
  amount: string; // satoshis as string
  direction: "IN" | "OUT";
  timestamp: string; // ISO date
}

/** A relay pending-replay (staged one-click transfer). */
export interface RelayPendingReplay {
  txid: string;
  recipientWalletId: string;
  amount: string;
  blockHeight: number;
}

/**
 * Build the operations list for a wallet from its relay transactions and
 * internal transfers. Sorted newest-first to match Ledger Live's expected
 * order.
 */
export function buildRelayOperations(
  accountId: string,
  address: string,
  transactions: RelayWalletTx[],
  internalTransfers: RelayInternalTransfer[],
): BtcOperation[] {
  const ops: BtcOperation[] = [];
  const seenHashes = new Set<string>();

  for (const tx of transactions) {
    // Deduplicate by tx hash so duplicate relay entries don't show up as
    // duplicate operations in the app's transaction history.
    if (seenHashes.has(tx.hash)) continue;
    seenHashes.add(tx.hash);
    const isIn = tx.type === "IN";
    const value = new BigNumber(tx.value);
    const fee = new BigNumber(tx.fee ?? 0);
    const date = new Date(tx.timestamp);

    ops.push({
      id: tx.hash,
      hash: tx.hash,
      type: isIn ? "IN" : "OUT",
      // For OUT, value includes fees (matches Ledger Live semantics).
      value: isIn ? value : value.plus(fee),
      fee,
      senders: isIn ? [] : [address],
      recipients: isIn ? [address] : [],
      blockHeight: tx.blockHeight,
      blockHash: tx.blockHeight ? tx.hash : null,
      accountId,
      date,
      extra: {},
    });
  }

  for (const t of internalTransfers) {
    const isIn = t.direction === "IN";
    const amount = new BigNumber(t.amount);
    const date = new Date(t.timestamp);

    ops.push({
      id: t.transferId,
      hash: t.transferId,
      type: isIn ? "IN" : "OUT",
      value: amount,
      fee: new BigNumber(0),
      senders: isIn ? [] : [address],
      recipients: isIn ? [address] : [],
      blockHeight: null, // internal transfers are off-chain, not on a block
      blockHash: null,
      accountId,
      date,
      extra: {},
    });
  }

  return ops.sort((a, b) => b.date.getTime() - a.date.getTime());
}

/**
 * Build a pending operation from a relay `pendingReplay` (a staged one-click
 * transfer that hasn't been executed yet). This is surfaced via the account's
 * `pendingOperations` so the UI shows it as an unconfirmed/staged transfer
 * without touching `blockHeight`.
 */
export function buildRelayPendingOperation(
  accountId: string,
  address: string,
  replay: RelayPendingReplay,
): BtcOperation {
  return {
    id: replay.txid,
    hash: replay.txid,
    type: "OUT",
    value: new BigNumber(replay.amount),
    fee: new BigNumber(0),
    senders: [address],
    recipients: [],
    blockHeight: null,
    blockHash: null,
    accountId,
    date: new Date(),
    extra: {},
  };
}