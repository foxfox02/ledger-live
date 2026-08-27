# Plan: Separate Android + iOS into portable zips on the Desktop

> **Status:** Plan only — nothing in the repo will be altered by this document.
> Execution requires Code mode (creating zip files on the Desktop and staging copy dirs).

## 1. Goal

Produce **two self-contained zips** on the Desktop, plus a small shared-injection zip:

1. **`ledger-wallet-android.zip`** — the working Android APK + all Android source/tooling needed
   to rebuild it on another machine.
2. **`ledger-wallet-ios.zip`** — the working iOS app bundle + all iOS source/tooling needed to
   rebuild it on another machine.
3. **`ledger-wallet-shared-injection.zip`** — the platform-agnostic coin-bitcoin injection source +
   the working APK/.app so you can reapply the feature on a fresh clone.

The intent (from the user): **carry both platforms to other devices/machines and keep developing
them**, while keeping the Android and iOS versions cleanly separated.

## 2. The honest constraint: this is a pnpm/Nx monorepo

`apps/ledger-live-mobile` does **not** stand alone. It imports ~150 workspace packages
(`@ledgerhq/coin-bitcoin`, `@ledgerhq/live-common`, `@domain/*`, `@features/*`, etc.) via
`workspace:` protocol (see `apps/ledger-live-mobile/package.json`). A zip that can **rebuild from
source elsewhere** must therefore include:

- the repo root: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `pnpm-lock.yaml`, `.nvmrc`,
  `mise.toml`, `nx.json`, `tsconfig.*`, `.pnpmfile.cjs`, patches/
- the `apps/ledger-live-mobile/` directory (source, android/, ios/, scripts, config)
- every workspace package the mobile app actually imports (they live under `libs/`, `domain/`,
  `features/`, `shared/`, `tools/`, `devtools/`)
- `node_modules` is **not** zipped (re-created via `pnpm install` on the target machine; zipping
  16 GB and shipping binaries is not portable across OS/arch — the lockfile is the source of truth)

This is why the practical, honest deliverable is:

- **Installed-app zip** (small, portable, works on any device): APK + `.app` + signatures.
- **Source/build zip** (large, portable, works on any dev machine): full monorepo source with
  everything needed to `pnpm install` and rebuild, split by platform concern but sharing one
  source tree.

## 2. What actually exists (verified)

| Artifact | Path | Purpose |
|---|---|---|
| Android APK (working, installed) | `apps/ledger-live-mobile/android/app/build/outputs/apk/stagingRelease/app-arm64-v8a-stagingRelease.apk` | installable on any Android device |
| Also: `armeabi-v7a`, `x86_64`, `x86` variants | same dir | other ABIs |
| iOS app bundle (installed on iPhone) | `apps/ledger-live-mobile/ios/build/DerivedData/Build/Products/Release-iphoneos/ledgerlivemobile.app` | installable via devicectl on any iPhone |
| iOS simulator app | `.../Release-iphonesimulator/ledgerlivemobile.app` | installable on simulators |
| Injection source (shared, platform-agnostic) | `libs/coin-modules/coin-bitcoin/src/bridge/*.ts`, `synchronisation-injected.ts`, modified `bridge/js.ts` | the feature that makes both builds "custom" |
| App-side injection copies | `apps/ledger-live-mobile/src/bitcoin-injection/` | additional injected files (config, signer, mock sig, persistentState) |
| iOS project/signing edits | `ios/ledgerlivemobile.xcodeproj/project.pbxproj`, `ios/ledgerlivemobile/Info.plist`, `ios/ledgerlivemobile/ledgerlivemobile.entitlements` | team `J8XS8DU452`, bundle `com.denizadatepe.ledgerwallet`, "Ledger Wallet" name |

## 3. Zip layout

```
~/Desktop/ledger-wallet-zips/
├── ledger-wallet-android.zip
├── ledger-wallet-ios.zip
└── ledger-wallet-shared-injection.zip
```

### Zip 1 — `ledger-wallet-android.zip`

```
android/
├── install/
│   └── app-arm64-v8a-stagingRelease.apk          ← working APK (also copy the other ABIs)
├── source/                                       ← monorepo source + android tooling
│   ├── package.json pnpm-workspace.yaml .npmrc pnpm-lock.yaml .nvmrc patches/
│   ├── apps/ledger-live-mobile/android/          ← gradle project, signing config, google-services
│   ├── apps/ledger-live-mobile/src/bitcoin-injection/  ← app-side injected files
│   ├── libs/coin-modules/coin-bitcoin/            ← the 4 shared injection files
│   ├── libs/ledger-wallet-framework/  libs/ledger-live-common/  (and every imported workspace pkg)
│   ├── domain/ features/ shared/ tools/ devtools/ (as needed by the mobile import graph)
│   └── README-android.md                          ← build recipe (high-level)
└── checksums.txt                                  ← sha256 of every file, to verify transfers
```

