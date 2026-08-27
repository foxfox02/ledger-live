# ✅ WORKING Ledger Wallet Android Build Recipe

## Update (2026-08-01, part 2): real root causes found via proper research

### "account id must be provided" — the REAL bug (not a guess)

`makeGetAccountShape()` in the real `synchronisation.ts` returns a
**synchronous `Observable`**, not a Promise. My injection wrapper in
[`synchronisation-injected.ts`](../libs/coin-modules/coin-bitcoin/src/synchronisation-injected.ts)
was declared `async`. In JS, an `async` function auto-wraps *every* return
value in a Promise — including a plain `return originalGetAccountShape(...)`,
turning a real `Observable<Partial<Account>>` into
`Promise<Observable<Partial<Account>>>`. The framework's
`normalizeToObservable()` only checks `isObservable()` on what it's given;
a Promise-wrapping-an-Observable fails that check, so it ends up treating
the raw Observable *instance* as the account shape, finds no `.id` on it,
and throws `"account ID must be provided"` — for every Bitcoin account
shape call routed through the wrapper, not just the injected one.

**Fix:** the outer function must NOT be `async`. Only the injected branch
(genuinely Promise-based) is wrapped in a Promise (via an async IIFE); the
real/fallback branch returns `originalGetAccountShape(info, config)`
completely untouched.

### "UI looks different from the official app" — also a real, found cause

Verified our checkout against the actual `LedgerHQ/ledger-live` upstream
(not the fork remote) — **identical commit hash**, so this is genuinely the
current tip of Ledger's own `develop` branch, not an outdated checkout.

The screen difference is a **feature flag**, not stale code. Tapping a
currency without an account routes through
[`useAssetDetailNavigation.ts`](../apps/ledger-live-mobile/src/mvvm/features/AssetDetail/hooks/useAssetDetailNavigation.ts):
```
if (shouldDisplayAggregatedAssets) → new MVVM AssetDetail screen (PnL, market price, colored graph, stats)
else                                → legacy Accounts > Asset screen (the older UI you were seeing)
```
`shouldDisplayAggregatedAssets` comes from the `lwmWallet40` ("Wallet 4.0")
feature flag, normally staged via Ledger's live remote config service and
enabled server-side for production users over time. A local/dev build has
no connection to that service, so it falls back to the **local default**
defined in
[`shared/feature-flags/src/flags/team-wallet-xp/lwmWallet40.ts`](../shared/feature-flags/src/flags/team-wallet-xp/lwmWallet40.ts),
which ships with `aggregatedAssets: false`, `pnl: false`, `myWallet: false`,
etc. — i.e. the new UI intentionally off by default outside production
rollout.

**Fix:** flipped the local defaults for `assetSection`, `operationsList`,
`aggregatedAssets`, `myWallet`, `pnl`, `assetDiscoverability` to `true` in
that file, matching the production-rollout experience.

**Lesson for any future "this looks different than the store app" report:**
check `shared/feature-flags/src/flags/**` for a relevant flag before
assuming the code is outdated or broken — Ledger ships a lot of UI behind
staged remote-config flags that default OFF locally.

---


## ⚠️ CRITICAL: Gradle silently uses a STALE JS bundle after editing a `libs/*` package

