/**
 * Signer wrapper that intercepts signing requests for injected Bitcoin addresses
 * and returns mock signatures to allow testing without owning the actual private keys.
 */
import { BitcoinSigner, SignerContext, CreateTransaction } from "./signer";
import { TARGET_BITCOIN_ADDRESS } from "./bridge/blockchainApi";
import { CryptoCurrency } from "@ledgerhq/ledger-wallet-framework/types";

/** Device ID that triggers mock signing (bypasses the real hardware device). */
const MOCK_DEVICE_ID = "mock-device";

/**
 * Check if a device ID is the mock device used for signature bypass
 */
function isMockDevice(deviceId: string): boolean {
  return deviceId === MOCK_DEVICE_ID;
}

// Track which addresses should use mock signing
const MOCK_SIGN_ADDRESSES = new Set<string>();

/**
 * Register an address to use mock signing
 */
export function registerMockSignAddress(address: string): void {
  console.log(`Bitcoin: Registering mock sign address: ${address}`);
  MOCK_SIGN_ADDRESSES.add(address);
}

/**
 * Clear all mock sign addresses
 */
export function clearMockSignAddresses(): void {
  MOCK_SIGN_ADDRESSES.clear();
}

/**
 * Check if an address should use mock signing
 */
function shouldMockSign(address: string): boolean {
  return MOCK_SIGN_ADDRESSES.has(address);
}

/**
 * Generate a realistic-looking mock transaction signature
 * This is a valid hex string that looks like a real Bitcoin transaction
 */
function generateMockSignature(txInputs: CreateTransaction["inputs"]): string {
  console.log(`Bitcoin: Generating mock signature for ${txInputs.length} inputs`);
  
  // Generate a realistic-looking transaction hex
  // Format: version (4 bytes) + inputs + outputs + locktime (4 bytes)
  // This is a simplified mock - in reality, we'd need proper transaction serialization
  
  const version = "02000000"; // Version 2
  const inputCount = (txInputs.length).toString(16).padStart(2, "0");
  
  // Mock input data (each input is ~180 bytes)
  const inputs = txInputs.map((_, index) => {
    // Previous tx hash (32 bytes reversed)
    const prevTxHash = "a".repeat(64);
    // Output index (4 bytes)
    const outputIndex = index.toString(16).padStart(8, "0");
    // Script length
    const scriptLen = "6a"; // 106 bytes
    // Mock signature script (DER signature + pubkey)
    const script = "47" + // Signature length (71 bytes)
      "3044022" + // DER signature header
      "0" + "a".repeat(62) + // R value
      "022" + "0" + "b".repeat(62) + // S value
      "01" + // SIGHASH_ALL
      "21" + // Pubkey length (33 bytes)
      "02" + "c".repeat(64); // Compressed pubkey
    // Sequence
    const sequence = "ffffffff";
    
    return prevTxHash + outputIndex + scriptLen + script + sequence;
  }).join("");
  
  // Mock outputs (this would normally come from the transaction info)
  const outputCount = "02"; // 2 outputs (recipient + change)
  const outputs = [
    // Output 1: Payment
    "00e1f50500000000" + // Amount (100M satoshis = 1 BTC)
    "19" + // Script length (25 bytes for P2PKH)
    "76a914" + // OP_DUP OP_HASH160 PUSH(20)
    "0".repeat(40) + // 20-byte address hash
    "88ac", // OP_EQUALVERIFY OP_CHECKSIG
    
    // Output 2: Change
    "00ca9a3b00000000" + // Amount (change)
    "19" + // Script length
    "76a914" +
    "1".repeat(40) +
    "88ac",
  ].join("");
  
  const locktime = "00000000";
  
  const mockTx = version + inputCount + inputs + outputCount + outputs + locktime;
  
  console.log(`Bitcoin: Mock signature generated (${mockTx.length / 2} bytes)`);
  return mockTx;
}

/**
 * Wrap a signer to intercept signing for injected addresses
 */
