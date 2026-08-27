# Android APK Build Instructions for Bitcoin Address Injection

## Prerequisites

### 1. Install Java 17 (Required)
Your current Java 25 is too new for Android Gradle builds. Install Java 17:

**Using Homebrew:**
```bash
# Install Java 17
brew install openjdk@17

# Set Java 17 as default
sudo ln -sfn /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-17.jdk

# Verify installation
java -version
# Should show: openjdk version "17.x.x"
```

**Alternative: Use jenv (Java version manager):**
```bash
# Install jenv
brew install jenv

# Add jenv to shell
echo 'export PATH="$HOME/.jenv/bin:$PATH"' >> ~/.zshrc
echo 'eval "$(jenv init -)"' >> ~/.zshrc
source ~/.zshrc

# Install Java 17
brew install openjdk@17

# Add to jenv
jenv add /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home

# Set global Java version
jenv global 17
```

### 2. Android SDK Requirements
Ensure you have:
- Android SDK installed
- Android SDK Platform 33+
- Build Tools 33.0.0+
- Android NDK (if required)

Check Android Studio or run:
```bash
$ANDROID_HOME/tools/bin/sdkmanager --list
```

## Build Steps

### Step 1: Prepare Your Bitcoin Injection Code

Your Bitcoin injection code is in `/Users/dg/Desktop/bitcoin/`. To integrate it with the Ledger Live mobile app:

1. **Copy your Bitcoin files to the mobile app:**
   ```bash
   # Create directory for Bitcoin injection
   mkdir -p /Users/dg/ledger-live/apps/ledger-live-mobile/src/bitcoin-injection
   
   # Copy your Bitcoin files
   cp -r /Users/dg/Desktop/bitcoin/* /Users/dg/ledger-live/apps/ledger-live-mobile/src/bitcoin-injection/
   ```

2. **Update import paths in your files:**
   Change imports from `./bridge/blockchainApi` to `./blockchainApi` (already done in migration)

3. **Integrate with the mobile app build:**
   You'll need to modify the mobile app's build configuration to include your Bitcoin injection code.

### Step 2: Build Configuration

**Option A: Build Staging APK (Recommended for testing)**
```bash
cd /Users/dg/ledger-live

# Install dependencies
pnpm install

# Build Android staging APK
pnpm --filter live-mobile android:staging
```

**Option B: Build Production APK**
```bash
cd /Users/dg/ledger-live

# Run the release build script
pnpm --filter live-mobile android:release
```

### Step 3: Locate the APK File

After successful build, find the APK:
- **Staging APK:** `apps/ledger-live-mobile/android/app/build/outputs/apk/staging/release/`
- **Production APK:** `apps/ledger-live-mobile/android/app/build/outputs/apk/release/`

The APK filename will be something like:
- `app-staging-release.apk`
- `app-release.apk`

## Troubleshooting

### Common Issues & Solutions

**Issue 1: Java version mismatch**
```
Unsupported class file major version 69
```
**Solution:** Use Java 17 as shown in prerequisites.

**Issue 2: Missing dependencies**
```
Local package.json exists, but node_modules missing
```
**Solution:** Run `pnpm install` in the root directory.

**Issue 3: Android SDK not found**
```
SDK location not found
```
**Solution:** Set `ANDROID_HOME` environment variable:
```bash
export ANDROID_HOME=~/Library/Android/sdk
export PATH=$ANDROID_HOME/platform-tools:$PATH
export PATH=$ANDROID_HOME/tools:$PATH
```

**Issue 4: Gradle build fails**
```
Failed to apply plugin 'com.android.internal.application'
```
**Solution:** Clean Gradle cache:
```bash
cd apps/ledger-live-mobile/android
./gradlew clean
```

## Alternative: Quick Test Build

If you just want to test the build process without your Bitcoin changes:

```bash
cd /Users/dg/ledger-live

# Switch to develop branch (clean state)
git checkout develop

# Install dependencies
pnpm install

# Try a simple Android build
pnpm --filter live-mobile android
```

## Integration Strategy for Your Bitcoin Code

Since your Bitcoin injection code is outside the main repository, you have these integration options:

### Option 1: Manual Integration (Quickest)
1. Copy your Bitcoin files to the mobile app source
2. Modify the mobile app's entry point to import your Bitcoin injection
3. Rebuild APK

### Option 2: Build-Time Injection
1. Create a build script that injects your Bitcoin code during APK build
2. Modify the JavaScript bundle before packaging

### Option 3: Post-Build Modification
1. Build standard Ledger Live APK
2. Extract APK, modify JavaScript bundle, repackage
3. Sign the modified APK

## Recommended Approach

For testing your Bitcoin address injection:

1. **First, verify the standard build works:**
   ```bash
   # Install Java 17
   # Set up Android SDK
   # Build staging APK without your changes
   pnpm --filter live-mobile android:staging
   ```

2. **Then integrate your Bitcoin code:**
   - Copy files to mobile app
   - Update import paths
   - Modify app entry point
   - Rebuild APK

3. **Test the APK:**
   ```bash
   # Install on device/emulator
   adb install app-staging-release.apk
   
   # Clear app data for clean test
   adb shell pm clear com.ledger.live
   ```

## Build Time Estimates

- **First build:** 15-30 minutes (downloads dependencies, compiles)
- **Subsequent builds:** 5-10 minutes
- **APK size:** ~50-100MB

## Next Steps After Successful Build

1. **Test Bitcoin address discovery:** Install APK, go through onboarding, verify `1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG` is discovered
2. **Test transaction signing:** Send a transaction, verify mock signing delays work
3. **Test address switching:** Use `setTargetBitcoinAddress()` to change addresses
4. **Verify persistence:** Restart app, check address is still set

## Support

If you encounter build issues:
1. Check Java version: `java -version` (should be 17)
2. Check Android SDK: `echo $ANDROID_HOME`
3. Check Gradle: `cd apps/ledger-live-mobile/android && ./gradlew --version`
4. Review build logs for specific error messages

The Bitcoin address configuration system is ready. Once you have Java 17 installed, you can proceed with the APK build.