# Off-Chain Bitcoin Mock Transaction — Enhanced Implementation Specification

## Overview

Design and implement a fully simulated, off-chain Bitcoin transaction flow between two instances of the Ledger Live mobile app running on separate emulators or physical devices connected via ADB. The goal is to replicate the entire "send" lifecycle — from address generation through pending state to final confirmation — without touching a live blockchain.

This specification builds on the existing mock infrastructure already in place (address injection, signer bypass, transaction building, broadcast interception) and extends it with a local UTXO ledger, dual-address support, and a simulated confirmation mechanism.

---

## 1. Dual-Device Setup Script

### 1.1 ADB-Based Launcher

Create a shell script (`scripts/off-chain-demo.sh`) that:

1. **Detects connected devices** via `adb devices -l` and validates that at least two devices are present
2. **Installs the staging APK** on both devices:
   ```bash
   adb -s <device1_serial> install -r app/build/outputs/apk/stagingRelease/app-arm64-v8a-stagingRelease.apk
   adb -s <device2_serial> install -r app/build/outputs/apk/stagingRelease/app-arm64-v8a-stagingRelease.apk
   ```
3. **Launches the app** on both devices:
   ```bash
   adb -s <device1_serial> shell am start -n com.ledger.live/.MainActivity
   adb -s <device2_serial> shell am start -n com.ledger.live/.MainActivity
   ```
4. **Configures distinct user contexts** by writing different mock address configurations to each device's app storage:
   ```bash
   # Device A (Sender) — uses the existing injected address
   adb -s <device1_serial> shell "echo '1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG' > /data/data/com.ledger.live/files/mock_address"
   
   # Device B (Receiver) — uses a second injected address
   adb -s <device2_serial> shell "echo '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' > /data/data/com.ledger.live/files/mock_address"
   ```
5. **Starts logcat capture** on both devices for debugging:
   ```bash
   adb -s <device1_serial> logcat -v time "ReactNativeJS:V" "*:S" > /tmp/device_a.log &
   adb -s <device2_serial> logcat -v time "ReactNativeJS:V" "*:S" > /tmp/device_b.log &
   ```

### 1.2 Configuration Injection

The app must read its mock address from a configurable source at startup. Modify `blockchainApi.ts` to support:

```typescript
// blockchainApi.ts — enhanced
let currentAddress: string = DEFAULT_ADDRESS;

// Allow runtime override via AsyncStorage or file
export async function loadTargetAddress(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem('MOCK_BITCOIN_ADDRESS');
    if (stored && isValidBitcoinAddress(stored)) {
      currentAddress = stored;
    }
  } catch {}
  return currentAddress;
}
```

This enables the ADB script to set different addresses per device without rebuilding the APK.

---

## 2. Mock Address Derivation

### 2.1 Dual Address Injection

Extend `hw-getAddress-injected.ts` to support multiple injected addresses mapped to different derivation indices:

```typescript
// Conceptual enhancement
const INJECTION_ADDRESSES = new Map<string, string>();
// Map derivation path → bitcoin address
// "44'/0'/0'" → "1GR9qNz..."  (Device A, account 0)
// "44'/0'/1'" → "1A1zP1e..."  (Device B, account 1)

export function registerInjectionAddress(path: string, address: string): void {
  INJECTION_ADDRESSES.set(path, address);
}

function shouldInjectAddress(path: string): boolean {
  return INJECTION_ADDRESSES.has(path);
}
```

### 2.2 Address Validation

Both addresses must pass Bitcoin mainnet validation:
- **Legacy (P2PKH):** Starts with `1`, 25-34 characters, Base58Check
- **SegWit (P2SH):** Starts with `3`, 25-34 characters, Base58Check
- **Native SegWit (Bech32):** Starts with `bc1`, 39-87 characters

The existing `isValidBitcoinAddress()` in `blockchainApi.ts` already handles this.

### 2.3 Account Discovery

Modify `synchronisation-injected.ts` to register both derivation paths:

```typescript
// Register both accounts at module load time
registerInjectionPath("44'/0'/0'");   // Account 0 — Device A (Sender)
registerInjectionPath("44'/0'/1'");   // Account 1 — Device B (Receiver)
```

