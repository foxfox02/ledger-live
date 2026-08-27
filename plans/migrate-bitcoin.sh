#!/bin/bash
# Bitcoin Injection Migration Helper Script
# This script helps migrate from hardcoded address to configurable address

echo "========================================="
echo "Bitcoin Injection Migration Helper"
echo "========================================="
echo ""
echo "This script helps you migrate your Bitcoin address injection system"
echo "from a hardcoded address to a runtime-configurable system."
echo ""
echo "Files that need to be updated:"
echo "1. blockchainApi.ts"
echo "2. customAccountShape.ts"
echo "3. hw-getAddress-injected.ts"
echo "4. synchronisation-injected.ts"
echo "5. mockSignature.ts"
echo "6. persistentState.ts"
echo ""
echo "Step 1: Create config.ts"
echo "-----------------------------------------"
echo "Copy the config module to your bitcoin folder:"
echo ""
echo "sudo cp /Users/dg/ledger-live/plans/bitcoin-config-final.ts \\"
echo "  /Users/dg/Desktop/bitcoin/config.ts"
echo ""
echo "Or create the file manually with this content:"
echo ""
cat << 'EOF'
/**
 * Bitcoin injection configuration - Ready to use version
 * Copy this to /Users/dg/Desktop/bitcoin/config.ts
 */

// Default address (your current one)
const DEFAULT_ADDRESS = "1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG";

// Storage key for persisted address
const STORAGE_KEY = "bitcoin_injection_address";

// Runtime configuration
let currentAddress: string = DEFAULT_ADDRESS;
let injectionConfig = {
  address: DEFAULT_ADDRESS,
  derivationMode: '', // Legacy
  accountIndex: 0,
};

// Type declarations
declare global {
  interface Window {
    LLM?: {
      storage?: {
        save: (key: string, value: any) => Promise<void> | void;
        get: (key: string) => Promise<any> | any;
        delete: (key: string) => Promise<void> | void;
      };
    };
  }
}

/**
 * Get the current target Bitcoin address
 */
export function getTargetBitcoinAddress(): string {
  return currentAddress;
}

/**
 * Set the target address at runtime
 */
export async function setTargetBitcoinAddress(address: string): Promise<void> {
  if (!isValidBitcoinAddress(address)) {
    throw new Error(`Invalid Bitcoin address: ${address}`);
  }
  
  currentAddress = address;
  injectionConfig.address = address;
  
  // Try to persist to storage
  try {
    // For React Native (LLM/storage)
    if (typeof window !== 'undefined' && window.LLM?.storage) {
      await window.LLM.storage.save(STORAGE_KEY, address);
    } 
    // For browser (localStorage)
    else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, address);
    }
    console.log(`Bitcoin injection address updated to: ${address}`);
  } catch (error) {
    console.warn('Failed to persist address:', error);
  }
}

/**
 * Load persisted address from storage
 */
export async function loadPersistedAddress(): Promise<void> {
  try {
    let savedAddress: string | null = null;
    
    // Try to load from storage
    if (typeof window !== 'undefined' && window.LLM?.storage) {
      savedAddress = await window.LLM.storage.get(STORAGE_KEY);
    } else if (typeof localStorage !== 'undefined') {
      savedAddress = localStorage.getItem(STORAGE_KEY);
    }
    
    if (savedAddress && isValidBitcoinAddress(savedAddress)) {
      currentAddress = savedAddress;
      injectionConfig.address = savedAddress;
      console.log(`Loaded Bitcoin injection address: ${savedAddress}`);
    }
  } catch (error) {
    console.warn('Failed to load persisted address:', error);
  }
}

/**
 * Reset to default address
 */
