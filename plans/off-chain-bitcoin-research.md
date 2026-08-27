# Off-Chain Bitcoin Send/Receive — Feasibility Research

## 1. Current Mock Architecture (What We Already Have)

The existing injection system already mocks 5 of the 6 steps in the Bitcoin send flow:

```
┌─────────────────────────────────────────────────────────────────┐
│                    CURRENT MOCK LAYERS                           │
├──────────────┬──────────────────────────────────────────────────┤
│ Layer        │ What it does                                      │
├──────────────┼──────────────────────────────────────────────────┤
│ blockchainApi│ Fetches REAL blockchain data from Ledger's v4     │
│              │ explorer for the target address (balance, UTXOs,  │
│              │ transactions). This is the ONLY layer that still  │
│              │ touches the real blockchain.                      │
├──────────────┼──────────────────────────────────────────────────┤
│ customAccount│ Creates a fake Ledger Live account using real      │
│ Shape        │ blockchain data + a mock walletAccount with       │
│              │ populated UTXO storage.                           │
├──────────────┼──────────────────────────────────────────────────┤
│ hw-getAddress│ Returns the target address (1GR9qNz...) for       │
│ -injected    │ specific derivation paths instead of querying     │
│              │ the hardware device.                              │
├──────────────┼──────────────────────────────────────────────────┤
│ signer-      │ Mocks splitTransaction + createPaymentTransaction │
│ injected     │ so signing never touches the hardware device.     │
├──────────────┼──────────────────────────────────────────────────┤
│ buildTrans-  │ Bypasses the real wallet-btc transaction builder  │
│ action       │ and returns mock tx inputs/outputs with fees.     │
├──────────────┼──────────────────────────────────────────────────┤
│ js.ts        │ Wraps broadcast to return a mock tx hash for the  │
│ (broadcast)  │ injected address instead of broadcasting to the   │
│              │ Bitcoin network.                                  │
└──────────────┴──────────────────────────────────────────────────┘
```

**Key insight:** The only layer still touching the real blockchain is `blockchainApi.ts` — it fetches real UTXOs, balances, and transaction history from Ledger's explorer API. Everything else is already mocked.

## 2. What an Off-Chain System Would Need

### 2.1 Local UTXO Ledger (replaces blockchainApi)

Instead of fetching UTXOs from the explorer, maintain a **local, mutable UTXO ledger**:

```typescript
// Conceptual — not actual code
interface LocalUtxoLedger {
  [address: string]: {
    utxos: Array<{ txid: string; vout: number; value: number; spent: boolean }>;
    transactions: Array<{ txid: string; from: string; to: string; amount: number; timestamp: number }>;
  };
}
```

When Address A "sends" to Address B:
1. Mark one of A's UTXOs as `spent: true`
2. Create a new UTXO for B with the sent amount (minus mock fee)
3. Create a new UTXO for A with the change amount
4. Add a transaction record to both A and B's histories

### 2.2 Intercepted Sync (replaces customAccountShape)

Instead of building the account from real blockchain data, build it from the local ledger:

```typescript
// Conceptual
function createOffChainAccountShape(address: string, ledger: LocalUtxoLedger) {
  const entry = ledger[address];
  const balance = entry.utxos.filter(u => !u.spent).reduce((sum, u) => sum + u.value, 0);
  return {
    balance: new BigNumber(balance),
    utxos: entry.utxos.filter(u => !u.spent).map(toBitcoinUtxo),
    operations: entry.transactions.map(toOperation),
    // ... rest of account shape
  };
}
```

### 2.3 Transaction Processor

A new module that:
1. Receives a "send" request (from address, to address, amount)
2. Selects UTXOs from the sender's pool
3. Creates new UTXOs for the receiver and change
4. Updates the local ledger
5. Triggers a re-sync of both accounts

### 2.4 Persistence Layer

The local ledger must survive app restarts. Options:
- **AsyncStorage** (React Native built-in) — simplest, already available
- **SQLite** — better for larger datasets
- **File system** — JSON file, simple but no query capability

## 3. Architecture Options

