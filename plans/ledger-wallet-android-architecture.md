# Ledger Wallet Android Architecture Analysis

## Executive Summary

This document provides a comprehensive analysis of the Ledger Wallet Mobile (LWM) Android architecture, focusing on storage mechanisms, account/transaction management, API endpoints, and address handling. This information is essential for building a custom JavaScript bundle for Android.

---

## 1. Android Build Configuration

### 1.1 Build System
- **Build Tool**: Gradle with React Native
- **Package ID**: `com.ledger.live`
- **Min SDK**: 25 (Android 7.1)
- **Target SDK**: 36 (Android 14+)
- **Compile SDK**: 36
- **NDK Version**: 28.0.12674087
- **Kotlin Version**: 2.1.20
- **JDK**: 17

### 1.2 Build Variants
```
- debug (com.ledger.live.debug)
- release (com.ledger.live)
- stagingRelease (com.ledger.live.staging)
- detox (com.ledger.live.detox) - for E2E testing
- detoxPreRelease (com.ledger.live) - for pre-release testing
```

### 1.3 Key Build Files
- [`apps/ledger-live-mobile/android/build.gradle`](../../apps/ledger-live-mobile/android/build.gradle) - Root build config
- [`apps/ledger-live-mobile/android/app/build.gradle`](../../apps/ledger-live-mobile/android/app/build.gradle) - App module config
- [`apps/ledger-live-mobile/package.json`](../../apps/ledger-live-mobile/package.json) - Dependencies and scripts

### 1.4 Native Modules Location
```
apps/ledger-live-mobile/android/app/src/main/java/com/ledger/live/
├── BluetoothHelperModule.java
├── LocationHelperModule.kt
├── MainActivity.kt
├── MainApplication.kt
└── NativeModulesPackage.kt
```

---

## 2. Storage Architecture

### 2.1 Storage Layer Overview

The app uses a **dual-storage system** with migration support:

#### Primary Storage: MMKV (React Native MMKV)
- **Fast, synchronous key-value storage**
- **Location**: [`apps/ledger-live-mobile/src/mvvm/storage/mmkvStorageWrapper/`](../../apps/ledger-live-mobile/src/mvvm/storage/mmkvStorageWrapper/)
- **Config**: ID = `"ledger-live-mobile"`, encryption enabled
- **Performance tracking**: Built-in monitoring for read/write operations

#### Legacy Storage: AsyncStorage
- **Location**: [`apps/ledger-live-mobile/src/mvvm/storage/asyncStorageWrapper/`](../../apps/ledger-live-mobile/src/mvvm/storage/asyncStorageWrapper/)
- **Used for**: Migration fallback and legacy data
- **Chunking**: Supports large data via chunking mechanism

### 2.2 Storage Interface

**Main Storage API** ([`apps/ledger-live-mobile/src/mvvm/storage/index.ts`](../../apps/ledger-live-mobile/src/mvvm/storage/index.ts)):

```typescript
interface Storage {
  // Core operations
  keys(): Promise<string[]>
  get<T>(key: string | string[]): Promise<T | undefined>
  getString(key: string): Promise<string | undefined>
  save<T>(key: string | [string, T][], value?: T): Promise<void>
  saveString(key: string, value: string): Promise<void>
  update<T>(key: string, value: T): Promise<void>
  delete(key: string | string[]): Promise<void>
  deleteAll(): Promise<void>
  push<T>(key: string, value: T): Promise<void>
  stringify(): Promise<string>
  
  // Migration
  migrate(): Promise<void>
  rollbackMigration(): Promise<void>
  getState(): StorageState
}
```

### 2.3 Storage Keys Structure

**Key Prefixes** ([`apps/ledger-live-mobile/src/db.ts`](../../apps/ledger-live-mobile/src/db.ts)):

```typescript
// Account storage
"accounts.active.{accountId}" → Account data
"accounts.sort" → Account ordering

// Settings
"settings" → App settings
"user" → Legacy user data (migrated to identities)
"identities" → User identity data (userId, datadogId, deviceIds)

// State management
"ble" → Bluetooth state
"history" → Transaction history
"knownDevices" → Paired devices
"market" → Market data
"marketListConfig" → Market list configuration
"marketBanner" → Market banner state
"protect" → Protect service state
"trustchain" → Trustchain data
"wallet" → Wallet export state
"featureFlags" → Feature flag overrides

// Countervalues (price data)
"countervalues.{pair}" → Exchange rate data

// Crypto assets cache
"cryptoAssetsCache" → Token metadata cache

// Large mover data
"largeMover" → Large transaction tracking
```