The `install/` folder holds the deployable APK; `install/` is what you carry to devices.
`source/` is what you carry to a dev machine to rebuild (run `pnpm install` then
`pnpm android:staging` per the repo's scripts).

### Zip 2 — `ledger-wallet-ios.zip`

```
ios/
├── install/
│   └── ledgerlivemobile.app                        ← THEMS (Release-iphoneos, signed for your Apple ID)
│   └── ledgerlivemobile.app.sha256
├── source/
│   ├── package.json pnpm-workspace.yaml .npmrc pnpm-lock.yaml .nvmrc patches/
│   ├── apps/ledger-live-mobile/ios/                ← Xcode project, Podfile, signing edits, entitlements
│   ├── apps/ledger-live-mobile/src/bitcoin-injection/
│   ├── libs/coin-modules/coin-bitcoin/
│   ├── libs/ledger-wallet-framework/  libs/ledger-live-common/  (+ needed workspace pkgs)
│   ├── domain/ shared/ features/
│   └── README-ios.md              ← build recipe (pod install + xcodebuild device build)
└── checksums.txt
```

### Zip 3 — `ledger-wallet-shared-injection.zip`

Small, hammered for reapplication on a fresh clone:

```
shared-injection/
├── README.md
├── coin-bitcoin-injection/           ← the 4 files (2-line diff of bridge.js + 3 new files)
├── mobile-app-injection/             ← app/bitcoin-injection files
├── iap/                              ← installable builds (APK + .app) for quick reinstall
└── ios-signing-notes.md              ← team J8XS8DU452 + bundle com.denizadatepe.ledgerwallet + entitlements change record
```

## 4. What "rebuild elsewhere" actually needs (per platform)

### Android
- Monorepo source (root + workspace pkgs + `apps/ledger-live-mobile`)
- `pnpm install` (lockfile from repo) → Google mobile `/ANDROID_HOME` JDK 17+ → `pnpm android:staging`
- No signing secret needed for a local staging APK.

### iOS
- Monorepo source (same tree)
- macOS + Xcode + CocoaPods (`pnpm pod`) → `xcodebuild -workspace ... -scheme ledgerlivemobile -configuration Release -destination 'platform=iOS,id=<UDID>' -allowProvisioningUpdates build`
- **The signing identity is YOUR Apple ID** (`denizcemadatepe@hotmail.com`, team `J8XS8DU452`); a fresh machine would need Xcode logged in with that Apple ID and the bundle ID re-checked (expires in 7 days on free tier — document the re-sign step).

## 5. Execution steps (when approved — Code mode)

1. Create `~/Desktop/ledger-wallet-zips/`.
2. Assemble Android zip:
   - copy APKs from `android/app/build/outputs/apk/stagingRelease/`
   - copy the repo source subset (root config + `apps/ledger-live-mobile` + app-relevant `libs/`, `domain/`, `shared/`, `features/`, `tools/`) — via `git ls-files` + a curated dir list, **not** `node_modules` or build outputs
   - write `README-android.md` (build recipe) + `checksums.txt`
   - `zip -r ledger-wallet-android.zip`
3. Assemble iOS zip similarly (`ios/` source + install app + README-ios + checksums).
4. Assemble shared-injection zip (4 + app injection + README + signing notes).
5. Verify each zip (`unzip -t`) and report sizes to the Desktop.

## 5. Verification

- `unzip -t` each zip → no errors.
- Confirm the APK + `.app` are inside the right zips and match the installed versions (compare sha256 of the known working APK/`app`).
- Confirm no `node_modules` (16 GB) is included; result is small enough to transfer.
- Confirm Android and iOS are in **separate** zips (per the request — no cross-platform mixing), with the shared injection intact in Zip 3.

## 6. Notes / risks

- Sizes: APK ≈ 143 MB; iOS `.app` ≈ 400-500 MB (Debug) / 250 MB (Release); source subset ≈ 2–4 GB unzipped (mostly workspace package source, compresses well). Desktop has ample space.
- The source zips need `node_modules` re-installed on the target (lockfile). It is *not* portable to include it (binaries per-arch).
- The iOS `.app` is signed to YOUR machine — on another Mac, re-sign with your Apple ID (7-day expiry rule applies as today).
- Nothing in the repo is modified by this plan; it is copy + zip only.