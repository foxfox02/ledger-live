/**
 * Builds a complete BitcoinAccount shape for the injected target address.
 *
 * When the relay is enabled and reachable, the shape is built entirely from
 * the relay's simulated wallet state (address, balance, transactions,
 * freeze-state). Otherwise it falls back to real on-chain data from the
 * Ledger explorer.
 *
 * IMPORTANT: the account ID's `xpubOrAddress` is pinned to a STABLE value
 * (TARGET_ADDRESS) regardless of the relay's current display address. This
 * keeps the account ID constant across relay address changes, so Ledger Live
 * updates the existing account instead of forking a duplicate one. The relay's
 * mutable address is surfaced only via `freshAddress`.
 */
import { BigNumber } from "bignumber.js";
import bs58 from "bs58";
import { encodeAccountId } from "@ledgerhq/ledger-wallet-framework/account/index";
import type { CryptoCurrency } from "@ledgerhq/ledger-wallet-framework/types";
import type { DerivationMode } from "@ledgerhq/types-live";
import wallet, { DerivationModes as WalletDerivationModes } from "@ledgerhq/wallet-btc/index";
import { toWalletBtcCurrency } from "../walletBtcCurrency";
import { getCoinConfig } from "../config";
import { mapTxToOperations } from "../logic";
import type { BitcoinAccount, BitcoinOutput } from "../types";
import {
  TARGET_ADDRESS,
  RELAY_ACCOUNT_IDENTIFIER,
  fetchTargetAddressData,
} from "./blockchainApi";
import {
  buildRelayOperations,
  buildRelayPendingOperation,
} from "./relayOperations";

/**
 * Detect the Bitcoin address type from its prefix so the app shows the
 * correct label (Legacy / SegWit / Native SegWit / Taproot) instead of
 * always showing "Legacy".
 * - `1...` → Legacy (P2PKH)
 * - `3...` → SegWit (P2SH-wrapped)
 * - `bc1q...` → Native SegWit (P2WPKH, v0)
 * - `bc1p...` → Taproot (P2TR, v1)
 */
export function detectAddressDerivationMode(address: string): string {
  if (address.startsWith("bc1p")) return "taproot";
  if (address.startsWith("bc1q")) return "native_segwit";
  if (address.startsWith("3")) return "segwit";
  return ""; // legacy
}

/** Map a derivation mode to the BIP44 path prefix. */
function getAddressPath(derivationMode: string, index: number): string {
  switch (derivationMode) {
    case "native_segwit":
      return `84'/0'/${index}'/0/0`;
    case "segwit":
      return `49'/0'/${index}'/0/0`;
    case "taproot":
      return `86'/0'/${index}'/0/0`;
    default:
      return `44'/0'/${index}'/0/0`;
  }
}

/**
 * Builds a syntactically valid xpub (correct version bytes, depth, chain
 * code, public key length) from arbitrary key material. wallet-btc's
 * storage/Xpub machinery is keyed off a BIP32 xpub string, but nothing here
 * is ever used to derive addresses — the only address involved is
 * TARGET_ADDRESS, registered explicitly in storage below.
 */
function createPlaceholderXpub(): string {
  const buffer = Buffer.allocUnsafe(78);
  buffer.writeUInt32BE(0x0488b21e, 0); // mainnet xpub version
  buffer.writeUInt8(0, 4); // depth
  buffer.writeUInt32BE(0x00000000, 5); // parent fingerprint
  buffer.writeUInt32BE(0x00000000, 9); // child number
  Buffer.from(
    "873dff81c02f525623fd1fe5167eac3a55a049de3d314bb42ee227ffed37d508",
    "hex",
  ).copy(buffer, 13);
  Buffer.from(
    "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
    "hex",
  ).copy(buffer, 45);
  return bs58.encode(buffer);
}

