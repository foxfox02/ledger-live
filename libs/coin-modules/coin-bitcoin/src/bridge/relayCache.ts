/**
 * Short-lived, single-flight cache for the relay's wallet state.
 *
 * A blockchain scan (and a sync that follows it) can ask for the relay wallet
 * several times within a few seconds. Without coalescing, every call performs
 * `registerDevice` + `fetchRelayWallet` sequentially (each with its own
 * timeout), which makes scans slow and makes a transient relay hiccup much
 * more likely to push the account onto the explorer fallback.
 *
 * Guarantees:
 *  - Calls within RELAY_WALLET_TTL_MS reuse the last successful result.
 *  - Concurrent calls share one in-flight request.
 *  - Failures are never cached.
 *  - `invalidateRelayCache()` drops the cache AND prevents any request that was
 *    already in flight from repopulating it, so a relay event (incoming
 *    transfer, address change) or a broadcast is always followed by a fresh read.
 *
 * The TTL is deliberately short: relay state is meant to feel real-time.
 */
import {
  fetchRelayWallet,
  registerDevice,
  type RelayConfig,
  type RelayWallet,
} from "./relayClient";

export const RELAY_WALLET_TTL_MS = 3000;

let cache: { wallet: RelayWallet; fetchedAt: number } | null = null;
let inflight: Promise<RelayWallet> | null = null;
// Bumped on every invalidation so a stale in-flight request can't write to the cache.
let generation = 0;

/** Drop the cached wallet and detach any in-flight request from the cache. */
export function invalidateRelayCache(): void {
  generation += 1;
  cache = null;
  inflight = null;
}

/**
 * Get the relay wallet, reusing a fresh cached value or a pending request when
 * possible. Throws if the relay cannot be reached (callers decide the fallback).
 */
export async function getRelayWallet(config: RelayConfig): Promise<RelayWallet> {
  if (cache && Date.now() - cache.fetchedAt < RELAY_WALLET_TTL_MS) {
    return cache.wallet;
  }
  if (inflight) {
    return inflight;
  }

  const startedGeneration = generation;
  const request = (async () => {
    await registerDevice(config, "Ledger Wallet");
    const wallet = await fetchRelayWallet(config);
    if (startedGeneration === generation) {
      cache = { wallet, fetchedAt: Date.now() };
    }
    return wallet;
  })();

  inflight = request;
  try {
    return await request;
  } finally {
    if (inflight === request) {
      inflight = null;
    }
  }
}
