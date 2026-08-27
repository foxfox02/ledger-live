# Bitcoin Address Injection Configuration Migration Guide

## Overview

This guide explains how to migrate your existing Bitcoin address injection system from a hardcoded address to a runtime-configurable system.

## Files Created

1. **`config.ts`** - The new configuration module (copy from `plans/bitcoin-config-final.ts`)
2. **Migration instructions** - This document

## Step 1: Create the Config Module

Copy the contents of `plans/bitcoin-config-final.ts` to `/Users/dg/Desktop/bitcoin/config.ts`:

```bash
# You may need to use sudo or change permissions first
sudo cp /Users/dg/ledger-live/plans/bitcoin-config-final.ts /Users/dg/Desktop/bitcoin/config.ts
```

Or manually create the file with the content from `plans/bitcoin-config-final.ts`.

## Step 2: Update Existing Files

You need to update 5 files that currently reference the hardcoded `TARGET_BITCOIN_ADDRESS`.

### File 1: `blockchainApi.ts`

**Current line 10:**
```typescript
export const TARGET_BITCOIN_ADDRESS = "1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG";
```

**Change to:**
```typescript
import { getTargetBitcoinAddress } from "./config";

// Remove the hardcoded constant
// export const TARGET_BITCOIN_ADDRESS = "1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG";

// Add a helper function
export function getTargetAddress(): string {
  return getTargetBitcoinAddress();
}
```

**Also update all usages in the file:**
- Replace `TARGET_BITCOIN_ADDRESS` with `getTargetAddress()`
- Update function signatures that accept address parameters

### File 2: `customAccountShape.ts`

**Update imports:**
```typescript
// Change from:
import { TARGET_BITCOIN_ADDRESS } from "./blockchainApi";

// To:
import { getTargetAddress } from "./blockchainApi";
```

**Update usage:**
- Replace `TARGET_BITCOIN_ADDRESS` with `getTargetAddress()`

### File 3: `hw-getAddress-injected.ts`

**Update imports:**
```typescript
// Change from:
import { TARGET_BITCOIN_ADDRESS } from "./blockchainApi";

// To:
import { getTargetAddress } from "./blockchainApi";
```

**Update usage:**
- Replace `TARGET_BITCOIN_ADDRESS` with `getTargetAddress()`

### File 4: `synchronisation-injected.ts`

**Update imports:**
```typescript
// Change from:
import { TARGET_BITCOIN_ADDRESS } from "./blockchainApi";

// To:
import { getTargetAddress } from "./blockchainApi";
```

**Update usage:**
- Replace `TARGET_BITCOIN_ADDRESS` with `getTargetAddress()`

### File 5: `mockSignature.ts`

**Update imports:**
```typescript
// Change from:
import { TARGET_BITCOIN_ADDRESS } from "./blockchainApi";

// To:
import { getTargetAddress } from "./blockchainApi";
```

**Update usage:**
- Replace `TARGET_BITCOIN_ADDRESS` with `getTargetAddress()`

### File 6: `persistentState.ts`

**Update imports:**
```typescript
// Change from:
import { TARGET_BITCOIN_ADDRESS } from "./blockchainApi";

// To:
import { getTargetAddress } from "./blockchainApi";
```

**Update usage:**
- Replace `TARGET_BITCOIN_ADDRESS` with `getTargetAddress()`

## Step 3: Update `shouldUseCustomAccountShape` Logic

In `customAccountShape.ts`, update the `shouldUseCustomAccountShape` function to use the config:

**Current (line ~136):**
```typescript
export function shouldUseCustomAccountShape(derivationMode: string, index: number): boolean {
  return derivationMode === "" && index === 0;
}
```

**Change to:**
```typescript
import { shouldUseCustomAccountShape as configShouldUse } from "./config";

export function shouldUseCustomAccountShape(derivationMode: string, index: number): boolean {
  return configShouldUse(derivationMode, index);
}
```

Or simply remove the function from `customAccountShape.ts` and use the one from `config.ts`.

## Step 4: Initialize on App Start

Add initialization to your app entry point:

**In your app initialization (e.g., `index.js` or main app file):**
```typescript
import { loadPersistedAddress } from './path/to/bitcoin/config';

// Early in app initialization
(async () => {
  try {
    await loadPersistedAddress();
    console.log('Bitcoin injection address loaded');
  } catch (error) {
    console.warn('Failed to load Bitcoin injection address:', error);
  }
})();
```