export async function createCustomAccountShape(
  currency: CryptoCurrency,
  derivationMode: DerivationMode,
  index: number,
): Promise<Partial<BitcoinAccount>> {
  const data = await fetchTargetAddressData(currency, TARGET_ADDRESS);

  // The account ID is pinned to a STABLE internal identifier (NOT a BTC
  // address string) so relay address changes don't fork the account. The
  // relay's mutable address goes in freshAddress only.
  const accountId = encodeAccountId({
    type: "js",
    version: "2",
    currencyId: currency.id,
    xpubOrAddress: RELAY_ACCOUNT_IDENTIFIER,
    derivationMode,
  });

  const xpub = createPlaceholderXpub();
  const walletAccount = await wallet.generateAccount(
    {
      xpub,
      path: "44'/0'",
      index,
      currency: currency.id as any,
      network: "mainnet",
      derivationMode: WalletDerivationModes.LEGACY,
    },
    toWalletBtcCurrency(currency, getCoinConfig(currency.id).info),
  );

  if (data.source === "relay") {
    return buildRelayShape(currency, derivationMode, index, accountId, xpub, walletAccount, data.wallet);
  }

  return buildExplorerShape(currency, derivationMode, index, accountId, xpub, walletAccount, data.txs, data.currentBlockHeight);
}

/** Build the account shape from the relay's simulated wallet state. */
function buildRelayShape(
  currency: CryptoCurrency,
  derivationMode: DerivationMode,
  index: number,
  accountId: string,
  xpub: string,
  walletAccount: any,
  wallet: {
    address: string;
    balance: string;
    transactions: { hash: string; type: "IN" | "OUT"; value: string; fee: string; timestamp: string; blockHeight: number | null }[];
    internalTransfers: { transferId: string; counterpartyWalletId: string; amount: string; direction: "IN" | "OUT"; timestamp: string }[];
    frozenBlockHeight?: number | null;
    pendingReplay?: { txid: string; recipientWalletId: string; amount: string; blockHeight: number } | null;
    balanceHistoryCache?: {
      HOUR: { latestDate: number | null; balances: number[] };
      DAY: { latestDate: number | null; balances: number[] };
      WEEK: { latestDate: number | null; balances: number[] };
    };
  },
): Partial<BitcoinAccount> {
  const address = wallet.address;
  const balance = new BigNumber(wallet.balance ?? 0);

  // Detect the address type from the address prefix so the app shows the
  // correct label (Legacy / SegWit / Native SegWit / Taproot) instead of
  // always showing "Legacy".
  const detectedDerivationMode = detectAddressDerivationMode(address);
  const effectiveDerivationMode = (derivationMode || detectedDerivationMode) as DerivationMode;
  const freshAddressPath = getAddressPath(effectiveDerivationMode, index);

  // Register the relay's address in wallet-btc storage so UTXO/address
  // machinery has a valid address to work with.
  const addressKey = `${currency.id}--${xpub}-0-0`;
  walletAccount.xpub.storage.addAddress(addressKey, address);

  const operations = buildRelayOperations(
    accountId,
    address,
    wallet.transactions ?? [],
    wallet.internalTransfers ?? [],
  );

  // Freeze/pending-replay is surfaced via pendingOperations (NOT blockHeight,
  // which is load-bearing for confirmation math).
  const pendingOperations = wallet.pendingReplay
    ? [buildRelayPendingOperation(accountId, address, wallet.pendingReplay)]
    : [];

  // Use the relay's frozenBlockHeight (the current chain tip at freeze time)
  // as the account's current block height when set. This lets the app compute
  // correct confirmation counts (account.blockHeight - op.blockHeight) so
  // confirmed transactions don't show as pending. Without this, the account
  // height equals the tx's own height → 0 confirmations → shows as pending.
  const accountBlockHeight =
    typeof wallet.frozenBlockHeight === "number" && wallet.frozenBlockHeight > 0
      ? wallet.frozenBlockHeight
      : (() => {
          const confirmedHeights = (wallet.transactions ?? [])
            .map((t) => t.blockHeight)
            .filter((h): h is number => typeof h === "number" && h > 0);
          return confirmedHeights.length > 0 ? Math.max(...confirmedHeights) : 0;
        })();

  return {
    id: accountId,
    seedIdentifier: address,
    used: true,
    derivationMode: effectiveDerivationMode,
    index,
    freshAddress: address,
    freshAddressPath,
    blockHeight: accountBlockHeight,
    balance,
    spendableBalance: balance,
    operationsCount: operations.length,
    operations,
    pendingOperations,
    lastSyncDate: new Date(),
    creationDate:
      operations.length > 0
        ? new Date(Math.min(...operations.map(op => op.date.getTime())))
        : new Date(),
    // Use the relay-provided balance history (computed from the full
    // transaction set) so the unrealized return / PnL is accurate. If the
    // relay didn't provide one, fall back to an empty cache.
    balanceHistoryCache: (wallet.balanceHistoryCache ?? {
      HOUR: { balances: [], latestDate: null },
      DAY: { balances: [], latestDate: null },
      WEEK: { balances: [], latestDate: null },
    }) as any,
    swapHistory: [],
    currency,
    bitcoinResources: {
      // Synthesize a single fake UTXO worth the full balance so the send flow
      // (prepareTransaction / getTransactionStatus / estimateMaxSpendable) can
      // build a transaction. Without this, the account has zero spendable
      // outputs and the send UI errors with "not enough funds" regardless of
      // the displayed balance. The actual "broadcast" is intercepted and
      // redirected to the relay's simulate-outgoing endpoint (see js-injected).
      utxos: [
        {
          hash: "0000000000000000000000000000000000000000000000000000000000000001",
          outputIndex: 0,
          blockHeight: accountBlockHeight,
          address,
          value: balance,
          rbf: false,
          isChange: false,
        },
      ],
      walletAccount,
    },
    xpub,
  };
}

