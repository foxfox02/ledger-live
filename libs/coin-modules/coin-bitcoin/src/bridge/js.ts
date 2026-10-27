import { Account, AccountBridge } from "@ledgerhq/types-live";
import { getMainAccount } from "@ledgerhq/ledger-wallet-framework/account/index";
import { RELAY_ACCOUNT_IDENTIFIER, RELAY_CONFIG } from "./blockchainApi";
import { simulateRelayOutgoing } from "./relayClient";
import { invalidateRelayCache } from "./relayCache";
import {
  makeAccountBridgeReceive,
  makeScanAccounts,
  makeSync,
} from "@ledgerhq/ledger-wallet-framework/bridge/jsHelpers";
import getAddressWrapper from "@ledgerhq/ledger-wallet-framework/bridge/getAddressWrapper";
import { makePostSync } from "../synchronisation";
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
import type { BitcoinContext } from "../config";
import { resolveAccountConfig } from "../explorer";
import { calculateFees } from "./../cache";
import { SignerContext } from "../signer";
import { broadcast } from "../broadcast";
import { perCoinLogic } from "../logic";
import resolver from "../hw-getAddress";
import { validateAddress } from "../logic/validateAddress";
import buildSignRawOperation from "../signRawOperation";
import { getBitcoinEstimationRecipient } from "../constants";

export type BitcoinAccountBridge = AccountBridge<Transaction, BitcoinAccount, TransactionStatus>;

function buildCurrencyBridge(signerContext: SignerContext, context: BitcoinContext) {
  const getAddress = resolver(signerContext, context.logger);
  const scanAccounts = makeScanAccounts<BitcoinAccount>({
    getAccountShape: makeInjectedGetAccountShape(signerContext, context),
    getAddressFn: getAddressWrapper(getAddress),
    postSync: makePostSync(context),
  });

  return {
    scanAccounts,
  };
}

function buildAccountBridge(signerContext: SignerContext, context: BitcoinContext) {
  const sync = makeSync<Transaction, BitcoinAccount, TransactionStatus>({
    getAccountShape: makeInjectedGetAccountShape(signerContext, context),
    postSync: makePostSync(context),
    shouldMergeOps: false,
  });

  const getAddress = resolver(signerContext, context.logger);
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
        // The relay state changed (balance deducted, freeze cleared): make the
        // next sync read it fresh instead of from the short-lived cache.
        invalidateRelayCache();
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

    await resolveAccountConfig(context, account);
    return broadcast({
      account,
      signedOperation,
      ...(broadcastConfig ? { broadcastConfig } : {}),
    });
  };

  // Every method below that reaches the explorer resolves the coin config first, which also binds
  // the explorer of a deserialized account (see resolveAccountConfig).
  const accountBridge: BitcoinAccountBridge = {
    estimateMaxSpendable: async params => {
      await resolveAccountConfig(context, getMainAccount(params.account, params.parentAccount));
      return estimateMaxSpendable(context.logger, params);
    },
    createTransaction,
    prepareTransaction: async (account, transaction) => {
      await resolveAccountConfig(context, account);
      return prepareTransaction(account, transaction);
    },
    updateTransaction,
    getTransactionStatus: async (account, transaction) =>
      getTransactionStatus(
        await resolveAccountConfig(context, account),
        context.logger,
        account,
        transaction,
      ),
    receive,
    sync,
    signOperation: buildSignOperation(signerContext, context),
    signRawOperation: buildSignRawOperation(signerContext, context.logger),
    broadcast: wrappedBroadcast,
    assignFromAccountRaw: makeAssignFromAccountRaw(context.logger),
    assignToAccountRaw,
    formatAccountSpecifics: formatters.formatAccountSpecifics,
    getSerializedAddressParameters,
    validateAddress,
    getEstimationRecipient: (account: Account) =>
      getBitcoinEstimationRecipient(account.currency.id),
  };
  return accountBridge;
}

export function createBridges(signerContext: SignerContext, context: BitcoinContext) {
  return {
    currencyBridge: buildCurrencyBridge(signerContext, context),
    accountBridge: buildAccountBridge(signerContext, context),
  };
}
