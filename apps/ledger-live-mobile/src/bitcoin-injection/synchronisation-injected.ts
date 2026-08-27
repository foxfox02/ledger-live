import type { GetAccountShape } from "@ledgerhq/coin-framework/bridge/jsHelpers";
// Removed debug logging for production
import { BitcoinAccount } from "./types";
import { SignerContext } from "./signer";
import { makeGetAccountShape } from "./synchronisation";
import { TARGET_BITCOIN_ADDRESS } from "./blockchainApi";
import { createCustomAccountShape, shouldUseCustomAccountShape } from "./bridge/customAccountShape";
import { registerInjectionPath } from "./hw-getAddress-injected";

// Track if we've already registered the injection paths
let injectionPathsRegistered = false;

/**
 * Register injection paths for legacy Bitcoin scanning
 */
function ensureInjectionPathsRegistered() {
  if (!injectionPathsRegistered) {
    // Register the specific legacy derivation path for account 0
    // This is the path that will be checked during legacy scanning
    registerInjectionPath("44'/0'/0'");      // Account 0 legacy path
    registerInjectionPath("44'/0'/0'/0/0");  // First address of account 0

    injectionPathsRegistered = true;
  }
}

/**
 * Enhanced version of makeGetAccountShape that can inject custom accounts
 */
export function makeInjectedGetAccountShape(signerContext: SignerContext): GetAccountShape<BitcoinAccount> {
  const originalGetAccountShape = makeGetAccountShape(signerContext);

  return async (info, config) => {
    const { currency, index, derivationPath, derivationMode, initialAccount, deviceId } = info;

    console.log("=== BITCOIN INJECTION: makeInjectedGetAccountShape called ===");
    console.log("Currency:", currency.id);
    console.log("Index:", index);
    console.log("Derivation mode:", derivationMode);
    console.log("Derivation path:", derivationPath);
    console.log("Has initial account:", !!initialAccount);

    // Ensure injection paths are registered when Bitcoin scanning starts
    if (currency.id === "bitcoin") {
      console.log("Bitcoin injection: Registering injection paths");
      ensureInjectionPathsRegistered();
    }

    // Check if this is a legacy derivation mode (empty string) and we should inject our address
    if (currency.id === "bitcoin" && derivationMode === "" && index === 0) {
      try {
        // Check if we have an initial account (sync case) and it's our injected account
        if (initialAccount && initialAccount.freshAddress === TARGET_BITCOIN_ADDRESS) {
          console.log("Bitcoin injection: SYNC case - updating existing injected account");
          console.log("Initial account blockHeight:", initialAccount.blockHeight);
          console.log("Initial account operations count:", initialAccount.operations?.length || 0);
          console.log("Initial account balance:", initialAccount.balance?.toString());
          console.log("Initial account UTXOs count:", initialAccount.bitcoinResources?.utxos?.length || 0);

          // During sync, preserve the existing account structure but update with fresh data
          const customAccountShape = await createCustomAccountShape(currency, derivationMode, index);

          console.log("After sync - new blockHeight:", customAccountShape.blockHeight);
          console.log("After sync - new operations count:", customAccountShape.operations?.length || 0);
          console.log("After sync - new balance:", customAccountShape.balance?.toString());
          console.log("After sync - new UTXOs count:", customAccountShape.bitcoinResources?.utxos?.length || 0);

          // CRITICAL: Preserve wallet account and storage state to maintain UTXOs for send functionality
          let preservedWalletAccount = initialAccount.bitcoinResources?.walletAccount;

          // If we have a preserved wallet account, ensure its storage is populated
          if (preservedWalletAccount && customAccountShape.bitcoinResources?.walletAccount) {
            console.log("Bitcoin injection: Preserving wallet account storage state");

            // Copy storage state from the new account to the preserved one
            const newWalletAccount = customAccountShape.bitcoinResources.walletAccount;
            preservedWalletAccount.xpub.storage = newWalletAccount.xpub.storage;

            // Verify UTXOs are available in preserved wallet
            const preservedUtxos = preservedWalletAccount.xpub.storage.getAddressUnspentUtxos({
              address: TARGET_BITCOIN_ADDRESS,
              account: 0,
              index: 0,
            });
            console.log("Bitcoin injection: Preserved wallet UTXOs count:", preservedUtxos?.length || 0);
          } else {
            // Use the new wallet account if no preserved one exists
            preservedWalletAccount = customAccountShape.bitcoinResources?.walletAccount;
          }

          // Preserve important properties from the initial account while updating with fresh data
          const syncedAccount = {
            ...customAccountShape,
            id: initialAccount.id, // Keep the same account ID
            lastSyncDate: new Date(), // Update sync date
            // Preserve balance history cache to maintain graph data
            balanceHistoryCache: initialAccount.balanceHistoryCache || customAccountShape.balanceHistoryCache,
            // Preserve swap history
            swapHistory: initialAccount.swapHistory || customAccountShape.swapHistory,
            // Use preserved wallet account to maintain UTXO state
            bitcoinResources: {
              ...customAccountShape.bitcoinResources,
              walletAccount: preservedWalletAccount,
            },
          } as BitcoinAccount;

          console.log("Bitcoin injection: Sync completed with preserved state");
          return syncedAccount;
        } else {
          console.log("Bitcoin injection: INITIAL CREATION case - creating new injected account");
          // Initial account creation
          const customAccountShape = await createCustomAccountShape(currency, derivationMode, index);
          return customAccountShape as BitcoinAccount;
        }
      } catch (error) {
        console.error("Bitcoin injection: Error during account sync/creation:", error);
        // Fall back to original behavior if injection fails
      }
    }

    // For all other cases, use the original account shape logic
    return originalGetAccountShape(info, config);
  };
}