export async function resetToDefaultAddress(): Promise<void> {
  currentAddress = DEFAULT_ADDRESS;
  injectionConfig.address = DEFAULT_ADDRESS;
  
  try {
    if (typeof window !== 'undefined' && window.LLM?.storage) {
      await window.LLM.storage.delete(STORAGE_KEY);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
    console.log(`Reset to default Bitcoin injection address: ${DEFAULT_ADDRESS}`);
  } catch (error) {
    console.warn('Failed to reset address:', error);
  }
}

/**
 * Validate Bitcoin address format
 */
export function isValidBitcoinAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  
  // Legacy P2PKH (starts with 1)
  const legacyRegex = /^[1][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  // P2SH (starts with 3)
  const p2shRegex = /^[3][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  // Bech32 (starts with bc1)
  const bech32Regex = /^(bc1)[a-z0-9]{39,87}$/;
  
  return legacyRegex.test(address) || p2shRegex.test(address) || bech32Regex.test(address);
}

/**
 * Get list of preset addresses for quick switching
 */
export const PRESET_ADDRESSES = {
  'default': '1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG',
  'genesis': '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  'pizza': '1XPTgDRhN8RFnzniWCddobD9iKZatrvH4',
  'test1': '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
  'test2': '1CounterpartyXXXXXXXXXXXXXXXUWLpVr',
} as const;

/**
 * Switch to a preset address
 */
export async function switchToPreset(presetName: keyof typeof PRESET_ADDRESSES): Promise<void> {
  const address = PRESET_ADDRESSES[presetName];
  await setTargetBitcoinAddress(address);
}

/**
 * Check if we should use custom account shape for this derivation
 */
export function shouldUseCustomAccountShape(derivationMode: string, index: number): boolean {
  return derivationMode === injectionConfig.derivationMode && index === injectionConfig.accountIndex;
}

/**
 * Get the current injection configuration
 */
export function getInjectionConfig() {
  return { ...injectionConfig };
}

/**
 * Set injection configuration
 */
export async function setInjectionConfig(config: Partial<typeof injectionConfig>): Promise<void> {
  if (config.address && !isValidBitcoinAddress(config.address)) {
    throw new Error(`Invalid Bitcoin address: ${config.address}`);
  }
  
  injectionConfig = { ...injectionConfig, ...config };
  if (config.address) {
    currentAddress = config.address;
  }
  
  console.log('Bitcoin injection config updated:', injectionConfig);
}

/**
 * Get derivation path string for the current configuration
 */
export function getDerivationPath(): string {
  const purposeMap: Record<string, string> = {
    '': "44'", // Legacy
    'segwit': "49'", // SegWit
    'native_segwit': "84'", // Native SegWit
    'taproot': "86'", // Taproot
  };
  
  const purpose = purposeMap[injectionConfig.derivationMode] || "44'";
  return `m/${purpose}/0'/${injectionConfig.accountIndex}'`;
}

// Initialize on module load
if (typeof window !== 'undefined') {
  // Load persisted address when module is imported
  loadPersistedAddress().catch(error => {
    console.warn('Failed to load persisted Bitcoin injection address:', error);
  });
}
EOF

echo ""
echo "Step 2: Update blockchainApi.ts"
echo "-----------------------------------------"
echo "Change line 10 from:"
echo '  export const TARGET_BITCOIN_ADDRESS = "1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG";'
echo ""
echo "To:"
echo "  import { getTargetBitcoinAddress } from \"./config\";"
echo ""
echo "  // Remove the hardcoded constant"
echo "  // export const TARGET_BITCOIN_ADDRESS = \"1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG\";"
echo ""
echo "  // Add a helper function"
echo "  export function getTargetAddress(): string {"
echo "    return getTargetBitcoinAddress();"
echo "  }"
echo ""
echo "Step 3: Update other files"
echo "-----------------------------------------"
echo "For each of these files, change the import:"
echo ""
echo "  FROM: import { TARGET_BITCOIN_ADDRESS } from \"./blockchainApi\";"
echo "  TO:   import { getTargetAddress } from \"./blockchainApi\";"
echo ""
echo "And replace TARGET_BITCOIN_ADDRESS with getTargetAddress()"
echo ""
echo "Files to update:"
echo "  - customAccountShape.ts"
echo "  - hw-getAddress-injected.ts"
echo "  - synchronisation-injected.ts"
echo "  - mockSignature.ts"
echo "  - persistentState.ts"
echo ""
echo "Step 4: Test the migration"
echo "-----------------------------------------"
echo "1. Clear app data: pnpm mobile android:clean"
echo "2. Build and run the app"
echo "3. Verify default address works"
echo "4. Test address switching:"
echo ""
echo "   import { setTargetBitcoinAddress } from './bitcoin/config';"
echo "   await setTargetBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');"
echo ""
echo "Step 5: Add initialization (optional)"
echo "-----------------------------------------"
echo "Add to your app entry point:"
echo ""
echo "   import { loadPersistedAddress } from './bitcoin/config';"
echo "   loadPersistedAddress().catch(console.warn);"
echo ""
echo "========================================="
echo "Migration complete!"
echo "========================================="