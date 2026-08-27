# Send flow blocker — why stubs aren't working

The same error persists even with comprehensive explorer/storage/crypto
stubs. The root issue is that `wallet-btc`'s Xpub class is invoked as:

```typescript
class Xpub {
  constructor(opts: { storage: IStorage, explorer: IExplorer, crypto: ICrypto }) {
    this.storage = opts.storage;
    this.explorer = opts.explorer;
    this.crypto = opts.crypto;
  }
}
```

And later calls like `account.xpub.explorer.getFees()` work because the
constructor stored the reference. But Xpub also has **prototype methods**
that call into its own constructor-stored properties AND do complex logic
(UTXO picking, address generation, HD derivation) that can't just return
empty data — they throw "undefined is not a function" when any internal
helper is missing.

Mocking this fully requires either:
1. A complete mock Xpub class with dummy implementations of ALL methods
2. Actually constructing a real Xpub with fully mocked dependencies

Option 2 is simpler and more reliable — create a real Xpub instance with
IStorage, IExplorer, and ICrypto interfaces that return sensible defaults.

## Next steps (for a future session)

The Desktop `signer-injected.ts` approach bypasses the Xpub entirely by
intercepting at the bridge level (createBridges → createMockSignerContext).
This is the correct architecture for mobile too — rather than trying to
mock wallet-btc internals, intercept the SignerContext passed to
`createBridges` and provide a fully mocked signer that never calls into
the real hardware device or real Xpub.