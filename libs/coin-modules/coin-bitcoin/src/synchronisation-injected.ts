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
import { createCustomAccountShape } from "./bridge/customAccountShape";
import { shouldUseCustomAccountShape } from "./bridge/blockchainApi";
import type { BitcoinAccount } from "./types";
import type { SignerContext } from "./signer";

export function makeInjectedGetAccountShape(
  signerContext: SignerContext,
): GetAccountShapeStream<BitcoinAccount> {
  const original = makeGetAccountShape(signerContext);

  return (info: AccountShapeInfo<BitcoinAccount>, config: SyncConfig) => {
    const { currency, derivationMode, index } = info;

    if (currency.id === "bitcoin" && shouldUseCustomAccountShape(derivationMode, index)) {
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
