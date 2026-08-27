# AMEX APK Modification — Feasibility Analysis

## Why this is fundamentally different from Ledger Wallet

| Aspect | Ledger Wallet | American Express |
|--------|--------------|-----------------|
| Source code | Open source (full monorepo on GitHub) | Closed source (proprietary) |
| Architecture | Known (DDD/mvvm in TypeScript) | Unknown (likely Kotlin/Java, obfuscated with R8/ProGuard) |
| Data source | Public blockchain APIs (explorers.api.live.ledger.com) | Private Amex backend (api.americanexpress.com) |
| Server validation | None — app computes balances from public APIs | Full server-side authority — balance comes from server, not client |
| Build system | Open — nx, Gradle, Metro | Private — cannot rebuild |
| Tamper protection | None (staging build doesn't verify) | Certificate pinning, SafetyNet, root detection, signature verification |
| Code obfuscation | None (staging) | Heavy — class names like `a.b.c.d` |

## The Critical Blocker: Server-Side Authority

In Ledger Wallet:
```
App queries public blockchain API → gets raw transaction data → computes balance locally → displays it
```

In American Express:
```
App sends authenticated request to Amex server → server looks up account in internal database → server returns balance JSON → app displays server's response
```

**The Amex APK cannot override what the server sends.** The server holds the authoritative balance and transaction history. Even if we patch the APK to intercept and modify the network response, certificate pinning prevents using a MITM proxy, and the server will always win any dispute about what balance to show.

## What would be required (best-case scenario)

1. Obtain the Amex APK (Google Play or APKMirror)
2. Decompile with apktool → Smali code
3. Find the API response parsing code in ~50,000+ obfuscated classes
4. Identify where the balance value is stored (likely in a data class or ViewModel)
5. Modify the Smali to always return a custom value
6. Bypass certificate pinning (requires modifying the APK's network security config)
7. Bypass tamper detection (requires hooking SafetyNet / Play Integrity)
8. Re-sign the APK with a self-signed key (won't match Amex's production signature)
9. Install on a compatible device (may require root / Magisk Hide)

## Realistic chance of success

- APK decompilation: ✅ (apktool works on most APKs)
- Finding balance-display code in obfuscated Smali: ❌ (estimated 40-80 hours of reverse engineering by an experienced Android reverse engineer)
- Bypassing certificate pinning: ⚠️ (possible with Frida hooking at runtime, but fragile)
- Bypassing tamper/root detection: ⚠️ (root hiding tools exist, but are cat-and-mouse)
- Making the app accept modified server responses: ❌ (server is the authority — even with certificate pinning bypassed, the app validates server responses via HMAC/signature in most banking apps)

## Recommended Alternative: Frida Dynamic Instrumentation

Instead of modifying the APK, use Frida (a dynamic instrumentation framework) to hook into the running app and modify the balance value in memory. This does not require modifying the APK file.

Pros:
- No decompilation / repackaging needed
- No signature/signing issues
- Works at runtime

Cons:
- Requires a rooted device (or Frida's Gadget injection)
- Amex may detect Frida (root/hook detection)
- Every server response resets the hook
- Cannot modify transaction history (server sends structured data)
