/**
 * Mock signature utilities for Bitcoin injection testing
 * Allows sending transactions without a physical hardware device
 */

import { RELAY_ACCOUNT_IDENTIFIER } from "./blockchainApi";

/**
 * Generate a realistic-looking Bitcoin transaction hash
 * Bitcoin TXIDs are 64 hex characters (32 bytes)
 */
export function generateMockTxHash(accountId: string): string {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).substring(2, 15);
  
  // Create a deterministic but unique-looking hash
  const baseString = `${accountId}${timestamp}${random}`;
  
  // Simple hash function (for mock purposes)
  let hash = "";
  for (let i = 0; i < 64; i++) {
    const charCode = baseString.charCodeAt(i % baseString.length) + i;
    const hexChar = (charCode % 16).toString(16);
    hash += hexChar;
  }
  
  // Ensure we have a valid 64-character hex string
  return hash.padEnd(64, "0").substring(0, 64);
}

/**
 * Generate a mock Bitcoin signature
 * Bitcoin signatures are typically DER-encoded and ~140-148 bytes
 */
export function generateMockSignature(): string {
  // Generate a realistic-looking hex signature
  // For mock purposes, we'll create a 290-character hex string (~145 bytes)
  let signature = "";
  for (let i = 0; i < 290; i++) {
    signature += Math.floor(Math.random() * 16).toString(16);
  }
  return signature;
}

/**
 * Check if this account should use mock signing
 * Only the injected test account bypasses the hardware device.
 * Detection is by the stable account ID (the address changes with the relay).
 */
export function shouldUseMockSignature(account: { id: string; freshAddress: string }): boolean {
  const shouldMock = account.id.includes(RELAY_ACCOUNT_IDENTIFIER);
  console.log(`Bitcoin injection: shouldUseMockSignature check`);
  console.log(`  Account id: ${account.id}`);
  console.log(`  Account freshAddress: ${account.freshAddress}`);
  console.log(`  Result: ${shouldMock}`);
  return shouldMock;
}

/**
 * Simulate device review screen display time
 * User reviews transaction details (amount, recipient, fees) on device screen
 *
 * For complex transactions (many UTXOs), the device takes longer to:
 * - Display all input addresses
 * - Calculate total amounts
 * - Render fee information
 */
export async function simulateDeviceReviewDelay(): Promise<void> {
  // Realistic timing for reviewing a complex Bitcoin transaction with 93 UTXOs:
  // - Initial display: 1.5s (device renders transaction data)
  // - User reads amount, recipient: 2.5s
  // - User scrolls through details: 1.5s
  // Total: 5.5 seconds
  await new Promise(resolve => setTimeout(resolve, 5500));
}

/**
 * Simulate user pressing approve button on device
 * Mimics the time user takes to physically press the button and confirm
 *
 * This includes:
 * - User decision time
 * - Physical button press
 * - Device acknowledging the press
 */
export async function simulateUserApprovalDelay(): Promise<void> {
  // User presses approve button and device confirms: 2 seconds
  await new Promise(resolve => setTimeout(resolve, 2000));
}

/**
 * Simulate signature generation on device
 * Device generates cryptographic signature for the transaction
 *
 * For transactions with many inputs (93 UTXOs), the device must:
 * - Hash all input scripts
 * - Generate signature for each input
 * - Assemble final transaction
 *
 * Nano devices process ~15-20 inputs per second
 */
export async function simulateSignatureGenerationDelay(): Promise<void> {
  // Realistic signature generation for 93 UTXO transaction:
  // - Base signature time: 2s
  // - Per-UTXO overhead: 93 UTXOs × 50ms = 4.65s
  // - Final assembly: 1s
  // Total: ~7.5 seconds
  await new Promise(resolve => setTimeout(resolve, 7500));
}