The scan flow will discover both accounts. Each device only displays the account matching its configured address.

---

## 3. Local UTXO Ledger

### 3.1 Data Structure

Create `LocalUtxoLedger.ts` in `libs/coin-modules/coin-bitcoin/src/bridge/`:

```typescript
interface UtxoEntry {
  txid: string;        // Transaction ID (mock hash)
  vout: number;        // Output index
  value: number;       // Value in satoshis
  address: string;     // Owner address
  spent: boolean;      // Whether this UTXO has been spent
  confirmations: number; // 0 = pending, 6+ = confirmed
}

interface TransactionEntry {
  txid: string;
  from: string;
  to: string;
  amount: number;      // Satoshis
  fee: number;         // Satoshis
  timestamp: number;   // Unix ms
  status: 'pending' | 'confirmed';
  confirmations: number;
}

interface AddressLedger {
  utxos: UtxoEntry[];
  transactions: TransactionEntry[];
}

class LocalUtxoLedger {
  private ledger: Map<string, AddressLedger> = new Map();
  
  // Initialize with seed UTXOs for the sender address
  initializeSender(address: string, initialBalanceSat: number): void;
  
  // Initialize empty ledger for receiver
  initializeReceiver(address: string): void;
  
  // Get unspent UTXOs for an address
  getUnspentUtxos(address: string): UtxoEntry[];
  
  // Get balance for an address
  getBalance(address: string): number;
  
  // Get transaction history for an address
  getTransactions(address: string): TransactionEntry[];
  
  // Process a send: mark UTXOs spent, create new UTXOs for receiver + change
  processSend(from: string, to: string, amount: number, fee: number): {
    txid: string;
    spentUtxos: UtxoEntry[];
    newUtxos: UtxoEntry[];
  };
  
  // Confirm a pending transaction
  confirmTransaction(txid: string): void;
  
  // Persist to AsyncStorage
  async save(): Promise<void>;
  
  // Load from AsyncStorage
  async load(): Promise<void>;
}
```

### 3.2 UTXO Selection Algorithm

When processing a send:
1. Get all unspent UTXOs for the sender, sorted by value (largest first)
2. Select UTXOs until the sum ≥ amount + fee
3. If exact match, spend those UTXOs
4. If over, create a change UTXO for the remainder
5. Mark selected UTXOs as `spent: true`
6. Create new UTXOs for the receiver (amount) and sender (change)

### 3.3 Persistence

Use React Native's `AsyncStorage` to persist the ledger as JSON:

```typescript
const STORAGE_KEY = 'OFF_CHAIN_BITCOIN_LEDGER';

async save(): Promise<void> {
  const data = JSON.stringify(Array.from(this.ledger.entries()));
  await AsyncStorage.setItem(STORAGE_KEY, data);
}

async load(): Promise<void> {
  const data = await AsyncStorage.getItem(STORAGE_KEY);
  if (data) {
    this.ledger = new Map(JSON.parse(data));
  }
}
```

---

## 4. End-to-End Send Flow with Pending State

### 4.1 Modified Account Shape

Update `customAccountShape.ts` to read from the local ledger instead of the blockchain explorer:

```typescript
export async function createCustomAccountShape(
  currency: CryptoCurrency,
  derivationMode: DerivationMode,
  index: number,
): Promise<Partial<BitcoinAccount>> {
  const address = getTargetAddress();
  const ledger = await LocalUtxoLedger.getInstance();
  
  // Initialize ledger if this is a new address
  if (!ledger.hasAddress(address)) {
    if (index === 0) {
      // Sender: seed with initial balance
      ledger.initializeSender(address, 1_574_555_983_694); // ~15,745 BTC
    } else {
      // Receiver: start empty
      ledger.initializeReceiver(address);
    }
    await ledger.save();
  }
  
  const utxos = ledger.getUnspentUtxos(address);
  const balance = ledger.getBalance(address);
  const transactions = ledger.getTransactions(address);
  
  // Build the account shape from local ledger data
  // (same structure as current, but sourced from ledger instead of API)
  // ...
}
```

### 4.2 Modified Broadcast