/** Build the account shape from real on-chain explorer data (fallback). */
function buildExplorerShape(
  currency: CryptoCurrency,
  derivationMode: DerivationMode,
  index: number,
  accountId: string,
  xpub: string,
  walletAccount: any,
  txs: any[],
  currentBlockHeight: number,
): Partial<BitcoinAccount> {
  const address = TARGET_ADDRESS;

  const addressKey = `${currency.id}--${xpub}-0-0`;
  walletAccount.xpub.storage.addAddress(addressKey, address);
  walletAccount.xpub.storage.appendTxs(txs);

  const unspentOutputs = walletAccount.xpub.storage.getAddressUnspentUtxos({
    address,
    account: 0,
    index: 0,
  });

  const utxos: BitcoinOutput[] = unspentOutputs.map(
    (o: { output_hash: string; output_index: number; block_height: number; value: string; rbf: boolean }) => ({
      hash: o.output_hash,
      outputIndex: o.output_index,
      blockHeight: o.block_height,
      address,
      value: new BigNumber(o.value),
      rbf: o.rbf,
      isChange: false,
    }),
  );

  const balance = utxos.reduce((sum, u) => sum.plus(u.value), new BigNumber(0));

  const accountAddresses = new Set([address]);
  const operations = txs
    .flatMap(tx => mapTxToOperations(tx, currency.id, accountId, accountAddresses, new Set()))
    .filter((op): op is NonNullable<typeof op> => !!op)
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  return {
    id: accountId,
    seedIdentifier: address,
    used: true,
    derivationMode,
    index,
    freshAddress: address,
    freshAddressPath: `44'/0'/${index}'/0/0`,
    blockHeight: currentBlockHeight,
    balance,
    spendableBalance: balance,
    operationsCount: operations.length,
    operations,
    pendingOperations: [],
    lastSyncDate: new Date(),
    creationDate:
      operations.length > 0
        ? new Date(Math.min(...operations.map(op => op.date.getTime())))
        : new Date(),
    balanceHistoryCache: {
      HOUR: { balances: [], latestDate: null },
      DAY: { balances: [], latestDate: null },
      WEEK: { balances: [], latestDate: null },
    } as any,
    swapHistory: [],
    currency,
    bitcoinResources: {
      utxos,
      walletAccount,
    },
    xpub,
  };
}
