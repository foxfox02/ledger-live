/**
 * Bitcoin injection configuration
 * Can be overridden via environment variables, runtime config, or storage
 */

// Default address (your current one)
const DEFAULT_ADDRESS = "1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG";

// Storage key for persisted address
const STORAGE_KEY = "bitcoin_injection_address";

// Storage key for injection configuration
const CONFIG_STORAGE_KEY = "bitcoin_injection_config";

// Runtime configuration
let runtimeAddress: string | null = null;
let injectionConfig: InjectionConfig = {
  address: DEFAULT_ADDRESS,
  derivationMode: '' as DerivationMode, // Legacy
  accountIndex: 0,
};

export interface InjectionConfig {
  address: string;
  derivationMode: '' | 'segwit' | 'native_segwit' | 'taproot';
  accountIndex: number;
}

export type DerivationMode = '' | 'segwit' | 'native_segwit' | 'taproot';

/**
 * Get the current target Bitcoin address
 */
export function getTargetBitcoinAddress(): string {
  // Priority: Runtime config > Storage > Default
  return runtimeAddress || injectionConfig.address || DEFAULT_ADDRESS;
}

/**
 * Set the target address at runtime (persisted to storage)
 */
export async function setTargetBitcoinAddress(address: string): Promise<void> {
  // Validate Bitcoin address format
  if (!isValidBitcoinAddress(address)) {
    throw new Error(`Invalid Bitcoin address: ${address}`);
  }
  
  runtimeAddress = address;
  injectionConfig.address = address;
  
  // Persist to storage
  try {
    // Try to use LLM/storage if available (React Native)
    // Note: Dynamic import may not work in all environments
    // We'll use a try-catch approach
    if (typeof window !== 'undefined' && (window as any).LLM?.storage) {
      const storage = (window as any).LLM.storage;
      await storage.save(STORAGE_KEY, address);
      console.log(`Bitcoin injection address updated to: ${address}`);
    } else {
      // Fall back to localStorage for browser environments
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, address);
        console.log(`Bitcoin injection address updated (localStorage): ${address}`);
      } else {
        console.warn('No storage available for Bitcoin injection address persistence');
      }
    }
  } catch (error) {
    console.warn('Failed to persist Bitcoin injection address:', error);
  }
}

/**
 * Set the injection configuration
 */
export async function setInjectionConfig(config: Partial<InjectionConfig>): Promise<void> {
  injectionConfig = { ...injectionConfig, ...config };
  
  // Validate address if provided
  if (config.address && !isValidBitcoinAddress(config.address)) {
    throw new Error(`Invalid Bitcoin address: ${config.address}`);
  }
  
  // Persist to storage
  try {
    if (typeof window !== 'undefined' && (window as any).LLM?.storage) {
      const storage = (window as any).LLM.storage;
      await storage.save(CONFIG_STORAGE_KEY, injectionConfig);
      console.log('Bitcoin injection config updated:', injectionConfig);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(injectionConfig));
      console.log('Bitcoin injection config updated (localStorage):', injectionConfig);
    }
  } catch (error) {
    console.warn('Failed to persist Bitcoin injection config:', error);
  }
}

/**
 * Get the current injection configuration
 */
export function getInjectionConfig(): InjectionConfig {
  return { ...injectionConfig };
}

/**
 * Load persisted address from storage on app start
 */
