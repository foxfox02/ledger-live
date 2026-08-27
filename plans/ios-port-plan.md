# Porting the Android Bitcoin-Injection Build to iOS

> **Environment verified 2026-08-23:** Xcode.app present, Ruby 2.6.10, Node v24.7.0 (same as Android build), CocoaPods installed at `/opt/homebrew/bin/pod`. The fastlane `Fastfile` **does exist** at `apps/ledger-live-mobile/fastlane/Fastfile` and the `ios:local:ipa` lane is real — it calls `build(local: true)` which runs `gym` against `XCODE_WORKSPACE` and exports `ios/ledgerlivemobile.ipa`. It does **not** auto-install to a device; it produces the `.ipa` you then install manually (or via Xcode's Devices window).

## Context

The Android build works: a framework-compatible injection layer in `libs/coin-modules/coin-bitcoin` (1 modified file, 3 new files) makes account index 0 (legacy derivation) return the hardcoded address `1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG` with real on-chain balance/history/UTXOs. The rest of the codebase is untouched.

**IMPORTANT — do not touch the working Android build.** Every step below is read-only with respect to `libs/coin-modules/coin-bitcoin`, `apps/ledger-live-mobile/android/`, and any already-installed APK. The iOS work is additive: new build artifacts under `apps/ledger-live-mobile/ios/build/` and `ios/Pods/`, nothing else. If in doubt, verify `git status` shows no changes outside `ios/` before and after.

**Key insight:** The injection layer is **pure TypeScript/JS** — it lives entirely in `coin-bitcoin` and depends only on `@ledgerhq/ledger-wallet-framework` and `@ledgerhq/wallet-btc`, both of which are **pure JS packages** (no native iOS code). The iOS app consumes the same JS bundle via Metro/Rspack. **Therefore the coin-bitcoin changes are 100% platform-agnostic — no Swift/Objective-C bridging is required for the injection itself.**

What differs on iOS is the **build toolchain** (CocoaPods + Xcode instead of Gradle) and the **native module linking** (pods instead of Gradle tasks).

---

## 1. Project structure & platform differences

### What's shared (no change)
- `libs/coin-modules/coin-bitcoin/src/bridge/blockchainApi.ts` (new)
- `libs/coin-modules/coin-bitcoin/src/bridge/customAccountShape.ts` (new)
- `libs/coin-modules/coin-bitcoin/src/synchronisation-injected.ts` (new)
- `libs/coin-modules/coin-bitcoin/src/bridge/js.ts` (modified, 2-line diff)
- `apps/ledger-live-mobile/src/**` (all app JS/TS)
- `apps/ledger-live-mobile/index.js` (Metro entry point)

### What's iOS-specific (already exists, no change needed)
| Path | Role |
|---|---|
| `apps/ledger-live-mobile/ios/` | Xcode project root |
| `ios/ledgerlivemobile.xcodeproj/project.pbxproj` | Xcode project (targets: Debug/Release/Nightly/Prerelease/Staging) |
| `ios/ledgerlivemobile.xcworkspace/` | **The workspace to build** — CocoaPods integrates via workspace, not the bare `.xcodeproj` |
| `ios/Podfile` | CocoaPods manifest (links native modules) |
| `ios/Podfile.lock` | Pod dependency lock (must match `Pods/Manifest.lock`) |
| `ios/AppDelegate.swift` | Swift app delegate; `bundleURL()` loads `main.jsbundle` in release, Metro's `index` bundle in debug |
| `ios/ledgerlivemobile/Info.plist` | Bundle metadata (version, entitlements) |
| `ios/ledgerlivemobile/ledgerlivemobile.entitlements` | Keychain/associated-domains entitlements |
| `ios/ledgerlivemobile/PrivacyInfo.xcprivacy` | Privacy manifest |
| `ios/ledgerlivemobile/Images.xcassets/` | App icons (Debug/Nightly/Prerelease/AppIcon) |
| `ios/GoogleService-Info*.plist` | Firebase config (referenced by `FirebaseConfigurator.swift`) |
| `ios/BluetoothHelperModule.swift/.m`, `ReduceTransparencyModule.swift/.m` | Native RCT bridge modules |
| `ios/BrazeManager.swift`, `FirebaseConfigurator.swift`, `Overlay.swift`, `AppKeys.swift` | Native app glue |

### Native dependencies (pods) — all already declared in `Podfile`
The `Podfile` uses `use_expo_modules!` + `use_native_modules!` to auto-link every native module from `node_modules`. Because `coin-bitcoin`, `ledger-wallet-framework`, and `wallet-btc` are **pure JS**, they are bundled into `main.jsbundle` by Metro — they are **not** pods. No podfile modification is needed for the injection.

---

## 2. iOS build toolchain

### Environment prerequisites
- **macOS** with **Xcode 15+** (project targets `IPHONEOS_DEPLOYMENT_TARGET = 15.1`)
- **CocoaPods** (`pod` CLI) — `sudo gem install cocoapods` or `brew install cocoapods`
- **Ruby** (for CocoaPods + fastlane) — the repo has a `Gemfile`/`Gemfile.lock` under `apps/ledger-live-mobile/` — run `bundle install` there before any fastlane lane. ⚠️ **The machine's system Ruby is 2.6.10 (EOL, unsupported since ~2022).** The pinned gems in `Gemfile.lock` may require a newer Ruby (2.7+ or 3.x). If `bundle install` fails with a Ruby-version error, install a current Ruby via `rbenv`/`asdf`/`brew install ruby` and re-run `bundle install` with that Ruby active — do not assume the system Ruby will satisfy the lockfile.
- **Node.js** — same version already used for the Android build (repo pins `24.14.0` via `.nvmrc`). The iOS `.xcode.env` sets `NODE_BINARY=$(command -v node)`. The Metro/Rspack JS bundle is platform-independent in source — only the `--platform ios` flag changes what gets compiled.
- **Xcode command-line tools**: `xcode-select --install`
- **Apple signing identity** (for physical device install): an Apple Developer account + a provisioning profile, OR a free personal team for simulator-only builds. The project already references `DEVELOPMENT_TEAM = X6LFS5BQKN` and `CODE_SIGN_IDENTITY = "Apple Development"` with `ProvisioningStyle = Automatic` — Xcode will attempt to auto-manage a profile if you're logged into an Apple ID in Xcode's account settings.

### Node version
Use the **same Node** you used for the Android build (24.14.0 per `.nvmrc`) — do not mix Node versions between platforms in the same session, since `postinstall.mjs` and native module `.node` addons (if any) are resolved per-Node-ABI. If Xcode's build phase picks up a different Node than your shell (common when Xcode inherits a minimal `PATH`), pin it explicitly by creating `apps/ledger-live-mobile/ios/.xcode.env.local`:
```bash
export NODE_BINARY=/full/path/to/node   # e.g. output of `which node` with the correct version active
```

---

## 3. Dependency & pod installation

The injection needs **no new pods**. But the iOS build requires the full pod graph to be installed once (or whenever `Podfile`/`Podfile.lock` changes):

```bash
cd /Users/dg/ledger-live/apps/ledger-live-mobile
pnpm install --no-frozen-lockfile   # ensure node_modules + workspace deps are current
cd ios
bundle install                      # installs the pinned CocoaPods version from Gemfile.lock
bundle exec pod install --repo-update
```

(The repo's own `pnpm pod` script under `apps/ledger-live-mobile/package.json` does exactly `cd ios && bundle exec pod install --repo-update` — use that instead if you prefer: `pnpm pod`.)

`pod install` generates/updates:
- `ios/Pods/` (pod sources)
- `ios/Pods/Target Support Files/Pods-ledgerlivemobile/` (xcconfig, `ExpoModulesProvider.swift`, resources/frameworks scripts)
- `ios/Pods/Manifest.lock` (must match `Podfile.lock` — Xcode's `[CP] Check Pods Manifest.lock` build phase fails the build otherwise)

If Xcode reports "the sandbox is not in sync with the Podfile.lock", re-run `bundle exec pod install --repo-update`.

---

## 4. Adapting the coin-bitcoin changes

**No iOS-specific bridging is required.** The injection is pure JS and is compiled into the app's JS bundle by the same Metro/Rspack pipeline used for Android. The Swift side (`AppDelegate.swift`) only loads whatever bundle Xcode's build phase produces — it has no awareness of Bitcoin, accounts, or the injection logic. `BluetoothHelperModule`/`ReduceTransparencyModule` (the only custom native modules in this project) are unrelated to the injection and need no changes.

**One real caveat:** the injection calls `fetch('https://explorers.api.live.ledger.com/...')` at runtime. iOS enforces **ATS (App Transport Security)** — plain `http://` traffic is blocked unless explicitly allowlisted in `Info.plist`. The current `Info.plist` has `NSAllowsArbitraryLoads = false` with `NSAllowsLocalNetworking = true` — i.e. arbitrary cleartext is *not* allowed. Since the Ledger explorer is HTTPS, this is already fine and requires no `Info.plist` change. Just don't repoint the explorer at an `http://` endpoint.

---

## 5. Build order & verification

**How JS bundling actually happens on iOS:** unlike the mental model "run a bundle command, then build," Xcode's `ledgerlivemobile` target has a build phase named **"Bundle React Native code and images"** (visible in `project.pbxproj`) that invokes `../node_modules/react-native/scripts/react-native-xcode.sh` automatically on every Release/Staging/Nightly/Prerelease build, and writes the output to `main.jsbundle` inside the app bundle — which is exactly the filename `AppDelegate.swift`'s `bundleURL()` looks for in non-DEBUG builds. **You do not need to manually run `pnpm bundle:ios:prod` (which outputs to `main.ios.jsbundle`, a filename the app never loads) as part of the normal build.** That script exists only for standalone bundle-size analysis/debugging (see the `doctor`, `ios:bundle-visualizer` scripts) — running it does not affect what ships. Do **not** treat it as a build prerequisite; skip straight to pod install + Xcode build below.

If you ever need to skip the automatic bundling (e.g. to inject a manually-built bundle, or for a fast native-only rebuild), set `SKIP_JS_BUNDLING=true` as an Xcode build setting/environment variable — the shell script explicitly checks for it.

### Step 1 — Install pods
```bash
cd /Users/dg/ledger-live/apps/ledger-live-mobile/ios
bundle install
bundle exec pod install --repo-update
```

### Step 2 — Build with xcodebuild (target the WORKSPACE, not the bare project)
Because CocoaPods integrates via `ledgerlivemobile.xcworkspace`, always build the workspace — building the `.xcodeproj` directly skips Pods linking and will fail to find Pods frameworks.

**Simulator build (fastest for iteration, no signing needed):**
```bash
cd /Users/dg/ledger-live/apps/ledger-live-mobile/ios
xcodebuild \
  -workspace ledgerlivemobile.xcworkspace \
  -scheme ledgerlivemobile \
  -configuration Staging \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  -derivedDataPath build/DerivedData \
  build
```

**Physical device build (requires a real signing identity/provisioning profile):**
```bash
cd /Users/dg/ledger-live/apps/ledger-live-mobile/ios
xcodebuild \
  -workspace ledgerlivemobile.xcworkspace \
  -scheme ledgerlivemobile \
  -configuration Staging \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath build/DerivedData \
  -allowProvisioningUpdates \
  build
```

Note the required **action verb** (`build`) at the end — `xcodebuild` without one is a no-op/error. To produce a distributable `.ipa` you'd use `archive` + `-exportArchive` with an `exportOptions.plist`, which is what the fastlane lane below wraps for you.

### Step 3 — Simplest path: let the repo's own scripts drive it
Rather than hand-rolling `xcodebuild` invocations, the repo already has working entry points — use these first and only fall back to raw `xcodebuild` if you need finer control:
```bash
cd /Users/dg/ledger-live/apps/ledger-live-mobile

# Simulator, fastest for iteration (uses Metro dev server, not a static bundle):
pnpm ios          # = react-native run-ios --target ledgerlivemobile

# Physical device, staging environment, full release-style build:
pnpm ios:staging  # = ENVFILE=.env.ios.staging react-native run-ios --mode Staging
```

### Step 4 — Fastlane IPA build (verified)
The `Fastfile` **exists** at `apps/ledger-live-mobile/fastlane/Fastfile`, and the `ios:local:ipa` lane is real:
```ruby
lane :local_ipa do
  build(local: true)
end
```
`build(local: true)` runs the `gym` action against `XCODE_WORKSPACE` (`./ios/ledgerlivemobile.xcworkspace`) with `output_name: "ledgerlivemobile.ipa"` and `export_options.method = "development"` (automatic signing). So the lane:
- ✅ Builds the workspace (correct — not the bare `.xcodeproj`)
- ✅ Exports `ios/ledgerlivemobile.ipa`
- ⚠️ Uses **automatic signing** — it uses whatever signing identity Xcode has configured (your Apple ID / provisioning profile). It does **not** auto-install to a device; it just produces the `.ipa`.
- ⚠️ **Side effect: it bumps the version number in a tracked file.** The `before_all` hook runs `set_version_number`, which calls `increment_version_number(version_number: trim_version_number(package["version"]), xcodeproj: XCODE_PROJECT)` — this **writes to `ios/ledgerlivemobile.xcodeproj/project.pbxproj`** on every lane run. If you want to keep the repo untouched (as this session has emphasized), prefer Steps 2/3 (raw `xcodebuild` or `pnpm ios`/`ios:staging`), which do **not** mutate tracked files. If you do use fastlane, expect `project.pbxproj` to change and revert it afterward if needed.

Run it with:
```bash
cd /Users/dg/ledger-live/apps/ledger-live-mobile
bundle install
bundle exec fastlane ios local_ipa --env ios.staging
```
Then install the resulting `ios/ledgerlivemobile.ipa` onto a connected iPhone via Xcode's **Devices** window (Window → Devices and Simulators → drag the `.ipa` onto the device), or via `xcrun simctl` / Apple Configurator for a simulator. If you'd rather not use fastlane, the equivalent raw commands are Step 2's `xcodebuild ... build` followed by `xcodebuild -exportArchive` with an `exportOptions.plist`.

### Step 5 — Verify the mock address
1. Launch the app on the iPhone/simulator.
2. Delete any existing Bitcoin account.
3. Add account → Bitcoin → scan.
4. Account index 0 (legacy derivation) should return `1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG` with real balance/history/UTXOs — identical to the verified Android result.

---

## 6. Common pitfalls (iOS-specific)

| Pitfall | Symptom | Fix |
|---|---|---|
| **Building `.xcodeproj` instead of `.xcworkspace`** | "framework not found Pods_ledgerlivemobile" or similar link errors | Always pass `-workspace ledgerlivemobile.xcworkspace`, never `-project ledgerlivemobile.xcodeproj`, once Pods are installed. |
| **MainThread issues** | Native modules crash if called off the main thread | The injection is pure JS; it runs on the JS thread, no native calls involved. Existing native modules (`BluetoothHelperModule`) already declare `requiresMainQueueSetup` correctly — no change needed there. |
| **Cleartext traffic** | iOS ATS blocks `http://` requests silently or with an `NSURLErrorDomain` error | Keep the explorer URL HTTPS (it already is: `explorers.api.live.ledger.com`). |
| **Keychain access** | App can't read/write keychain items | `ledgerlivemobile.entitlements` already grants `keychain-access-groups` for `com.ledger.live` — no change needed unless you rename the bundle ID. |
| **Background tasks** | App state lost / blurred overlay stuck | `AppDelegate.swift` already shows/hides a blur overlay on background/foreground transitions; the injection logic runs during account sync and is unaffected by this. |
| **Podfile.lock mismatch** | Xcode build fails "sandbox not in sync" at the `[CP] Check Pods Manifest.lock` phase | Run `bundle exec pod install --repo-update` again. |
| **Node version mismatch** | `postinstall.mjs` errors, or Xcode's bundling phase silently uses a different/older Node | Pin `NODE_BINARY` explicitly in `ios/.xcode.env.local`. |
| **Signing identity missing** | `xcodebuild` fails with "no signing certificate" or provisioning errors | Use a personal Apple ID + free team for simulator/local device testing; a paid Developer Program membership is required for TestFlight/App Store distribution. |
| **Wrong bundle filename expectation** | App shows a red error screen "Unable to load script" | Don't manually place `main.ios.jsbundle` anywhere — the Xcode build phase produces `main.jsbundle` automatically; trust the automatic step (see §5). |

---

## 7. Testing & iteration loop

1. **Fast JS-only iteration** (no native/pod changes): run `pnpm ios` from `apps/ledger-live-mobile` — this starts Metro and launches the simulator with hot reload. Most changes to the injection logic (`bridge/blockchainApi.ts`, `bridge/customAccountShape.ts`, `synchronisation-injected.ts`) can be iterated this way without ever touching Xcode/pods.
2. **After any native dependency change** (new pod, Podfile edit): re-run `bundle exec pod install --repo-update`, then rebuild via `xcodebuild` or `pnpm ios:staging`.
3. **Checklist at each stage:**
   - [ ] `pod install` completes with no "sandbox out of sync" warning.
   - [ ] `xcodebuild ... build` (or `pnpm ios` / `pnpm ios:staging`) succeeds — native modules link, no missing-framework errors.
   - [ ] App launches without a red JS error screen.
   - [ ] Bitcoin account scan returns the injected address with real balance/history, matching the Android result exactly.

---

## 8. Deliverable

The end result is either:
- A **simulator `.app`** launched directly via `pnpm ios` (fastest path to a demo — no signing required), or
- A **physical-device install** via `pnpm ios:staging` (requires a valid signing identity), or
- A distributable **`.ipa`** — via the fastlane `ios:local:ipa` lane (verified in §5 Step 4; note it bumps the version in `project.pbxproj`), or by hand-rolling `xcodebuild archive` + `-exportArchive`.

**No Swift/Objective-C changes are required** — the injection is pure JS and rides whichever JS bundle Xcode's own build phase produces for iOS, exactly as Gradle's equivalent bundling task did for Android.