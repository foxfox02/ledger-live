# Investigation: "Recovery phrase" error — Root Cause Analysis

## Log evidence (from live capture)

```
[DEBUG createBridges] CREATING with injectedResolver and injectedGetAccountShape  ✅
[DEBUG createBridges] currencyBridge built, has scanAccounts: true                ✅
[DEBUG createBridges] accountBridge built, has sync: true                        ✅
[DEBUG synchronisation-injected] getAccountShape called. currency = bitcoin,
  index = 0, derivationMode = "", hasInitialAccount = true                       ✅
[DEBUG synchronisation-injected] TAKING injected branch for index 0              ✅
```

**Missing logs:**
- NO `[DEBUG hw-getAddress-injected]` logs — the address resolver is NEVER called
- NO `[signer-injected]` logs — the mock signer context is NEVER invoked

## Root cause: Injection paths registered TOO LATE

The scan flow is:
```
1. getAddress("44'/0'/0'")  →  injectedResolver  →  shouldInjectAddress(path)
   → INJECTION_PATHS is EMPTY (paths not registered yet!)
   → Falls through to REAL device → gets real device's address
   
2. getAccountShape(...)  →  makeInjectedGetAccountShape
   → ensureInjectionPathsRegistered()  →  registerInjectionPath("44'/0'/0'")
   → NOW paths are registered, but TOO LATE — address already resolved
```

The `INJECTION_PATHS` set is populated inside `makeInjectedGetAccountShape` (called during `getAccountShape`), but `getAddress` runs BEFORE `getAccountShape` in the scan loop. So the paths are always empty when the address is first queried.

## Why the send flow fails

Since the address was resolved from the REAL device (not injected), the account that gets created has the REAL device's address, not our injected `1GR9qNz...`. When the user tries to send from this account, the signing goes to the REAL hardware device, which rejects because the derivation path doesn't match the device's seed → "recovery phrase" error.

## Why the mock signer context doesn't help

The `createMockSignerContext` wraps the signer context and intercepts `createPaymentTransaction` via `wrapSignerWithMockSigning`. But the signing step is never reached because the account itself is wrong (real device's address, not injected).

## The fix

Register injection paths at **module load time** (when `synchronisation-injected.ts` is imported), not inside `makeInjectedGetAccountShape`. This ensures paths are available BEFORE the scan starts.

### Change in `synchronisation-injected.ts`:

Move `ensureInjectionPathsRegistered()` from inside `makeInjectedGetAccountShape` to the **top level** of the module:

```typescript
// Register injection paths at module load time (before any scan)
registerInjectionPath("44'/0'/0'");
registerInjectionPath("44'/0'/0'/0/0");
```

This is a 2-line change. No other files need modification.