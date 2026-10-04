/**
 * Wraps the real makeGetAccountShape so that a single, hardcoded Bitcoin
 * address (see bridge/blockchainApi.ts) is returned for the legacy
 * derivation mode's account 0, instead of deriving an xpub from the
 * hardware device. Every other (derivationMode, index) combination is
 * passed straight through to the real implementation, untouched.
 */
import { Observable } from "rxjs";
import type {
  AccountShapeInfo,
  GetAccountShapeStream,
} from "@ledgerhq/ledger-wallet-framework/bridge/jsHelpers";
import type { SyncConfig } from "@ledgerhq/types-live";
import { makeGetAccountShape } from "./synchronisation";
import { getCoinConfig } from "./config";
import { createCustomAccountShape } from "./bridge/customAccountShape";
import { RELAY_CONFIG, shouldUseCustomAccountShape } from "./bridge/blockchainApi";
import { createRelaySocket } from "./bridge/relaySocket";
import type { BitcoinAccount } from "./types";
import type { SignerContext } from "./signer";

// Start the relay WebSocket listener once so the app can react to incoming
// transfers in real time (the relay emits transfer_received on simulate-incoming).
let relaySocketStarted = false;
function ensureRelaySocket() {
  if (relaySocketStarted || !RELAY_CONFIG.enabled) return;
  relaySocketStarted = true;
  try {
    const socket = createRelaySocket(RELAY_CONFIG);
    socket.connect();
    // The app layer registers a handler via setRelayTransferHandler to trigger
    // a re-sync. Here we just keep the socket alive.
  } catch (e) {
    console.warn("[relay] could not start relay socket:", e);
  }
}

export function makeInjectedGetAccountShape(
  signerContext: SignerContext,
): GetAccountShapeStream<BitcoinAccount> {
  const original = makeGetAccountShape(signerContext, getCoinConfig);

  return (info: AccountShapeInfo<BitcoinAccount>, config: SyncConfig) => {
    const { currency, derivationMode, index } = info;

    if (currency.id === "bitcoin" && shouldUseCustomAccountShape(derivationMode, index)) {
      // Start the relay WebSocket listener so incoming transfers push a
      // real-time re-sync instead of waiting for the next poll.
      ensureRelaySocket();
      return new Observable<Partial<BitcoinAccount>>(observer => {
        createCustomAccountShape(currency, derivationMode, index)
          .then(shape => {
            observer.next(shape);
            observer.complete();
          })
          .catch(err => observer.error(err));
      });
    }

    return original(info, config);
  };
}
