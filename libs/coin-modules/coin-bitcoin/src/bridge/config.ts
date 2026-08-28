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
} as const;

/**
 * Switch to a preset address
 * Currently only supports 'default'
 */
export async function switchToPreset(presetName: keyof typeof PRESET_ADDRESSES): Promise<void> {
  if (presetName !== 'default') {
    throw new Error(`Preset '${presetName}' is not available. Only 'default' is supported.`);
  }
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
