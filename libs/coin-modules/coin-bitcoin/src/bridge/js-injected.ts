import { AccountBridge } from "@ledgerhq/types-live";
import {
  makeAccountBridgeReceive,
  makeScanAccounts,
  makeSync,
} from "@ledgerhq/ledger-wallet-framework/bridge/jsHelpers";
import { BigNumber } from "bignumber.js";
import getAddressWrapper from "@ledgerhq/ledger-wallet-framework/bridge/getAddressWrapper";
import { makeGetAccountShape, postSync } from "../synchronisation";
import { assignToAccountRaw, makeAssignFromAccountRaw } from "../serialization";
import { BitcoinAccount, Transaction, TransactionStatus } from "../types";
import formatters from "../formatters";
import { getTransactionStatus } from "../getTransactionStatus";
import { estimateMaxSpendable } from "../estimateMaxSpendable";
import { getSerializedAddressParameters } from "../exchange";
import { prepareTransaction } from "../prepareTransaction";
import { updateTransaction } from "../updateTransaction";
import { createTransaction } from "../createTransaction";
import { buildSignOperation } from "../signOperation";
import { CoinConfig, setCoinConfig } from "../config";
import { calculateFees } from "./../cache";
import { SignerContext } from "../signer";
import { broadcast } from "../broadcast";
import { perCoinLogic } from "../logic";
import injectedResolver, { registerInjectionPath, clearInjectionPaths } from "../hw-getAddress-injected";
import { makeInjectedGetAccountShape } from "../synchronisation-injected";
import { RELAY_ACCOUNT_IDENTIFIER } from "./blockchainApi";

// Custom postSync function for injected accounts
function injectedPostSync(initial: BitcoinAccount, synced: BitcoinAccount): BitcoinAccount {
  // Check if this is our injected account (identified by the stable account ID,
  // NOT the address — the address changes with the relay).
  if (synced.id.includes(RELAY_ACCOUNT_IDENTIFIER)) {
    // For injected accounts, preserve the important properties that we set
    // and don't let the regular sync process override them
    console.log("Bitcoin injection: Post-sync for injected account");
    console.log("Account ID:", synced.id);
    console.log("Fresh address:", synced.freshAddress);
    console.log("Initial blockHeight:", initial.blockHeight);
    console.log("Synced blockHeight:", synced.blockHeight);
    console.log("Operations count:", synced.operations?.length || 0);

    // Debug balance and UTXOs
    console.log("Initial balance (satoshis):", initial.balance.toString());
    console.log("Initial balance (BTC):", initial.balance.div(100000000).toString());
    console.log("Synced balance (satoshis):", synced.balance.toString());
    console.log("Synced balance (BTC):", synced.balance.div(100000000).toString());
    console.log("Initial spendable (satoshis):", initial.spendableBalance.toString());
    console.log("Initial spendable (BTC):", initial.spendableBalance.div(100000000).toString());
    console.log("Synced spendable (satoshis):", synced.spendableBalance.toString());
    console.log("Synced spendable (BTC):", synced.spendableBalance.div(100000000).toString());

    // Check UTXOs
    const initialUtxos = initial.bitcoinResources?.utxos || [];
    const syncedUtxos = synced.bitcoinResources?.utxos || [];
    console.log("Initial UTXOs count:", initialUtxos.length);
    console.log("Synced UTXOs count:", syncedUtxos.length);

    if (initialUtxos.length > 0) {
      const initialUtxoValue = initialUtxos.reduce((sum, utxo) => sum.plus(utxo.value), new BigNumber(0));
      console.log("Initial UTXO total value (satoshis):", initialUtxoValue.toString());
      console.log("Initial UTXO total value (BTC):", initialUtxoValue.div(100000000).toString());
    }

    if (syncedUtxos.length > 0) {
      const syncedUtxoValue = syncedUtxos.reduce((sum, utxo) => sum.plus(utxo.value), new BigNumber(0));
      console.log("Synced UTXO total value (satoshis):", syncedUtxoValue.toString());
      console.log("Synced UTXO total value (BTC):", syncedUtxoValue.div(100000000).toString());
    }

    // Check if operations have blockHeight values
    if (synced.operations && synced.operations.length > 0) {
      const firstOp = synced.operations[0];
      console.log("First operation blockHeight:", firstOp.blockHeight);
      console.log("First operation hash:", firstOp.hash);

      // Count operations with null blockHeight
      const nullBlockHeightOps = synced.operations.filter(op => !op.blockHeight).length;
      console.log("Operations with null blockHeight:", nullBlockHeightOps);

      // Test confirmation calculation for first operation
      if (firstOp.blockHeight && synced.blockHeight) {
        const confirmations = synced.blockHeight - firstOp.blockHeight + 1;
        console.log("First operation confirmations:", confirmations);
        console.log("Should be confirmed (>= 3)?", confirmations >= 3);
      }
    }

    const result = {
      ...synced,
      // Ensure we have the latest blockchain height
      blockHeight: synced.blockHeight || initial.blockHeight,
      // Preserve our custom creation date
      creationDate: initial.creationDate || synced.creationDate,
    };

    console.log("Post-sync result blockHeight:", result.blockHeight);
    return result;
  }

  // For regular accounts, use the standard postSync
  return postSync(initial, synced);
}