### 2.4 Migration System

**AsyncStorage → MMKV Migration** ([`apps/ledger-live-mobile/src/mvvm/storage/utils/migrations/asyncStorageToMMKV.ts`](../../apps/ledger-live-mobile/src/mvvm/storage/utils/migrations/asyncStorageToMMKV.ts)):

- **Status tracking**: `migration-status` key in MMKV
- **Rollback support**: Can revert to AsyncStorage on errors
- **Error threshold**: Max 5 read errors before automatic rollback
- **Analytics**: Tracks migration success/failure

---

## 3. Account & Transaction Data Flow

### 3.1 Account Storage Structure

**Account Model** ([`apps/ledger-live-mobile/src/reducers/accounts.ts`](../../apps/ledger-live-mobile/src/reducers/accounts.ts)):

```typescript
interface AccountsState {
  active: Account[]  // Array of all accounts
}

interface Account {
  id: string                    // Unique account identifier
  type: "Account"
  name: string
  starred: boolean
  used: boolean
  
  // Blockchain data
  currency: CryptoCurrency
  derivationMode: string
  index: number
  freshAddress: string
  freshAddressPath: string
  blockHeight: number
  
  // Balance
  balance: BigNumber
  spendableBalance: BigNumber
  
  // Operations (transactions)
  operations: Operation[]
  pendingOperations: Operation[]
  
  // Sub-accounts (tokens)
  subAccounts?: TokenAccount[]
  
  // Sync
  lastSyncDate: Date
  syncHash?: string
  
  // Swap history
  swapHistory: SwapOperation[]
}
```

### 3.2 Account Persistence

**Save Flow** ([`apps/ledger-live-mobile/src/db.ts`](../../apps/ledger-live-mobile/src/db.ts)):

```typescript
// Each account stored separately
Key: "accounts.active.{accountId}"
Value: {
  data: AccountRaw,      // Serialized account
  version: number        // Schema version
}

// Account ordering
Key: "accounts.sort"
Value: string[]          // Array of account IDs in order
```

### 3.3 Transaction (Operation) Structure

```typescript
interface Operation {
  id: string                    // Unique operation ID
  hash: string                  // Transaction hash
  type: OperationType           // "IN" | "OUT" | "NONE" | etc.
  value: BigNumber              // Amount
  fee: BigNumber                // Network fee
  
  // Addresses
  senders: string[]
  recipients: string[]
  
  // Status
  blockHeight?: number
  blockHash?: string
  date: Date
  
  // Additional data
  extra: Record<string, any>
  hasFailed?: boolean
  subOperations?: Operation[]   // For token transfers
}
```

### 3.4 Redux State Management

**Redux Store Structure**:

```typescript
interface State {
  accounts: AccountsState       // Account data
  settings: SettingsState       // App settings
  ble: BleState                // Bluetooth state
  history: HistoryState        // Navigation history
  knownDevices: KnownDevicesState
  market: MarketState
  protect: ProtectState
  trustchain: TrustchainStore
  wallet: WalletState
  identities: IdentitiesState  // User IDs
  // ... more slices
}
```

**Account Selectors** ([`apps/ledger-live-mobile/src/reducers/accounts.ts`](../../apps/ledger-live-mobile/src/reducers/accounts.ts)):

```typescript
// Get all accounts
accountsSelector(state): Account[]

// Get flattened accounts (including sub-accounts)
flattenAccountsSelector(state): AccountLike[]

// Get accounts by currency
accountsTuplesByCurrencySelector(state, currency)

// Get single account
accountSelector(state, { accountId })
```

---

## 4. API Endpoints & Network Layer

### 4.1 Core API Services

#### Ledger APIs (Production)