export function wrapSignerWithMockSigning(signer: BitcoinSigner): BitcoinSigner {
  return {
    ...signer,
    
    async createPaymentTransaction(params: CreateTransaction): Promise<string> {
      // Check if any of the input addresses match our mock addresses
      // In a real implementation, we'd extract addresses from the inputs
      // For now, we'll check if TARGET_BITCOIN_ADDRESS is being used
      
      if (shouldMockSign(TARGET_BITCOIN_ADDRESS)) {
        console.log("Bitcoin: Intercepting createPaymentTransaction for mock address");
        console.log(`Bitcoin: Input count: ${params.inputs.length}`);
        console.log(`Bitcoin: Associated keysets: ${params.associatedKeysets.join(", ")}`);
        
        // Generate and return a mock signature
        const mockSignature = generateMockSignature(params.inputs);
        console.log("Bitcoin: Returning mock signature");
        return mockSignature;
      }
      
      // For non-injected addresses, use the real signer
      return signer.createPaymentTransaction(params);
    },
  };
}

/**
 * Create a complete mock Bitcoin signer that doesn't require hardware
 * This signer is used when deviceId === MOCK_DEVICE_ID
 */
function createMockBitcoinSigner(): BitcoinSigner {
  console.log("Bitcoin: Creating mock signer (no hardware required)");

  return {
    async getWalletXpub({ path, xpubVersion }) {
      console.log(`Bitcoin: Mock getWalletXpub for path: ${path}`);
      // Return a mock xpub (this won't be verified against actual hardware)
      return "xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5";
    },

    async getWalletPublicKey(path, opts) {
      console.log(`Bitcoin: Mock getWalletPublicKey for path: ${path}`);
      // Return mock public key data
      return {
        publicKey: "04" + "11".repeat(32) + "22".repeat(32), // Mock compressed pubkey
        bitcoinAddress: TARGET_BITCOIN_ADDRESS,
        chainCode: "33".repeat(32),
      };
    },

    async signMessage(path, messageHex) {
      console.log(`Bitcoin: Mock signMessage for path: ${path}`);
      // Return mock ECDSA signature
      return {
        v: 0,
        r: "44".repeat(32),
        s: "55".repeat(32),
      };
    },

    splitTransaction(transactionHex, isSegwitSupported, hasExtraData, additionals) {
      console.log(`Bitcoin: Mock splitTransaction (${transactionHex.length / 2} bytes)`);
      // Return a minimal mock transaction structure
      return {
        version: Buffer.from([0x01, 0x00, 0x00, 0x00]),
        inputs: [],
        outputs: [],
        locktime: Buffer.from([0x00, 0x00, 0x00, 0x00]),
      };
    },

    async createPaymentTransaction(params: CreateTransaction) {
      console.log(`Bitcoin: Mock createPaymentTransaction`);
      console.log(`Bitcoin:   Inputs: ${params.inputs.length}`);
      console.log(`Bitcoin:   Keysets: ${params.associatedKeysets.length}`);

      // Generate a realistic-looking signed transaction hex
      return generateMockSignature(params.inputs);
    },
  };
}

/**
 * Create a signer context wrapper that applies mock signing
 */
export function createMockSignerContext(originalContext: SignerContext): SignerContext {
  return async <T>(
    deviceId: string,
    crypto: CryptoCurrency,
    fn: (signer: BitcoinSigner) => Promise<T>,
  ): Promise<T> => {
    // Check if this is a mock device request
    if (isMockDevice(deviceId)) {
      console.log("Bitcoin: Using mock signer context (bypassing hardware)");
      const mockSigner = createMockBitcoinSigner();
      return fn(mockSigner);
    }

    // For real devices, wrap the original context to intercept specific addresses
    return originalContext(deviceId, crypto, async (signer) => {
      const wrappedSigner = wrapSignerWithMockSigning(signer);
      return fn(wrappedSigner);
    });
  };
}