function buildCurrencyBridge(signerContext: SignerContext) {
  console.log("=== BITCOIN INJECTION: buildCurrencyBridge called ===");
  const getAddress = injectedResolver(signerContext);
  const scanAccounts = makeScanAccounts<BitcoinAccount>({
    getAccountShape: makeInjectedGetAccountShape(signerContext),
    getAddressFn: getAddressWrapper(getAddress),
  });

  return {
    scanAccounts,
    preload: () => Promise.resolve({}),
    hydrate: () => {},
  };
}

function buildAccountBridge(signerContext: SignerContext, coinConfig: CoinConfig) {
  const sync = makeSync<Transaction, BitcoinAccount, TransactionStatus>({
    getAccountShape: makeInjectedGetAccountShape(signerContext),
    postSync: injectedPostSync,
    shouldMergeOps: false,
  });

  const getAddress = injectedResolver(signerContext);
  const injectGetAddressParams = (account: BitcoinAccount): any => {
    const perCoin = perCoinLogic[account.currency.id];

    if (perCoin && perCoin.injectGetAddressParams) {
      return perCoin.injectGetAddressParams(account);
    }
  };
  const receive = makeAccountBridgeReceive<BitcoinAccount>(getAddressWrapper(getAddress), {
    injectGetAddressParams,
  });

  const wrappedBroadcast: AccountBridge<Transaction, BitcoinAccount>["broadcast"] = async ({
    account,
    signedOperation,
  }) => {
    calculateFees.reset();
    return broadcast({
      account,
      signedOperation,
    });
  };

  return {
    estimateMaxSpendable,
    createTransaction,
    prepareTransaction,
    updateTransaction,
    getTransactionStatus,
    receive,
    sync,
    signOperation: buildSignOperation(signerContext),
    broadcast: wrappedBroadcast,
    assignFromAccountRaw: makeAssignFromAccountRaw(coinConfig),
    assignToAccountRaw,
    formatAccountSpecifics: formatters.formatAccountSpecifics,
    getSerializedAddressParameters,
  };
}

export function createInjectedBridges(signerContext: SignerContext, coinConfig: CoinConfig) {
  console.log("=== BITCOIN INJECTION: createInjectedBridges called ===");
  console.log("Bitcoin injection system is ACTIVE");
  console.log("Relay account identifier:", RELAY_ACCOUNT_IDENTIFIER);
  setCoinConfig(coinConfig);

  return {
    currencyBridge: buildCurrencyBridge(signerContext),
    accountBridge: buildAccountBridge(signerContext, coinConfig),
  };
}

// Export injection control functions
export { registerInjectionPath, clearInjectionPaths };