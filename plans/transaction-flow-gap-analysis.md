# Transaction Flow — Desktop APK vs Our Build (Gap Analysis)

## Complete call chain for sending a transaction

```
User taps "Send" → enters recipient → enters amount → reviews fees → taps "Continue"
  → signOperation.ts:executeSignOperation()
    → buildTransaction(account, transaction)     ← OUR BYPASS (Option B) ✅
    → calculateFees(account, transaction)         ← OUR BYPASS (Option B) ✅
    → signerContext(deviceId, currency, signer => 
        signAccountTx({ btc: signer, ... }))      ← SIGNING STEP ⚠️
          → btc.splitTransaction(...)              ← calls mock signer
          → btc.createPaymentTransaction(...)      ← calls mock signer
    → buildOptimisticOperation(...)               ← creates the operation object
    → broadcast({ account, signedOperation })     ← BROADCAST STEP ⚠️
      → getWalletAccount(account)                 ← needs walletAccount
      → wallet.broadcastTx(walletAccount, ...)    ← calls real explorer
```

## What our current build handles

| Step | Status | How |
|------|--------|-----|
| Recipient entry | ✅ | `buildTransaction` bypass (Option B) |
| Amount entry | ✅ | `buildTransaction` bypass (Option B) |
| Fee estimation | ✅ | `buildTransaction` bypass (Option B) |
| Summary screen | ✅ | `buildTransaction` bypass (Option B) |
| **Signing (device interaction)** | ⚠️ | Mock signer context in `js.ts` — but `splitTransaction` returns empty inputs/outputs |
| **Broadcast** | ⚠️ | `broadcast.ts` calls `getWalletAccount()` → needs real walletAccount |

## What the Desktop APK does differently

### 1. Mock Signer Context (signer-injected.ts)
The Desktop APK has a complete `createMockBitcoinSigner()` that returns a fully functional mock signer:

```typescript
function createMockBitcoinSigner(): BitcoinSigner {
  return {
    getWalletXpub: async () => "xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5",
    getWalletPublicKey: async (path, opts) => ({ publicKey: "...", bitcoinAddress: TARGET_BITCOIN_ADDRESS, chainCode: "..." }),
    signMessage: async (path, messageHex) => ({ v: 0, r: "...", s: "..." }),
    splitTransaction: (hex, segwit, hasExtra, additionals) => ({
      version: Buffer.from([0x01, 0x00, 0x00, 0x00]),
      inputs: [],
      outputs: [],
      locktime: Buffer.from([0x00, 0x00, 0x00, 0x00]),
    }),
    createPaymentTransaction: async (params) => generateMockSignature(params.inputs),
  };
}
```

### 2. Mock Device ID (js-injected.ts)
The Desktop APK defines `MOCK_DEVICE_ID` and checks for it in `createMockSignerContext`:

```typescript
export const MOCK_DEVICE_ID = "mock_device_injection";

export function createMockSignerContext(originalContext: SignerContext): SignerContext {
  return async <T>(deviceId, crypto, fn) => {
    if (deviceId === MOCK_DEVICE_ID) {
      return fn(createMockBitcoinSigner());  // ← bypass hardware entirely
    }
    return originalContext(deviceId, crypto, fn);
  };
}
```

### 3. Mock Signature Generation (signer-injected.ts)
The Desktop APK generates a realistic-looking hex signature:

```typescript
function generateMockSignature(txInputs): string {
  // Builds a complete mock transaction hex with:
  // - Version (4 bytes)
  // - Input count + mock inputs (prev tx hash, output index, script, sequence)
  // - Output count + mock outputs (amount, script)
  // - Locktime
  return version + inputCount + inputs + outputCount + outputs + locktime;
}
```

### 4. Broadcast Bypass (js-injected.ts)
The Desktop APK wraps broadcast to reset the fee cache:

```typescript
const wrappedBroadcast = async ({ account, signedOperation }) => {
  calculateFees.reset();
  return broadcast({ account, signedOperation });
};
```

### 5. Persistent State (persistentState.ts)
The Desktop APK saves/restores account state across app sleep/wake cycles using localStorage. This is browser-specific and not needed for React Native.

### 6. Mock Signature Utilities (mockSignature.ts)
The Desktop APK provides:
- `generateMockTxHash()` — creates a deterministic mock tx hash
- `generateMockSignature()` — creates a random hex signature
- `shouldUseMockSignature()` — checks if the account should use mock signing
- `simulateDeviceReviewDelay()` — simulates device review time
- `simulateUserApprovalDelay()` — simulates user approval time
- `simulateSignatureGenerationDelay()` — simulates signature generation time

## What we need to add for full transaction flow

### Priority 1: Complete the mock signer in js.ts
Our current mock signer in `js.ts` (lines 129-145) is incomplete:
- `splitTransaction` returns empty inputs/outputs — this causes `signAccountTx` to fail because it needs real input data to build the signing request
- `createPaymentTransaction` returns a hardcoded string — this should return a proper mock hex signature

**Fix:** Update the mock signer in `js.ts` to match the Desktop's `createMockBitcoinSigner()`:
- `splitTransaction` should return a minimal valid transaction structure
- `createPaymentTransaction` should return a realistic-looking hex signature

### Priority 2: Add mock broadcast
The `broadcast.ts` calls `getWalletAccount(account)` which requires a valid `walletAccount` in `bitcoinResources`. Our custom account shape already provides this (via the Xpub mock in `customAccountShape.ts`), but the broadcast step also calls `wallet.broadcastTx(walletAccount, signature)` which tries to actually broadcast to the network.

**Fix:** Add a mock broadcast wrapper in `js.ts` that returns a fake tx hash instead of actually broadcasting:

```typescript
const wrappedBroadcast = async ({ account, signedOperation }) => {
  if ((account as BitcoinAccount).freshAddress === getTargetAddress()) {
    return patchOperationWithHash(signedOperation.operation, "mock_txid_" + Date.now());
  }
  return broadcast({ account, signedOperation });
};
```

### Priority 3: Wire the mock signer context properly
Our `createBridges` already wraps the signer context (lines 123-148), but it doesn't check for a mock device ID — it ALWAYS returns the mock signer. This means even real accounts would get mock signatures.

**Fix:** Add a `MOCK_DEVICE_ID` check similar to the Desktop's `createMockSignerContext`:

```typescript
const wrappedSignerContext: SignerContext = async (deviceId, crypto, fn) => {
  if (deviceId === MOCK_DEVICE_ID || (account as any).freshAddress === getTargetAddress()) {
    return fn(mockSigner);
  }
  return signerContext(deviceId, crypto, fn);
};
```

## Summary

| Component | Our Build | Desktop APK | Gap |
|-----------|-----------|-------------|-----|
| Address injection | ✅ | ✅ | None |
| Account shape | ✅ | ✅ | None |
| Send flow (recipient→summary) | ✅ | ✅ | None |
| Mock signer | ⚠️ Partial | ✅ Complete | `splitTransaction` + `createPaymentTransaction` need proper mocks |
| Mock broadcast | ❌ Missing | ✅ Wrapped | Need mock broadcast for injected address |
| Mock device ID | ❌ Missing | ✅ `MOCK_DEVICE_ID` | Need device ID check in signer context |
| Persistent state | ❌ Missing | ✅ localStorage | Not needed for React Native |
| Mock signature utils | ❌ Missing | ✅ `mockSignature.ts` | Nice to have for realistic delays |