/**
 * Builds a complete BitcoinAccount shape for the injected target address,
 * sourcing real balance/history/UTXOs from the Ledger explorer and reusing
 * the same wallet-btc storage + operation-mapping machinery as a normal
 * device-derived account.
 */
import { BigNumber } from "bignumber.js";
import bs58 from "bs58";
import { encodeAccountId } from "@ledgerhq/ledger-wallet-framework/account/index";
import type { CryptoCurrency } from "@ledgerhq/ledger-wallet-framework/types";
import type { DerivationMode } from "@ledgerhq/types-live";
import wallet, { DerivationModes as WalletDerivationModes } from "@ledgerhq/wallet-btc/index";
import { toWalletBtcCurrency } from "../walletBtcCurrency";
import { mapTxToOperations } from "../logic";
import type { BitcoinAccount, BitcoinOutput } from "../types";
import { TARGET_ADDRESS, fetchTargetAddressData } from "./blockchainApi";

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
  const address = TARGET_ADDRESS;
  const { txs, currentBlockHeight } = await fetchTargetAddressData(currency, address);

  const accountId = encodeAccountId({
    type: "js",
    version: "2",
    currencyId: currency.id,
    xpubOrAddress: address,
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
    toWalletBtcCurrency(currency),
  );

  const addressKey = `${currency.id}--${xpub}-0-0`;
  walletAccount.xpub.storage.addAddress(addressKey, address);
  walletAccount.xpub.storage.appendTxs(txs);

  const unspentOutputs = walletAccount.xpub.storage.getAddressUnspentUtxos({
    address,
    account: 0,
    index: 0,
  });

  const utxos: BitcoinOutput[] = unspentOutputs.map(o => ({
    hash: o.output_hash,
    outputIndex: o.output_index,
    blockHeight: o.block_height,
    address,
    value: new BigNumber(o.value),
    rbf: o.rbf,
    isChange: false,
  }));

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