Update the `wrappedBroadcast` in `js.ts` to process the transaction through the local ledger:

```typescript
const wrappedBroadcast = async ({ account, signedOperation }) => {
  calculateFees.reset();
  
  if ((account as BitcoinAccount).freshAddress === getTargetAddress()) {
    const ledger = await LocalUtxoLedger.getInstance();
    const { operation } = signedOperation;
    
    // Extract transaction details from the operation
    const amount = operation.value.toNumber();
    const fee = operation.fee.toNumber();
    const recipient = operation.recipients[0];
    
    // Process through local ledger (creates pending state)
    const { txid } = ledger.processSend(
      account.freshAddress,
      recipient,
      amount,
      fee
    );
    
    await ledger.save();
    
    // Return operation with mock tx hash (pending state)
    return patchOperationWithHash(operation, txid);
  }
  
  return broadcast({ account, signedOperation, broadcastConfig });
};
```

### 4.3 Pending State

After broadcast, the operation enters a `pending` state:
- `operation.hash` = the mock txid
- `operation.blockHeight` = null (unconfirmed)
- The UI shows "Pending" with a spinner

The local ledger marks the transaction as `status: 'pending'` with `confirmations: 0`.

---

## 5. Simulated Confirmation

### 5.1 Confirmation Trigger

Create a mechanism to trigger confirmation after a configurable delay:

```typescript
// In the ADB script or via a debug menu in the app
async function simulateConfirmation(txid: string, delayMs: number = 15000): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, delayMs));
  
  const ledger = await LocalUtxoLedger.getInstance();
  ledger.confirmTransaction(txid);
  await ledger.save();
  
  // Trigger a re-sync on both devices
  // This can be done via a broadcast event or by calling the sync function
}
```

### 5.2 Confirmation Mechanism

When `confirmTransaction(txid)` is called:
1. Find the transaction in the ledger by txid
2. Set `status: 'confirmed'` and `confirmations: 6`
3. For each UTXO created by this transaction, set `confirmations: 6`
4. For each UTXO spent by this transaction, they remain `spent: true`

### 5.3 Re-Sync Trigger

After confirmation, both devices must re-sync to reflect the new state:

**Option A: Manual re-sync via ADB**
```bash
# Trigger sync by sending an intent or touching the UI
adb -s <device_serial> shell input tap <x> <y>  # Tap the sync button
```

**Option B: Automatic re-sync via event**
```typescript
// Emit an event that the sync listener picks up
EventEmitter.emit('OFF_CHAIN_TX_CONFIRMED', { txid });
```

**Option C: Polling-based sync**
The existing sync mechanism already polls periodically. After confirmation, the next sync cycle will pick up the updated ledger state.

### 5.4 State After Confirmation

| Field | Device A (Sender) | Device B (Receiver) |
|-------|-------------------|---------------------|
| Balance | Decreased by amount + fee | Increased by amount |
| Operation status | Confirmed | Confirmed |
| Transaction ID | Same txid | Same txid |
| Block height | Mock block height | Mock block height |
| Confirmations | 6 | 6 |

---

## 6. Validation Checks

### 6.1 Balance Verification

```typescript
async function validateBalances(
  ledger: LocalUtxoLedger,
  senderAddress: string,
  receiverAddress: string,
  expectedSendAmount: number,
  expectedFee: number,
  initialSenderBalance: number,
  initialReceiverBalance: number,
): Promise<{ passed: boolean; details: string }> {
  const senderBalance = ledger.getBalance(senderAddress);
  const receiverBalance = ledger.getBalance(receiverAddress);
  
  const expectedSenderBalance = initialSenderBalance - expectedSendAmount - expectedFee;
  const expectedReceiverBalance = initialReceiverBalance + expectedSendAmount;
  
  const senderOk = senderBalance === expectedSenderBalance;
  const receiverOk = receiverBalance === expectedReceiverBalance;
  
  return {
    passed: senderOk && receiverOk,
    details: `
      Sender balance: ${senderBalance} (expected ${expectedSenderBalance}) — ${senderOk ? 'PASS' : 'FAIL'}
      Receiver balance: ${receiverBalance} (expected ${expectedReceiverBalance}) — ${receiverOk ? 'PASS' : 'FAIL'}
    `,
  };
}
```