**Crypto Assets Service (CAL)**
- Base: `https://global.api.prd.ledger.com/cal`
- Purpose: Currency metadata, token lists
- Endpoints:
  - `/v1/currencies` - Crypto currencies
  - `/v1/tokens` - Token metadata
  - `/v1/certificates` - Asset certificates

**Explorers API**
- Base: `https://explorers.api.live.ledger.com`
- Purpose: Blockchain data, transactions
- Endpoints:
  - `/blockchain/v4/{chain}/address/{address}/txs`
  - `/blockchain/v4/{chain}/network`
  - `/blockchain/v4/{chain}/gastracker/barometer`

**Manager API**
- Base: `https://manager.api.live.ledger.com`
- Purpose: Device apps, firmware
- Endpoints:
  - `/api/get_apps`
  - `/api/firmware`

**NFT Metadata Service**
- Base: `https://nft.api.live.ledger.com`
- Purpose: NFT data
- Endpoints:
  - `/v1/names/ens/forward/{name}`
  - `/v2/{chain}/owner/{address}`

**Countervalues API**
- Base: `https://countervalues.api.live.ledger.com`
- Purpose: Exchange rates, price data
- Endpoint: `/tickers`

**Swap API**
- Base: Configured via `SWAP_API_BASE` env
- Purpose: Token swaps, quotes
- Versioned: `/v5/` endpoints

**DADA API**
- Base: `https://dada.api.ledger.com/v1`
- Purpose: Asset aggregation, market data

**Canton Gateway** (for Canton Network)
- Base: `https://canton-gateway.api.live.ledger.com`
- Purpose: Canton blockchain operations

**Earn API**
- Base: `https://earn.api.live.ledger.com`
- Purpose: Staking, validator data

#### Chain-Specific APIs

**EVM Chains** (via Proxy Etherscan):
- Base: `https://proxyetherscan.api.live.ledger.com/v2/api/{chainId}`
- Chains: Ethereum (1), Polygon (137), Arbitrum (42161), Base (8453), etc.

**Polkadot**:
- Sidecar: `https://polkadot-mainnet-rest-api.coin.ledger.com/v1`
- Node: `https://polkadot-asset-hub-fullnodes.api.live.ledger.com`
- Indexer: `https://explorers.api.live.ledger.com/blockchain/dot_asset_hub`

**Bitcoin-like**:
- Explorer: `https://explorers.api.live.ledger.com/blockchain/v4/btc`

**Tezos**:
- Baker: `https://tezos-bakers.api.live.ledger.com`
- Explorer: `https://xtz-tzkt-explorer.api.vault.ledger.com`
- Node: `https://xtz-node.api.live.ledger.com`

**Solana**:
- Proxy: Configured via `API_SOLANA_PROXY` env

**Cardano**:
- API: Configured via `CARDANO_API_ENDPOINT` env

**Near**:
- Indexer: Configured via `API_NEARBLOCKS_INDEXER` env

**Hedera**:
- Mirror: Configured via `API_HEDERA_MIRROR` env

**TON**:
- API: `https://ton.coin.ledger.com/api/v3`

**MultiversX (Elrond)**:
- API: `https://elrond.coin.ledger.com`
- Delegation: `https://delegations-elrond.coin.ledger.com`

### 4.2 Network Layer

**HTTP Client** ([`libs/live-network/`](../../libs/live-network/)):
- Uses Axios with retry logic
- Caching via LRU cache
- Request/response interceptors
- Error handling with custom error types

**Environment Configuration** ([`libs/env/src/env.ts`](../../libs/env/src/env.ts)):
- All API endpoints configurable via environment variables
- Default values for production
- Override support for testing/staging

---

## 5. Address Generation & Management

### 5.1 Address Derivation

**Derivation Paths** (BIP32/BIP44):

```typescript
// Standard path format
m / purpose' / coin_type' / account' / change / address_index

// Examples:
// Bitcoin: m/84'/0'/0'/0/0 (Native SegWit)
// Ethereum: m/44'/60'/0'/0/0
// Polkadot: m/44'/354'/0'/0'/0'
```

**Derivation Modes**:
- `""` (empty) - Legacy/default
- `segwit` - P2SH-P2WPKH
- `native_segwit` - P2WPKH (Bech32)
- `taproot` - P2TR (Bech32m)

