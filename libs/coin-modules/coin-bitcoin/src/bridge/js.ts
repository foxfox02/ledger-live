import { Account, AccountBridge } from "@ledgerhq/types-live";
import { RELAY_ACCOUNT_IDENTIFIER, RELAY_CONFIG } from "./blockchainApi";
import { simulateRelayOutgoing } from "./relayClient";
import {
  makeAccountBridgeReceive,
  makeScanAccounts,
  makeSync,
} from "@ledgerhq/ledger-wallet-framework/bridge/jsHelpers";
import getAddressWrapper from "@ledgerhq/ledger-wallet-framework/bridge/getAddressWrapper";
import { postSync } from "../synchronisation";
import { makeInjectedGetAccountShape } from "../synchronisation-injected";
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
import resolver from "../hw-getAddress";
import getFullViewingKeyResolver, { GetFullViewingKeyResult } from "../hw-getFullViewingKey";
import { validateAddress } from "../validateAddress";
import buildSignRawOperation from "../signRawOperation";
import { getBitcoinEstimationRecipient } from "../constants";

type GetFullViewingKeyFromBridgeFn = (
  account: BitcoinAccount,
  options: { deviceId: string; path?: string },
) => Promise<GetFullViewingKeyResult>;

export type BitcoinAccountBridge = AccountBridge<Transaction, BitcoinAccount> & {
  getFullViewingKey: GetFullViewingKeyFromBridgeFn;
};

function buildCurrencyBridge(signerContext: SignerContext, coinConfig: CoinConfig) {
  const getAddress = resolver(signerContext);
  const scanAccounts = makeScanAccounts<BitcoinAccount>({
    getAccountShape: makeInjectedGetAccountShape(signerContext),
    getAddressFn: getAddressWrapper(getAddress),
    postSync,
  });

  return {
    scanAccounts,
  };
}

function buildAccountBridge(signerContext: SignerContext, coinConfig: CoinConfig) {
  const sync = makeSync<Transaction, BitcoinAccount, TransactionStatus>({
    getAccountShape: makeInjectedGetAccountShape(signerContext),
    postSync,
    shouldMergeOps: false,
  });

  const getAddress = resolver(signerContext);
  const getFullViewingKey = getFullViewingKeyResolver(signerContext);
  const injectGetAddressParams = (account: BitcoinAccount) => {
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
    broadcastConfig,
  }) => {
    calculateFees.reset();

    // For the relay account, intercept the broadcast: instead of broadcasting
    // to the real network, call the relay's simulate-outgoing endpoint. The
    // relay records an OUT transaction with the frozen txid's real details,
    // deducts the amount + fee, and clears the freeze state. The user still
    // went through the full send UI (recipient, amount, review, mock approval).
    if (account.id.includes(RELAY_ACCOUNT_IDENTIFIER) && RELAY_CONFIG.enabled) {
      const { operation } = signedOperation;
      const amount = operation.value.toString();
      try {
        await simulateRelayOutgoing(RELAY_CONFIG, { txid: "", amount });
        // Return the operation patched with the frozen txid so the UI shows a
        // completed send. The relay's frozen tx hash is the real txid.
        const frozenTxid = (account as any).bitcoinResources?.walletAccount?.xpub?.storage
          ?.getAllTransactions?.()
          ?.find?.((t: any) => t.block_height === null)?.hash;
        return { ...operation, hash: frozenTxid ?? operation.hash };
      } catch (e) {
        console.warn("[relay] simulate-outgoing failed:", e);
        throw e;
      }
    }

    return broadcast({
      account,
      signedOperation,
      ...(broadcastConfig ? { broadcastConfig } : {}),
    });
  };

  const getFullViewingKeyFromBridge: GetFullViewingKeyFromBridgeFn = (account, options) =>
    getFullViewingKey(options.deviceId, {
      currency: account.currency,
      path: options.path ?? account.freshAddressPath,
    });

  return {
    estimateMaxSpendable,
    createTransaction,
    prepareTransaction,
    updateTransaction,
    getTransactionStatus,
    receive,
    sync,
    signOperation: buildSignOperation(signerContext),
    signRawOperation: buildSignRawOperation(signerContext),
    broadcast: wrappedBroadcast,
    assignFromAccountRaw: makeAssignFromAccountRaw(coinConfig),
    assignToAccountRaw,
    formatAccountSpecifics: formatters.formatAccountSpecifics,
    getSerializedAddressParameters,
    validateAddress,
    getFullViewingKey: getFullViewingKeyFromBridge,
    getEstimationRecipient: (account: Account) =>
      getBitcoinEstimationRecipient(account.currency.id),
  };
}

export function createBridges(signerContext: SignerContext, coinConfig: CoinConfig) {
  setCoinConfig(coinConfig);

  return {
    currencyBridge: buildCurrencyBridge(signerContext, coinConfig),
    accountBridge: buildAccountBridge(signerContext, coinConfig),
  };
}