## Step 5: Test the Migration

### Test 1: Verify Default Address Works
1. Clear app data
2. Start app
3. Go through onboarding
4. Verify the default address (`1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG`) is discovered

### Test 2: Test Address Switching
```typescript
// In a debug console or test script
import { setTargetBitcoinAddress, switchToPreset } from './bitcoin/config';

// Switch to genesis address
await setTargetBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');

// Or use a preset
await switchToPreset('genesis');
```

### Test 3: Verify Persistence
1. Set a new address
2. Restart the app
3. Verify the address is still set

## Quick Address Switching Methods

### Method 1: Runtime API
```typescript
import { setTargetBitcoinAddress, switchToPreset } from './bitcoin/config';

// Set custom address
await setTargetBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');

// Use preset
await switchToPreset('genesis'); // 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
await switchToPreset('pizza');    // 1XPTgDRhN8RFnzniWCddobD9iKZatrvH4
await switchToPreset('test1');    // 1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2
```

### Method 2: Environment Variable (Build-time)
Create `.env` files:
```bash
# .env.bitcoin.genesis
BITCOIN_INJECTION_ADDRESS=1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa

# .env.bitcoin.pizza
BITCOIN_INJECTION_ADDRESS=1XPTgDRhN8RFnzniWCddobD9iKZatrvH4
```

Build with specific address:
```bash
ENVFILE=.env.bitcoin.genesis pnpm bundle:android:prod
```

### Method 3: Debug Menu (Optional)
Add to your dev menu:
```typescript
import { PRESET_ADDRESSES, switchToPreset } from './bitcoin/config';

const devMenuItems = [
  // ... existing items
  {
    title: 'Bitcoin Injection',
    submenu: Object.keys(PRESET_ADDRESSES).map(name => ({
      title: `Switch to ${name}`,
      onPress: async () => {
        await switchToPreset(name);
        alert(`Address switched to ${PRESET_ADDRESSES[name]}. Restart app.`);
      },
    })),
  },
];
```

## Troubleshooting

### Issue: Address not discovered after switching
**Solution:**
1. Clear app data: `pnpm mobile android:clean`
2. Verify address is valid: `isValidBitcoinAddress('your-address')`
3. Check console logs for injection confirmation

### Issue: TypeScript errors
**Solution:**
1. Ensure all imports are correct
2. Check for missing type declarations
3. Add `// @ts-ignore` for window.LLM if needed

### Issue: Storage not persisting
**Solution:**
1. Check if `window.LLM.storage` exists
2. Fall back to `localStorage` for testing
3. Verify storage permissions

## Preset Addresses Reference

| Name | Address | Description |
|------|---------|-------------|
| default | `1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG` | Your current address |
| genesis | `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` | First Bitcoin address (Satoshi) |
| pizza | `1XPTgDRhN8RFnzniWCddobD9iKZatrvH4` | Bitcoin Pizza transaction |
| test1 | `1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2` | Test address |
| test2 | `1CounterpartyXXXXXXXXXXXXXXXUWLpVr` | Counterparty address |

## Complete Example: Switching Addresses

```typescript
// Before onboarding, set the address you want to inject
import { setTargetBitcoinAddress } from './bitcoin/config';

async function setupBitcoinInjection() {
  // Choose your address
  const targetAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // Genesis address
  
  // Set it
  await setTargetBitcoinAddress(targetAddress);
  
  // Clear app data (optional, for clean test)
  // await clearAppData();
  
  // Start onboarding
  startOnboarding();
}

// Or use a preset
import { switchToPreset } from './bitcoin/config';
await switchToPreset('genesis');
```

## Next Steps

After implementing this configuration system, you can:

1. **Add UI controls** - Settings screen for address management
2. **Add QR code scanner** - Scan Bitcoin addresses to inject
3. **Add address validation** - Verify addresses have blockchain history
4. **Add multiple address support** - Inject multiple addresses at once
5. **Add derivation mode configuration** - Support SegWit, Native SegWit, Taproot

## Summary

You now have a flexible Bitcoin address injection system that allows:

✅ **Runtime address switching** - Change addresses without rebuilding  
✅ **Persistence** - Addresses saved across app restarts  
✅ **Preset addresses** - Quick switching between test addresses  
✅ **Validation** - Automatic Bitcoin address format validation  
✅ **Backward compatibility** - Default address works as before  

The system maintains your full onboarding experience while giving you the flexibility to test with different Bitcoin addresses.