### 5.2 Address Resolution

**Bridge System** ([`libs/ledger-live-common/src/bridge/`](../../libs/ledger-live-common/src/bridge/)):

Each cryptocurrency family implements:

```typescript
interface CurrencyBridge {
  scanAccounts(params): Observable<ScanAccountEvent>
  // Discovers accounts on device
}

interface AccountBridge {
  receive(account, params): Observable<ReceiveEvent>
  // Gets fresh receiving address
  
  sync(account, params): Observable<Account>
  // Syncs account state from blockchain
}
```

**Address Verification**:
- Device displays address for user confirmation
- App verifies address matches derivation path
- Hardware wallet signs address verification request

### 5.3 Fresh Address Management

```typescript
// Account maintains fresh address
account.freshAddress: string        // Current receiving address
account.freshAddressPath: string    // Derivation path

// Address changes after use (UTXO chains)
// Address remains same (account-based chains like Ethereum)
```

---

## 6. Transaction Flow

### 6.1 Transaction Creation

**Flow**:
1. **Create Transaction** - Initialize transaction object
2. **Prepare Transaction** - Fetch network fees, validate
3. **Get Transaction Status** - Check for errors
4. **Sign Operation** - Sign with hardware wallet
5. **Broadcast** - Submit to network

**Transaction Object**:

```typescript
interface Transaction {
  family: string              // "bitcoin", "ethereum", etc.
  amount: BigNumber
  recipient: string
  
  // Fee configuration
  feePerByte?: BigNumber     // Bitcoin-like
  gasPrice?: BigNumber       // Ethereum
  gasLimit?: BigNumber
  maxFeePerGas?: BigNumber   // EIP-1559
  maxPriorityFeePerGas?: BigNumber
  
  // Additional data
  memo?: string              // Stellar, Cosmos
  data?: Buffer              // Ethereum contract calls
  
  // Network info
  networkInfo?: NetworkInfo
}
```

### 6.2 Transaction Signing

**Device Communication**:
- Uses `@ledgerhq/hw-transport` for device communication
- Bluetooth: `@ledgerhq/react-native-hw-transport-ble`
- USB: `@ledgerhq/device-transport-kit-react-native-hid`

**Signing Process**:
1. Serialize transaction for device
2. Send to hardware wallet via transport
3. User confirms on device
4. Device returns signature
5. Combine signature with transaction
6. Broadcast signed transaction

---

## 7. Architecture Diagrams

### 7.1 Storage Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    React Native App                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │           Storage Interface (Unified)           │    │
│  │  keys() get() save() update() delete() etc.    │    │
│  └────────────────┬───────────────────────────────┘    │
│                   │                                      │
│         ┌─────────┴─────────┐                           │
│         │                   │                           │
│  ┌──────▼──────┐    ┌──────▼──────┐                   │
│  │    MMKV     │    │ AsyncStorage │                   │
│  │  (Primary)  │◄───┤  (Fallback)  │                   │
│  └─────────────┘    └──────────────┘                   │
│         │                   │                           │
│         │    Migration      │                           │
│         └───────────────────┘                           │
│                                                          │
└─────────────────────────────────────────────────────────┘
         │                   │
         ▼                   ▼
   Native MMKV        React Native
   (C++ Library)      AsyncStorage
