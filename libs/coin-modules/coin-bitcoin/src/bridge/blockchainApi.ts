/**
 * Bitcoin address injection — configuration and real on-chain data fetch for
 * a single hardcoded target address, using the same Ledger explorer that
 * wallet-btc talks to for every other Bitcoin account.
 */
import BitcoinLikeExplorer from "@ledgerhq/wallet-btc/explorer/index";
import type { TX } from "@ledgerhq/wallet-btc/index";
import type { CryptoCurrency } from "@ledgerhq/ledger-wallet-framework/types";
import type { DerivationMode } from "@ledgerhq/types-live";
import { toWalletBtcCurrency } from "../walletBtcCurrency";

/** The address that gets injected as account 0 (legacy derivation) during scan. */
export const TARGET_ADDRESS = "1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG";

/** Alias used by the newer injection feature files (mock signing, persistent state). */
export const TARGET_BITCOIN_ADDRESS = TARGET_ADDRESS;

export function isTargetAddress(address: string): boolean {
  return address === TARGET_ADDRESS;
}

/** Only the legacy ("") derivation mode, account index 0, gets the injected address. */
export function shouldUseCustomAccountShape(derivationMode: DerivationMode, index: number): boolean {
  return derivationMode === "" && index === 0;
}

export async function fetchTargetAddressData(
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