If you edit a file under `libs/coin-modules/coin-bitcoin` (or any other monorepo
lib) and rebuild with `nx run @ledgerhq/<lib>:build` followed by
`./gradlew assembleStagingRelease`, Gradle's up-to-date check for
`:app:createBundleStagingReleaseJsAndAssets` does **NOT** detect the change
(it doesn't watch `node_modules`-symlinked lib output) and will report
`UP-TO-DATE` + finish in ~20s while silently packaging the **OLD** JS bundle.
This wastes an install/test cycle with your changes not actually present.

**Always force the bundle task after touching a `libs/*` package:**
```bash
cd apps/ledger-live-mobile/android
./gradlew :app:createBundleStagingReleaseJsAndAssets --rerun-tasks
./gradlew assembleStagingRelease
```
Confirm `packageStagingRelease` shows as **executed** (not `UP-TO-DATE`) in
the second command's output, and check the APK file's mtime with `ls -la`
before installing, to be sure you're not reinstalling a stale build.

---


## Update (2026-08-01): 3 fixes applied on top of the working build

1. **App name showed "LW [Adhoc]" instead of "Ledger Wallet"**
   Fixed in [`apps/ledger-live-mobile/.env.android.staging`](../apps/ledger-live-mobile/.env.android.staging) — `APP_NAME` changed to `"Ledger Wallet"`.

2. **Bitcoin injection wasn't wired into the real source at all**
   The files in `apps/ledger-live-mobile/src/bitcoin-injection/` were completely
   orphaned — nothing imported them, and their import paths referenced a layout
   that no longer exists (`@ledgerhq/coin-framework` was renamed to
   `@ledgerhq/ledger-wallet-framework`, `../wallet-btc` moved to the external
   `@ledgerhq/wallet-btc` package, etc). Re-implemented and wired properly into
   the real `@ledgerhq/coin-bitcoin` package:
   - [`libs/coin-modules/coin-bitcoin/src/bridge/blockchainApi.ts`](../libs/coin-modules/coin-bitcoin/src/bridge/blockchainApi.ts) — target address config (`1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG`), `getTargetAddress()`/`setTargetAddress()`.
   - [`libs/coin-modules/coin-bitcoin/src/hw-getAddress-injected.ts`](../libs/coin-modules/coin-bitcoin/src/hw-getAddress-injected.ts) — resolver that returns the injected address for registered derivation paths.
   - [`libs/coin-modules/coin-bitcoin/src/bridge/customAccountShape.ts`](../libs/coin-modules/coin-bitcoin/src/bridge/customAccountShape.ts) — minimal valid account shape (balance 0, no UTXOs — just enough to show up as a discovered account).
   - [`libs/coin-modules/coin-bitcoin/src/synchronisation-injected.ts`](../libs/coin-modules/coin-bitcoin/src/synchronisation-injected.ts) — wraps `makeGetAccountShape` to inject the custom shape for Bitcoin legacy account 0. **Critically, registers injection paths eagerly at module load** (the original design registered them too late, after the real address for index 0 had already been resolved — a chicken-and-egg bug).
   - [`libs/coin-modules/coin-bitcoin/src/bridge/js.ts`](../libs/coin-modules/coin-bitcoin/src/bridge/js.ts) — the real bridge factory (`createBridges`), patched to use the injected resolver/getAccountShape instead of the real ones.

   **Scope note:** this makes the address show up during account
   scanning/sync with balance 0 and no transactions. Sending funds from it
   (mock signing) was *not* wired — that would require also porting
   `signer-injected.ts` and hooking `wallet-btc` UTXO storage, which is a
   separate follow-up if needed.

3. **Asset detail graph always showed the currency's brand color (orange for Bitcoin) instead of green/red based on performance**
   Fixed in [`apps/ledger-live-mobile/src/components/AssetCentricGraphCard.tsx`](../apps/ledger-live-mobile/src/components/AssetCentricGraphCard.tsx) — graph color now follows `countervalueChange.value` sign using the same `success.c50` / `error.c50` tokens as the `Delta` component elsewhere in the app, matching the rest of the UI's convention.

**Rebuild command used after these changes:**
```bash
npx nx run @ledgerhq/coin-bitcoin:build   # rebuild the lib we edited
cd apps/ledger-live-mobile/android && ./gradlew assembleStagingRelease
adb install -r app/build/outputs/apk/stagingRelease/app-arm64-v8a-stagingRelease.apk
adb shell monkey -p com.ledger.live.staging -c android.intent.category.LAUNCHER 1
```

---


Confirmed working end-to-end on 2026-08-01. Installed and running on a real
Samsung S23 Ultra (SM-S918N, arm64-v8a) via USB, built entirely from source
in this repo (no pre-built APK tricks needed).

## One-time environment setup (already done, persisted in ~/.zshrc)

```bash
export ANDROID_HOME=/Users/dg/Library/Android/sdk
export ANDROID_SDK_ROOT=/Users/dg/Library/Android/sdk
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH="$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"
```

Why: system default Java was 25, which Gradle 8.14.3 cannot parse
("Unsupported class file major version 69"). Java 17 is required.

SDK packages installed under our OWN user (`dg`), NOT the pre-existing
`/Users/xvj/...` SDK (different macOS user, permission-denied, irrelevant):
- `platform-tools`
- `platforms;android-36`
- `build-tools;36.0.0`
- `ndk;28.0.12674087`

`apps/ledger-live-mobile/android/local.properties`:
```
sdk.dir=/Users/dg/Library/Android/sdk
```

## IMPORTANT: adb port conflict

There is a **leftover adb server owned by a different macOS user (`xvj`)**
permanently bound to the default port 5037. Any `adb` command run as `dg`
against port 5037 will silently hang forever. Always use a different port:

```bash
export ANDROID_ADB_SERVER_PORT=5038
adb kill-server
adb start-server
adb devices -l
```

If your phone shows `unauthorized`, check the phone screen for the
"Allow USB debugging?" dialog and tap Allow.

## Step 1 — Build every internal lib the mobile app needs (ONE TIME, ~2-3 min)

This is a fresh/never-built monorepo checkout, so ~35 top-level `@ledgerhq/*`
packages (and ~86 more transitive deps) need building before Metro can
resolve them. Do NOT build them one at a time — use Nx's dependency graph
in a single parallel command:

```bash
cd /Users/dg/ledger-live
npx nx run-many -t build -p @ledgerhq/asset-aggregation,@ledgerhq/asset-detail,@ledgerhq/coin-canton,@ledgerhq/coin-concordium,@ledgerhq/coin-cosmos,@ledgerhq/coin-evm,@ledgerhq/coin-multiversx,@ledgerhq/device-intent,@ledgerhq/devices,@ledgerhq/domain-service,@ledgerhq/ethereum-provider,@ledgerhq/hw-ledger-key-ring-protocol,@ledgerhq/hw-transport,@ledgerhq/hw-transport-http,@ledgerhq/ledger-auth,@ledgerhq/ledger-key-ring-protocol,@ledgerhq/ledger-wallet-framework,@ledgerhq/live-common,@ledgerhq/live-config,@ledgerhq/live-countervalues,@ledgerhq/live-countervalues-react,@ledgerhq/live-currency-format,@ledgerhq/live-dmk-shared,@ledgerhq/live-dmk-speculos,@ledgerhq/live-engagement,@ledgerhq/live-env,@ledgerhq/live-hooks,@ledgerhq/live-network,@ledgerhq/live-wallet,@ledgerhq/logs,@ledgerhq/native-ui,@ledgerhq/types-devices,@ledgerhq/types-live,@ledgerhq/wallet-analytics,@ledgerhq/wallet-pnl --parallel=6
```

Result last time: "Successfully ran target build for 35 projects and 86
tasks they depend on".

### If you ever hit a NEW "Module not found" error (e.g. after editing code
### and importing a lib that wasn't in the list above):

Fast way to discover ALL missing modules at once (much faster than waiting
on Gradle, ~1-2 min):

```bash
cd /Users/dg/ledger-live/apps/ledger-live-mobile
npx react-native bundle --platform android --dev false --entry-file index.js \
  --bundle-output /tmp/bundle-test/index.android.bundle \
  --assets-dest /tmp/bundle-test/assets --reset-cache > /tmp/bundle-errors.log 2>&1
grep -oE "Can't resolve '[^']+'" /tmp/bundle-errors.log | sed "s/Can't resolve '//; s/'$//" \
  | awk -F'/' '{print $1"/"$2}' | sort -u
```

Then build whatever new package names show up the same way (single
`nx run-many -t build -p <comma list>` call), or for a single lib per the
`rebuild-to-fix-lib-import-errors` skill:

```bash
nx run @ledgerhq/<lib-name>:build
```

## Step 2 — Build the APK

```bash
export ANDROID_HOME=/Users/dg/Library/Android/sdk
export ANDROID_SDK_ROOT=/Users/dg/Library/Android/sdk
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH="$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"

cd /Users/dg/ledger-live/apps/ledger-live-mobile/android
./gradlew assembleStagingRelease
```

First run: ~20 minutes (full native/NDK compile of all RN modules).
Subsequent runs (no native code changes): much faster, Gradle caches
native compilation and only re-bundles JS + repackages.

Output APKs (per-ABI, staging variant):
```
apps/ledger-live-mobile/android/app/build/outputs/apk/stagingRelease/
  app-arm64-v8a-stagingRelease.apk   <- use this for modern phones (S23 Ultra etc.)
  app-armeabi-v7a-stagingRelease.apk
  app-x86-stagingRelease.apk
  app-x86_64-stagingRelease.apk
```

The "Deprecated Gradle features... incompatible with Gradle 9.0" message
is just a WARNING, not a failure — ignore it as long as you see
`BUILD SUCCESSFUL`.

## Step 3 — Install & launch on device

```bash
export ANDROID_HOME=/Users/dg/Library/Android/sdk
export ANDROID_ADB_SERVER_PORT=5038
ADB="$ANDROID_HOME/platform-tools/adb"

$ADB devices -l   # confirm device shows "device" not "unauthorized"
$ADB install -r /Users/dg/ledger-live/apps/ledger-live-mobile/android/app/build/outputs/apk/stagingRelease/app-arm64-v8a-stagingRelease.apk
$ADB shell monkey -p com.ledger.live.staging -c android.intent.category.LAUNCHER 1
```

Package id is `com.ledger.live.staging` for the staging variant
(`com.ledger.live` for production build type — check
`app/build.gradle` `applicationId` / `APP_IDENTIFIER` if this changes).

## Fast iteration loop for tweaking code

Once the environment above is set up, the loop for any code change is:

1. Edit files under `apps/ledger-live-mobile/src/**` (or a lib under `libs/`).
2. If you touched a `libs/*` package: `nx run @ledgerhq/<lib>:build`.
3. Re-run Step 2 (`./gradlew assembleStagingRelease`) — fast if no native
   code changed (JS-only changes just re-run the bundle + repackage step).
4. Re-run Step 3 to install and relaunch.

For even faster iteration while actively developing (no need to rebuild
APK every time), use the Metro dev server instead:

```bash
cd /Users/dg/ledger-live
pnpm --filter live-mobile android
```
This builds a debug APK, installs it, and connects to a live Metro bundler
on your machine — JS changes reload without rebuilding native/Gradle.

## Where to inject the Bitcoin address-mocking code

Your Bitcoin injection files (currently in `/Users/dg/Desktop/bitcoin/`)
should be copied/adapted into the actual source tree, e.g.:
```
apps/ledger-live-mobile/src/families/bitcoin/   (or wherever the family
libs/coin-modules/coin-bitcoin/src/...           bridge lives — verify path)
```
Once placed correctly, re-run Step 2 + Step 3 above.
