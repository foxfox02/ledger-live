#!/usr/bin/env node
/**
 * Bitcoin Address Switching Demo
 * Demonstrates how to use the new runtime address configuration
 */

console.log('Bitcoin Address Switching Demo');
console.log('==============================\n');

// Simulate the config module (since we can't import TypeScript directly)
const configExample = `
// Example usage in your app:

// 1. Import the configuration functions
import { 
  getTargetBitcoinAddress,
  setTargetBitcoinAddress,
  switchToPreset,
  PRESET_ADDRESSES,
  isValidBitcoinAddress,
  resetToDefaultAddress
} from './bitcoin/config';

// 2. Get current address
const currentAddress = getTargetBitcoinAddress();
console.log('Current Bitcoin injection address:', currentAddress);

// 3. Switch to a different address
async function switchAddressExample() {
  // Method A: Set custom address
  const newAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
  if (isValidBitcoinAddress(newAddress)) {
    await setTargetBitcoinAddress(newAddress);
    console.log('Switched to:', newAddress);
  }

  // Method B: Use preset
  await switchToPreset('genesis');
  console.log('Switched to genesis address:', PRESET_ADDRESSES.genesis);

  // Method C: Reset to default
  await resetToDefaultAddress();
  console.log('Reset to default address');
}

// 4. Initialize on app start
import { loadPersistedAddress } from './bitcoin/config';
loadPersistedAddress().catch(console.warn);
`;

console.log(configExample);

console.log('\n📱 Practical Usage Scenarios:');
console.log('============================\n');

console.log('Scenario 1: Testing with different Bitcoin addresses');
console.log('----------------------------------------------------');
const scenario1 = `
// Before onboarding, set the address you want to test
import { setTargetBitcoinAddress } from './bitcoin/config';

async function setupTestAddress() {
  // Choose from these test addresses:
  const testAddresses = {
    genesis: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', // First Bitcoin address
    pizza: '1XPTgDRhN8RFnzniWCddobD9iKZatrvH4',    // Bitcoin Pizza address
    test1: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',   // Test address
    yourAddress: '1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG', // Your current address
  };

  // Set the address
  await setTargetBitcoinAddress(testAddresses.genesis);
  
  // Clear app data for clean test
  // await clearAppData();
  
  // Start onboarding - the new address will be discovered
  startOnboarding();
}
`;
console.log(scenario1);

console.log('\nScenario 2: Dev menu for quick switching');
console.log('----------------------------------------');
const scenario2 = `
// Add to your dev menu/settings
import { PRESET_ADDRESSES, switchToPreset } from './bitcoin/config';

const devMenuItems = [
  {
    title: 'Bitcoin Injection',
    submenu: [
      {
        title: 'Switch to Genesis Address',
        onPress: async () => {
          await switchToPreset('genesis');
          alert('Switched to Genesis address. Restart app.');
        },
      },
      {
        title: 'Switch to Pizza Address',
        onPress: async () => {
          await switchToPreset('pizza');
          alert('Switched to Pizza address. Restart app.');
        },
      },
      {
        title: 'Reset to Default',
        onPress: async () => {
          await resetToDefaultAddress();
          alert('Reset to default address. Restart app.');
        },
      },
      {
        title: 'Enter Custom Address',
        onPress: async () => {
          const address = await prompt('Enter Bitcoin address:');
          if (address && isValidBitcoinAddress(address)) {
            await setTargetBitcoinAddress(address);
            alert('Address set. Restart app.');
          } else {
            alert('Invalid Bitcoin address');
          }
        },
      },
    ],
  },
];
`;
console.log(scenario2);

console.log('\nScenario 3: Environment-based configuration');
console.log('-------------------------------------------');
const scenario3 = `
// Use different addresses for different build types
import { setTargetBitcoinAddress } from './bitcoin/config';

async function configureBasedOnEnvironment() {
  const environment = process.env.NODE_ENV || 'development';
  
  switch (environment) {
    case 'development':
      await setTargetBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
      break;
    case 'staging':
      await setTargetBitcoinAddress('1XPTgDRhN8RFnzniWCddobD9iKZatrvH4');
      break;
    case 'production':
      // Keep default address
      break;
  }
}

// Or use .env files:
// .env.development: BITCOIN_INJECTION_ADDRESS=1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
// .env.staging: BITCOIN_INJECTION_ADDRESS=1XPTgDRhN8RFnzniWCddobD9iKZatrvH4
`;
console.log(scenario3);

console.log('\n🔧 Testing Commands:');
console.log('===================\n');
console.log('1. Build with default address:');
console.log('   pnpm mobile android:prod\n');

console.log('2. Test address switching (in dev console):');
console.log('   // Switch to genesis address');
console.log('   await setTargetBitcoinAddress(\'1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa\');\n');

console.log('3. Clear app data and test:');
console.log('   pnpm mobile android:clean\n');

console.log('4. Verify address persistence:');
console.log('   // Set address, restart app, check if it\'s still set');
console.log('   const current = getTargetBitcoinAddress();');
console.log('   console.log(\'Persisted address:\', current);\n');

console.log('✅ Migration Complete!');
console.log('=====================\n');
console.log('Your Bitcoin address injection system now supports:');
console.log('• Runtime address switching (no rebuild needed)');
console.log('• Address persistence across app restarts');
console.log('• Preset addresses for quick testing');
console.log('• Address validation');
console.log('• Backward compatibility with existing code');