export async function loadPersistedAddress(): Promise<void> {
  try {
    // Try to access storage
    if (typeof window !== 'undefined' && (window as any).LLM?.storage) {
      const storage = (window as any).LLM.storage;
      const savedAddress = await storage.get(STORAGE_KEY);
      const savedConfig = await storage.get(CONFIG_STORAGE_KEY);
      
      if (savedConfig && savedConfig.address && isValidBitcoinAddress(savedConfig.address)) {
        injectionConfig = savedConfig;
        runtimeAddress = savedConfig.address;
        console.log(`Loaded Bitcoin injection config from storage:`, savedConfig);
      } else if (savedAddress && isValidBitcoinAddress(savedAddress)) {
        runtimeAddress = savedAddress;
        injectionConfig.address = savedAddress;
        console.log(`Loaded Bitcoin injection address from storage: ${savedAddress}`);
      }
    } else if (typeof localStorage !== 'undefined') {
      const savedAddress = localStorage.getItem(STORAGE_KEY);
      const savedConfig = localStorage.getItem(CONFIG_STORAGE_KEY);
      
      if (savedConfig) {
        try {
          const config = JSON.parse(savedConfig) as InjectionConfig;
          if (isValidBitcoinAddress(config.address)) {
            injectionConfig = config;
            runtimeAddress = config.address;
            console.log(`Loaded Bitcoin injection config from localStorage:`, config);
          }
        } catch (e) {
          console.warn('Failed to parse saved injection config:', e);
        }
      } else if (savedAddress && isValidBitcoinAddress(savedAddress)) {
        runtimeAddress = savedAddress;
        injectionConfig.address = savedAddress;
        console.log(`Loaded Bitcoin injection address from localStorage: ${savedAddress}`);
      }
    }
  } catch (error) {
    console.warn('Failed to load persisted Bitcoin injection address:', error);
  }
}

/**
 * Reset to default address
 */
export async function resetToDefaultAddress(): Promise<void> {
  runtimeAddress = null;
  injectionConfig = {
    address: DEFAULT_ADDRESS,
    derivationMode: '' as DerivationMode,
    accountIndex: 0,
  };
  
  try {
    if (typeof window !== 'undefined' && (window as any).LLM?.storage) {
      const storage = (window as any).LLM.storage;
      await storage.delete(STORAGE_KEY);
      await storage.delete(CONFIG_STORAGE_KEY);
      console.log(`Reset to default Bitcoin injection address: ${DEFAULT_ADDRESS}`);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CONFIG_STORAGE_KEY);
      console.log(`Reset to default Bitcoin injection address (localStorage): ${DEFAULT_ADDRESS}`);
    }
  } catch (error) {
    console.warn('Failed to reset Bitcoin injection address:', error);
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
  'genesis': '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', // Genesis block address
  'pizza': '1XPTgDRhN8RFnzniWCddobD9iKZatrvH4', // Bitcoin Pizza transaction
  'silk_road': '1933phfhK3ZgFQNLGSDXvqCn32k2buXY8a', // Historical address
  'test1': '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', // Another well-known address
  'test2': '1CounterpartyXXXXXXXXXXXXXXXUWLpVr', // Counterparty address
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
  const config = getInjectionConfig();
  return derivationMode === config.derivationMode && index === config.accountIndex;
}

/**
 * Get derivation path string for the current configuration
 */
export function getDerivationPath(): string {
  const config = getInjectionConfig();
  const purposeMap = {
    '': "44'", // Legacy
    'segwit': "49'", // SegWit
    'native_segwit': "84'", // Native SegWit
    'taproot': "86'", // Taproot
  };
  
  const purpose = purposeMap[config.derivationMode] || "44'";
  return `m/${purpose}/0'/${config.accountIndex}'`;
}

/**
 * Get all available derivation modes
 */
export function getAvailableDerivationModes(): DerivationMode[] {
  return ['', 'segwit', 'native_segwit', 'taproot'];
}

/**
 * Get derivation mode display name
 */
export function getDerivationModeDisplayName(mode: DerivationMode): string {
  const names = {
    '': 'Legacy',
    'segwit': 'SegWit',
    'native_segwit': 'Native SegWit',
    'taproot': 'Taproot',
  };
  return names[mode] || 'Unknown';
}

// Initialize with default values
loadPersistedAddress().catch(error => {
  console.warn('Failed to load persisted Bitcoin injection address on module load:', error);
});