### Option A: Single-Device, Two Accounts (SIMPLEST)

```
┌──────────────────────────────────────────┐
│              Ledger Live App              │
│                                           │
│  ┌─────────┐         ┌─────────┐         │
│  │ Account │  send   │ Account │         │
│  │    A    │────────▶│    B    │         │
│  │(1GR9qNz)│         │(NEW ADDR)│        │
│  └─────────┘         └─────────┘         │
│       │                   │               │
│       ▼                   ▼               │
│  ┌─────────────────────────────────┐     │
│  │       Local UTXO Ledger          │     │
│  │  (AsyncStorage / SQLite / JSON)  │     │
│  └─────────────────────────────────┘     │
│                                           │
│  No server needed. Both accounts on the   │
│  same device. Perfect for demo/PoC.       │
└──────────────────────────────────────────┘
```

**Pros:**
- Zero infrastructure
- Instant "confirmation"
- Both accounts visible in the same app
- Can demonstrate full send/receive flow

**Cons:**
- Both accounts on same device (not realistic for two-party)
- No network communication

### Option B: Two-Device, Server-Mediated (REALISTIC)

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  Device 1    │         │   Server     │         │  Device 2    │
│  Account A   │         │  (Node.js)   │         │  Account B   │
│              │  POST   │              │  GET    │              │
│  Send 0.1    │────────▶│  UTXO Ledger │◀────────│  Check       │
│  BTC to B    │         │  + Tx Log    │         │  balance     │
│              │         │              │         │              │
│  Get new     │◀────────│  WebSocket   │────────▶│  New UTXO    │
│  balance     │  SSE    │  for push    │  push   │  received    │
└──────────────┘         └──────────────┘         └──────────────┘
```

**Server responsibilities:**
- Maintain the authoritative UTXO ledger
- Accept transaction submissions from senders
- Notify receivers of new UTXOs (WebSocket/SSE)
- Serve account state (balance, UTXOs, history) on demand
- Simple REST API + WebSocket — ~200 lines of Node.js

**Pros:**
- Realistic two-party flow
- Server can run on localhost, LAN, or cloud
- Can add multiple participants
- WebSocket enables real-time updates

**Cons:**
- Requires a running server
- Server is a single point of failure (but this is a demo, not production)
- Network latency (minimal on localhost/LAN)

### Option C: P2P (NO SERVER)

```
┌──────────────┐                    ┌──────────────┐
│  Device 1    │◀──── Bluetooth ───▶│  Device 2    │
│  Account A   │    / WiFi Direct   │  Account B   │
│              │                    │              │
│  Each device maintains its own    │              │
│  copy of the UTXO ledger.         │              │
│  Transactions are broadcast P2P.  │              │
└──────────────┘                    └──────────────┘
```

**Pros:**
- No server infrastructure
- Truly decentralized

**Cons:**
- Complex state synchronization
- Both devices must be online simultaneously
- Conflict resolution needed
- Much harder to implement

## 4. Technical Feasibility Assessment

### 4.1 What's Already Solved (by our existing mocks)

| Component | Status | Notes |
|-----------|--------|-------|
| Address injection | ✅ Done | `hw-getAddress-injected.ts` |
| Account creation | ✅ Done | `customAccountShape.ts` |
| Signing bypass | ✅ Done | `signer-injected.ts` |
| Transaction building | ✅ Done | `buildTransaction.ts` bypass |
| Broadcast bypass | ✅ Done | `js.ts` wrappedBroadcast |
| Device-action resolver | ✅ Done | `setup.ts` injectedResolver |

### 4.2 What Needs to Be Built

| Component | Effort | Complexity |
|-----------|--------|------------|
| Local UTXO ledger | Medium | Data structure + CRUD operations |
| Off-chain account shape | Low | Modify `customAccountShape.ts` to read from local ledger |
| Transaction processor | Medium | UTXO selection + ledger update |
| Persistence layer | Low | AsyncStorage wrapper |
| Second address injection | Low | Register additional derivation path |
| Server (Option B only) | Medium | REST API + WebSocket, ~200 lines |
| Account re-sync trigger | Low | Force sync after transaction |

### 4.3 Can We Run a Server on the Ledger Wallet?

**Short answer: No, not directly on the hardware wallet.**

The Ledger Nano X/S is a secure element — it runs a custom OS (BOLOS), not a general-purpose OS. You cannot run a Node.js server on it.

**But you CAN run a server:**
- On the **phone** (Android/iOS) — a background service or a separate app
- On a **local machine** (your Mac/PC) — Node.js server on localhost
- On a **cloud VM** — accessible from anywhere
- **Embedded in the Ledger Live APK itself** — a lightweight HTTP server within the React Native app (using `react-native-tcp-socket` or similar)

### 4.4 Embedded Server in the APK (Most Interesting)

React Native can run a lightweight HTTP server using libraries like:
- `react-native-tcp-socket`
- `react-native-http-bridge`
- A custom native module

This means **one device could act as both client and server** — the "sender" device hosts the UTXO ledger, and the "receiver" device connects to it. No external infrastructure needed.

## 5. Recommended Implementation Path

### Phase 1: Single-Device Demo (Option A)
1. Create `LocalUtxoLedger` class with AsyncStorage persistence
2. Modify `customAccountShape.ts` to accept an optional local ledger
3. Add a second injected address (different derivation index)
4. Implement the transaction processor
5. Wire the "send" flow to update the local ledger instead of broadcasting

**Estimated new code:** ~300 lines across 3-4 files

### Phase 2: Two-Device with Embedded Server (Option B variant)
1. Add a lightweight HTTP server to the APK
2. Expose REST endpoints: `POST /tx`, `GET /account/:addr`
3. Add WebSocket for real-time balance updates
4. Second device connects to first device's server

**Estimated new code:** ~500 lines across 5-6 files

## 6. Limitations & Challenges

### 6.1 Fundamental Limitations

1. **No real Bitcoin involved** — This is a simulation. The UTXOs don't exist on the blockchain. You can't later broadcast them to the real network.

2. **No private keys** — We don't have the private keys for the injected addresses. Signatures are mocked. This is fine for a demo but means the transactions are cryptographically invalid.

3. **Single source of truth** — In a multi-device setup, the server (or one device) holds the authoritative ledger. If it goes down, state is lost (unless persisted).

4. **No consensus** — There's no mining, no proof-of-work, no network validation. This is a centralized simulation.

### 6.2 Ledger Live-Specific Challenges

1. **Sync mechanism** — Ledger Live's sync is designed to pull from the blockchain. We'd need to intercept `getAccountShape` to return local ledger data instead.

2. **Account discovery** — The scan flow discovers accounts by derivation path. We'd need to register both addresses' paths.

3. **Balance display** — The app shows balance from `account.balance`. If we update the local ledger but don't trigger a re-sync, the UI won't update.

4. **Operation history** — The transaction list comes from `account.operations`. We need to populate this from our local transaction log.

### 6.3 Security Considerations

1. **No cryptographic verification** — Transactions aren't signed with real keys. Anyone with access to the local ledger can forge transactions.

2. **No double-spend protection** — Without blockchain consensus, double-spending is trivially possible if the ledger isn't properly locked.

3. **No network security** — If using a server, transactions are sent over plain HTTP unless TLS is configured.

## 7. Conclusion

**Feasibility: HIGH for single-device, MEDIUM for two-device with server.**

The existing mock infrastructure already handles 5 of 6 steps in the send flow. The only missing piece is replacing the real blockchain data source (`blockchainApi.ts`) with a local, mutable ledger. This is a well-scoped change.

For a single-device demo (both addresses on the same phone), the implementation is straightforward — ~300 lines of new code, no server needed, and it would demonstrate the full send/receive flow with instant "confirmation."

For a two-device setup, adding an embedded HTTP server to the APK is technically feasible and would create a compelling demo of off-chain Bitcoin transactions between two phones.

The Ledger hardware wallet itself cannot run a server, but the phone running Ledger Live certainly can.