```

### 7.2 Account Data Flow

```
┌──────────────────────────────────────────────────────────┐
│                      User Action                          │
│              (View Account, Send, Receive)                │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│                   Redux Store                             │
│  ┌────────────────────────────────────────────────┐      │
│  │  accountsSelector(state) → Account[]           │      │
│  │  accountSelector(state, {accountId}) → Account │      │
│  └────────────────────────────────────────────────┘      │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│                Storage Layer (MMKV)                       │
│  Key: "accounts.active.{accountId}"                       │
│  Value: { data: AccountRaw, version: number }            │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│              Account Synchronization                      │
│  ┌────────────────────────────────────────────────┐      │
│  │  Bridge.sync(account) → Observable<Account>    │      │
│  │    ├─ Fetch balance from blockchain            │      │
│  │    ├─ Fetch operations (transactions)          │      │
│  │    ├─ Update fresh address                     │      │
│  │    └─ Return updated account                   │      │
│  └────────────────────────────────────────────────┘      │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│              Blockchain APIs                              │
│  - Explorers API (transactions, balance)                 │
│  - Chain-specific APIs (Etherscan, Polkadot, etc.)      │
│  - Node RPC endpoints                                    │
└──────────────────────────────────────────────────────────┘
```

### 7.3 Transaction Flow

```
┌──────────────────────────────────────────────────────────┐
│              User Initiates Transaction                   │
│         (Enter amount, recipient, fees)                   │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│         1. Create Transaction (Bridge)                    │
│  bridge.createTransaction(account)                        │
│  → Returns base transaction object                        │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│         2. Prepare Transaction (Bridge)                   │
│  bridge.prepareTransaction(account, transaction)          │
│  → Fetches network fees, validates inputs                │
│  → Returns prepared transaction with fees                │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│         3. Get Transaction Status (Bridge)                │
│  bridge.getTransactionStatus(account, transaction)        │
│  → Validates transaction, checks for errors              │
│  → Returns status with errors/warnings                   │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│         4. Sign Operation (Device)                        │
│  bridge.signOperation({account, transaction, deviceId})   │
│  ┌────────────────────────────────────────────────┐      │
│  │  a. Serialize transaction for device           │      │
│  │  b. Send to hardware wallet via transport      │      │
│  │  c. User confirms on device screen             │      │
│  │  d. Device returns signature                   │      │
│  │  e. Combine signature with transaction         │      │
│  └────────────────────────────────────────────────┘      │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│         5. Broadcast (Network)                            │
│  bridge.broadcast({account, signedOperation})             │
│  → Submits signed transaction to blockchain              │
│  → Returns operation with transaction hash               │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│         6. Update Account State                           │
│  - Add to pendingOperations                              │
│  - Sync account to confirm                               │
│  - Move to operations when confirmed                     │
└──────────────────────────────────────────────────────────┘
```

---

## 8. Key Considerations for Custom JS Bundle

### 8.1 Bundle Requirements

**Essential Dependencies**:
```json
{
  "react": "catalog:",
  "react-native": "catalog:",
  "@react-native-async-storage/async-storage": "2.1.2",
  "react-native-mmkv": "4.3.2",
  "@reduxjs/toolkit": "catalog:",
  "redux": "catalog:",
  "rxjs": "catalog:",
  "bignumber.js": "9.1.2"
}
```

**Ledger-Specific**:
```json
{
  "@ledgerhq/live-common": "workspace:^",
  "@ledgerhq/types-live": "workspace:^",
  "@ledgerhq/hw-transport": "workspace:*",
  "@ledgerhq/react-native-hw-transport-ble": "catalog:",
  "@ledgerhq/device-transport-kit-react-native-hid": "catalog:",
  "@ledgerhq/coin-*": "workspace:^"  // Per-chain modules
}
```

### 8.2 Build Configuration

**Metro Bundler** ([`apps/ledger-live-mobile/rspack.config.mjs`](../../apps/ledger-live-mobile/rspack.config.mjs)):
- Uses Rspack for bundling
- Supports code splitting
- Tree shaking enabled
- Source maps for debugging

**Android-Specific**:
```bash
# Build JS bundle
pnpm bundle:android:prod

# Output location
apps/ledger-live-mobile/main.android.jsbundle
```

### 8.3 Storage Initialization

**Bootstrap Sequence**:

```typescript
// 1. Initialize storage
import storage from 'LLM/storage';
await storage.migrate(); // Migrate from AsyncStorage if needed

// 2. Load persisted state
const accounts = await getAccounts();
const settings = await getSettings();
const identities = await getIdentities();

// 3. Initialize Redux store
const store = configureStore({
  reducer: rootReducer,
  preloadedState: {
    accounts: { active: accounts },
    settings,
    identities,
    // ... other slices
  }
});

// 4. Start account synchronization
accounts.forEach(account => {
  const bridge = getAccountBridge(account);
  bridge.sync(account).subscribe(updatedAccount => {
    store.dispatch(updateAccount(updatedAccount));
  });
});
```

### 8.4 API Configuration

**Environment Setup**:

```typescript
import { setEnv } from '@shared/env';

