# Send flow mock signer — what needs to be done

The send flow requires a fully functional wallet-btc runtime
(Xpub → explorer, storage, crypto) to compute fees, validate
recipients, build transactions, estimate max spendable, and sign.

Our current `mockWalletAccount` in `customAccountShape.ts` has
minimal stubs that get past `AccountNeedResync` and `getFees`,
but `getTransactionStatus` → `computeFees` (and other codepaths)
call deeper into the Xpub stack. The error "undefined is not a
function" at Continue means one more Xpub method is missing.

## Option A: Incrementally add more stubs (iterative, ~2-3 builds)

1. Use `adb logcat -v time ReactNativeJS:V *:S` during the error to
   capture the exact stack trace showing WHICH method is `undefined`.
2. Add a stub for that method to the `mockWalletAccount.xpub` object.
3. Rebuild → retest → repeat for each missing method.

Estimated missing methods based on `getTransactionStatus`:
- `explorer.getTxHex` (or similar)
- `crypto.toOutputScript` (or similar)  
- `storage.getAddressUnspentUtxos` returning actual UTXO data
- Possibly `explorer.getFees` returning more complete data

## Option B: Port the Desktop mock signer (comprehensive, ~1 session)

The Desktop injection files include:
- `signer-injected.ts` — wraps the real Bitcoin signer to inject
  mock signatures and bypass hardware signing entirely
- `mockSignature.ts` — produces fake signatures for the injected
  address so the signed transaction hex looks valid enough to
  complete the flow (doesn't need to be broadcastable)

Porting these to mobile would replace our current `createBridges`
approach with the full `createInjectedBridges` pattern that
intercepts signing at the bridge level rather than trying to mock
internals of the wallet-btc Xpub.

## Recommended approach

Start with **Option A first** (capture logcat error, add one stub,
rebuild). This is cheap (~2 builds). If the chain of missing
methods is too deep (5+ iterations), switch to Option B.

Both options require the same log capture technique:
```bash
adb -s R3CW20A32RH logcat -v time ReactNativeJS:V *:S
```
Then reproduce the error to see the exact stack trace.