### 6.2 Transaction ID Matching

```typescript
async function validateTransactionId(
  ledger: LocalUtxoLedger,
  senderAddress: string,
  receiverAddress: string,
  expectedTxid: string,
): Promise<{ passed: boolean; details: string }> {
  const senderTxs = ledger.getTransactions(senderAddress);
  const receiverTxs = ledger.getTransactions(receiverAddress);
  
  const senderHasTx = senderTxs.some(tx => tx.txid === expectedTxid);
  const receiverHasTx = receiverTxs.some(tx => tx.txid === expectedTxid);
  
  return {
    passed: senderHasTx && receiverHasTx,
    details: `
      Sender has tx ${expectedTxid}: ${senderHasTx ? 'PASS' : 'FAIL'}
      Receiver has tx ${expectedTxid}: ${receiverHasTx ? 'PASS' : 'FAIL'}
    `,
  };
}
```

### 6.3 ADB-Based Validation Script

```bash
#!/bin/bash
# scripts/validate-off-chain-tx.sh

DEVICE_A=$1
DEVICE_B=$2
TXID=$3

echo "=== Off-Chain Transaction Validation ==="
echo "Device A (Sender): $DEVICE_A"
echo "Device B (Receiver): $DEVICE_B"
echo "Transaction ID: $TXID"
echo ""

# Pull ledger state from both devices
adb -s $DEVICE_A shell "cat /data/data/com.ledger.live/files/off_chain_ledger.json" > /tmp/ledger_a.json
adb -s $DEVICE_B shell "cat /data/data/com.ledger.live/files/off_chain_ledger.json" > /tmp/ledger_b.json

# Parse and validate (using Node.js)
node -e "
const ledgerA = JSON.parse(require('fs').readFileSync('/tmp/ledger_a.json', 'utf8'));
const ledgerB = JSON.parse(require('fs').readFileSync('/tmp/ledger_b.json', 'utf8'));

// Validate balances
// Validate txid match
// Output pass/fail summary
"
```

---

## 7. Implementation Phases

### Phase 1: Local UTXO Ledger (Core)
- Create `LocalUtxoLedger.ts` with full CRUD + persistence
- Unit tests for UTXO selection, balance calculation, send processing

### Phase 2: Dual Address Support
- Extend `hw-getAddress-injected.ts` for multiple addresses
- Register second derivation path in `synchronisation-injected.ts`
- Modify `blockchainApi.ts` for runtime address configuration

### Phase 3: Off-Chain Account Shape
- Modify `customAccountShape.ts` to read from local ledger
- Modify `wrappedBroadcast` in `js.ts` to process through local ledger
- Implement pending → confirmed state transitions

### Phase 4: ADB Automation
- Create `scripts/off-chain-demo.sh` for dual-device setup
- Create `scripts/validate-off-chain-tx.sh` for validation
- Add confirmation trigger mechanism

### Phase 5: Polish
- Handle edge cases (insufficient funds, invalid addresses)
- Add debug logging throughout the flow
- Create README with setup instructions

---

## 8. File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `libs/coin-modules/coin-bitcoin/src/bridge/LocalUtxoLedger.ts` | **NEW** | Local UTXO ledger with persistence |
| `libs/coin-modules/coin-bitcoin/src/bridge/blockchainApi.ts` | MODIFY | Runtime address configuration |
| `libs/coin-modules/coin-bitcoin/src/bridge/customAccountShape.ts` | MODIFY | Read from local ledger |
| `libs/coin-modules/coin-bitcoin/src/bridge/js.ts` | MODIFY | Process send through local ledger |
| `libs/coin-modules/coin-bitcoin/src/hw-getAddress-injected.ts` | MODIFY | Multi-address injection |
| `libs/coin-modules/coin-bitcoin/src/synchronisation-injected.ts` | MODIFY | Register second derivation path |
| `scripts/off-chain-demo.sh` | **NEW** | ADB dual-device launcher |
| `scripts/validate-off-chain-tx.sh` | **NEW** | ADB validation script |
| `plans/off-chain-bitcoin-research.md` | EXISTS | Feasibility research (reference) |