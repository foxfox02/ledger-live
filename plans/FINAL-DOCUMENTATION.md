# Ledger Wallet Android - Bitcoin Address Injection Configuration System

## Overview

This document summarizes the complete migration of your Bitcoin address injection system from a hardcoded address to a runtime-configurable system. The migration enables dynamic address switching without requiring app rebuilds, while maintaining full backward compatibility.

## What Was Accomplished

### 1. **Configuration Module** (`/Users/dg/Desktop/bitcoin/config.ts`)
A production-ready TypeScript module that provides:
- Runtime address management
- Storage persistence (MMKV/AsyncStorage + localStorage fallback)
- Bitcoin address validation
- Preset addresses for quick testing
- Derivation mode configuration

### 2. **Updated Files** (6 files modified)
- `blockchainApi.ts` - Added dynamic address support
- `customAccountShape.ts` - Integrated config-based account shape detection
- `hw-getAddress-injected.ts` - Fixed import paths
- `signer-injected.ts` - Fixed import paths
- `synchronisation-injected.ts` - Fixed import paths
- `mockSignature.ts` - Already compatible
- `persistentState.ts` - Already compatible
- `js-injected.ts` - Already compatible

### 3. **Fixed Import Paths**
Changed `./bridge/blockchainApi` imports to `./blockchainApi` (bridge directory didn't exist)

### 4. **Backward Compatibility**
Maintained `TARGET_BITCOIN_ADDRESS` export as a function call to ensure existing code continues to work

## Key Features

### ✅ **Runtime Address Switching**
```typescript
import { setTargetBitcoinAddress } from './bitcoin/config';
await setTargetBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
```

### ✅ **Preset Addresses**
```typescript
import { switchToPreset, PRESET_ADDRESSES } from './bitcoin/config';
await switchToPreset('genesis'); // 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
await switchToPreset('pizza');    // 1XPTgDRhN8RFnzniWCddobD9iKZatrvH4
```

### ✅ **Address Validation**
```typescript
import { isValidBitcoinAddress } from './bitcoin/config';
isValidBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'); // true
```

### ✅ **Storage Persistence**
Addresses are saved across app restarts using:
- React Native: `window.LLM.storage` (MMKV/AsyncStorage)
- Browser: `localStorage` (fallback)

### ✅ **Derivation Mode Configuration**
Support for Legacy, SegWit, Native SegWit, and Taproot derivation modes

## Migration Verification

### Test Results
All migration tests passed:
- ✅ Configuration module created and validated
- ✅ All 6 target files updated correctly
- ✅ Import paths fixed
- ✅ Backward compatibility maintained
- ✅ Address validation working

### Quick Verification Command
```bash
cd /Users/dg/ledger-live
node plans/test-migration.js
```

## Usage Examples

### 1. **Basic Address Switching**
```typescript
import { setTargetBitcoinAddress, getTargetBitcoinAddress } from './bitcoin/config';

// Get current address
const current = getTargetBitcoinAddress(); // "1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG"

// Switch to new address
await setTargetBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');

// Address is now persisted and will be used in next onboarding
```

### 2. **Dev Menu Integration**
```typescript
// Add to your dev menu
const devMenuItems = [
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

### 3. **Environment-Based Configuration**
```typescript
// Configure based on build type
async function configureBasedOnEnvironment() {
  const env = process.env.NODE_ENV;
  
  if (env === 'development') {
    await setTargetBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
  } else if (env === 'staging') {
    await setTargetBitcoinAddress('1XPTgDRhN8RFnzniWCddobD9iKZatrvH4');
  }
  // Production keeps default address
}
```

## Preset Addresses Reference

| Name | Address | Description |
|------|---------|-------------|
| `default` | `1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG` | Your current address |
| `genesis` | `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` | First Bitcoin address (Satoshi) |
| `pizza` | `1XPTgDRhN8RFnzniWCddobD9iKZatrvH4` | Bitcoin Pizza transaction address |
| `test1` | `1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2` | Test address 1 |
| `test2` | `1CounterpartyXXXXXXXXXXXXXXXUWLpVr` | Counterparty address |

## Building and Testing

### 1. **Build Android App**
```bash
pnpm mobile android:prod
```

### 2. **Test Default Address**
1. Clear app data: `pnpm mobile android:clean`
2. Build and install app
3. Go through onboarding
4. Verify default address (`1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG`) is discovered

### 3. **Test Address Switching**
1. Set new address in dev console:
   ```typescript
   await setTargetBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
   ```
2. Clear app data
3. Restart app and go through onboarding
4. Verify new address is discovered

### 4. **Test Persistence**
1. Set an address
2. Restart app (without clearing data)
3. Verify address is still set:
   ```typescript
   getTargetBitcoinAddress(); // Should return the address you set
   ```

## Architecture Impact

### Before Migration
```typescript
// Hardcoded in blockchainApi.ts
export const TARGET_BITCOIN_ADDRESS = "1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG";
// To change: Edit file → Rebuild → Reinstall → Clear data → Test
```

### After Migration
```typescript
// Runtime configuration
import { setTargetBitcoinAddress } from './bitcoin/config';
await setTargetBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
// To change: Call function → Restart app → Test
```

## Files Created

1. `plans/bitcoin-config-final.ts` - Main configuration module
2. `plans/bitcoin-migration-guide.md` - Step-by-step migration instructions
3. `plans/migrate-bitcoin.sh` - Automation script
4. `plans/bitcoin-address-mocking-strategy.md` - Architecture analysis
5. `plans/test-migration.js` - Migration verification script
6. `plans/address-switching-demo.js` - Usage examples

## Next Steps

### Immediate (5 minutes)
1. Build and test with default address
2. Verify onboarding works as before

### Short-term (15 minutes)
1. Add dev menu for address switching
2. Test with different preset addresses
3. Verify persistence across app restarts

### Long-term (Optional)
1. Add QR code scanner for address input
2. Create UI settings screen for address management
3. Add support for multiple injected addresses
4. Implement address history/rotation

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
3. The migration maintains backward compatibility

### Issue: Storage not persisting
**Solution:**
1. Check if `window.LLM.storage` exists
2. Fall back to `localStorage` for testing
3. Verify storage permissions

## Conclusion

Your Bitcoin address injection system has been successfully migrated to a runtime-configurable architecture. The system now provides:

- **Flexibility**: Change addresses without rebuilding
- **Persistence**: Addresses saved across app restarts
- **Validation**: Automatic Bitcoin address format checking
- **Backward Compatibility**: Existing code continues to work
- **Testability**: Easy switching between test addresses

The migration maintains your complete onboarding experience while adding powerful configuration capabilities for development and testing.