// Configure API endpoints
setEnv('CAL_SERVICE_URL', 'https://global.api.prd.ledger.com/cal');
setEnv('EXPLORER_API', 'https://explorers.api.live.ledger.com');
setEnv('MANAGER_API_BASE', 'https://manager.api.live.ledger.com');
// ... other endpoints
```

### 8.5 Device Communication

**Transport Setup**:

```typescript
import TransportBLE from '@ledgerhq/react-native-hw-transport-ble';
import TransportHID from '@ledgerhq/device-transport-kit-react-native-hid';

// Bluetooth
const device = await TransportBLE.create();

// USB (Android)
const device = await TransportHID.create();

// Use with bridge
const bridge = getAccountBridge(account);
const signedOp = await bridge.signOperation({
  account,
  transaction,
  deviceId: device.id
});
```

---

## 9. Critical Files Reference

### 9.1 Storage
- [`apps/ledger-live-mobile/src/mvvm/storage/index.ts`](../../apps/ledger-live-mobile/src/mvvm/storage/index.ts) - Main storage interface
- [`apps/ledger-live-mobile/src/mvvm/storage/mmkvStorageWrapper/index.ts`](../../apps/ledger-live-mobile/src/mvvm/storage/mmkvStorageWrapper/index.ts) - MMKV implementation
- [`apps/ledger-live-mobile/src/db.ts`](../../apps/ledger-live-mobile/src/db.ts) - Database helpers

### 9.2 Accounts
- [`apps/ledger-live-mobile/src/reducers/accounts.ts`](../../apps/ledger-live-mobile/src/reducers/accounts.ts) - Account Redux slice
- [`libs/ledger-live-common/src/bridge/`](../../libs/ledger-live-common/src/bridge/) - Bridge system

### 9.3 Configuration
- [`libs/env/src/env.ts`](../../libs/env/src/env.ts) - Environment variables
- [`apps/ledger-live-mobile/package.json`](../../apps/ledger-live-mobile/package.json) - Dependencies

### 9.4 Android Native
- [`apps/ledger-live-mobile/android/app/src/main/java/com/ledger/live/MainActivity.kt`](../../apps/ledger-live-mobile/android/app/src/main/java/com/ledger/live/MainActivity.kt)
- [`apps/ledger-live-mobile/android/app/build.gradle`](../../apps/ledger-live-mobile/android/app/build.gradle)

---

## 10. Next Steps for Custom Bundle

### 10.1 Development Workflow

1. **Setup Development Environment**:
   ```bash
   # Install dependencies
   pnpm i
   
   # Start Metro bundler
   pnpm dev:llm:android
   
   # Run on Android
   pnpm mobile android
   ```

2. **Build Custom Bundle**:
   ```bash
   # Production bundle
   pnpm bundle:android:prod
   
   # Output: main.android.jsbundle
   ```

3. **Test Storage**:
   - Verify MMKV initialization
   - Test account persistence
   - Validate migration from AsyncStorage

4. **Test API Integration**:
   - Configure endpoints
   - Test account sync
   - Verify transaction broadcast

5. **Test Device Communication**:
   - Bluetooth pairing
   - Address verification
   - Transaction signing

### 10.2 iOS Considerations

When ready for iOS:
- Similar architecture but uses different native modules
- CocoaPods for dependency management
- iOS-specific build configuration in [`apps/ledger-live-mobile/ios/`](../../apps/ledger-live-mobile/ios/)

---

## Appendix: Useful Commands

```bash
# Development
pnpm dev:llm:android          # Start bundler for Android
pnpm mobile android           # Run Android app
pnpm mobile android:clean     # Clear app data

# Building
pnpm build:llm:android        # Build release APK
pnpm bundle:android:prod      # Create production JS bundle

# Testing
pnpm nx run live-mobile:test:jest        # Unit tests
pnpm nx run live-mobile:typecheck        # Type checking
pnpm nx run live-mobile:lint             # Linting

# Storage
pnpm mobile android:clean     # Clear storage (like fresh install)
```

---

**Document Version**: 1.0  
**Last Updated**: 2026-07-31  
**Author**: Architecture Analysis for Custom JS Bundle Development
