/**
 * Relay client — lets the mobile app talk to the P2P relay so the displayed
 * Bitcoin account reflects the relay's simulated/frozen wallet state instead
 * of (or blended with) the raw on-chain data.
 *
 * The relay's dev-mode device auth uses a simple HMAC scheme:
 *   signature = base64( SHA256( e2ePublicKey + canonicalize({deviceId,nonce,ts}) ) )
 * We replicate that here using @noble/hashes (already a dependency) so no
 * extra crypto library is required.
 *
 * If the relay is unreachable, every method throws so the caller can fall
 * back to the direct Ledger explorer (see blockchainApi.ts).
 */
import { sha256 } from "../crypto-util";

/** Relay configuration. */
export interface RelayConfig {
  /** Base URL of the relay, e.g. http://localhost:8080 */
  baseUrl: string;
  /** Stable device id registered with the relay. */
  deviceId: string;
  /** e2ePublicKey registered with the relay (used for HMAC signing). */
  e2ePublicKey: string;
  /** Wallet id whose balance/state this device is authorized to read. */
  walletId: string;
  /** Timeout for relay HTTP calls (ms). */
  timeoutMs?: number;
}

/** A wallet as returned by the relay. */
export interface RelayWallet {
  walletId: string;
  sessionId: string;
  ownerDeviceId: string;
  displayName: string;
  address: string;
  balance: string; // satoshis as string
  currencyId: string;
  frozenBlockHeight?: number | null;
  pendingReplay?: {
    txid: string;
    recipientWalletId: string;
    amount: string;
    blockHeight: number;
  } | null;
  lastReconciledOutputs?: { address: string; value: string }[];
  transactions: {
    hash: string;
    type: "IN" | "OUT";
    value: string;
    fee: string;
    timestamp: string;
    blockHeight: number | null;
  }[];
  internalTransfers: {
    transferId: string;
    counterpartyWalletId: string;
    amount: string;
    direction: "IN" | "OUT";
    timestamp: string;
  }[];
  balanceHistoryCache?: {
    HOUR: { latestDate: number | null; balances: number[] };
    DAY: { latestDate: number | null; balances: number[] };
    WEEK: { latestDate: number | null; balances: number[] };
  };
}

/** Canonicalize an object into a stable string (matches relay's crypto.ts). */
export function canonicalize(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  return keys.map(k => `${k}=${String(obj[k])}`).join("&");
}

/** Dev-mode HMAC signature: base64(sha256(publicKey + payload)). */
export function signPayload(publicKey: string, payload: string): string {
  const hash = sha256(publicKey + payload);
  return Buffer.from(hash).toString("base64");
}

/** Generate a random hex nonce. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Build the signed headers required by requireDevice(). */
function signedHeaders(config: RelayConfig): Record<string, string> {
  const nonce = generateNonce();
  const ts = String(Date.now());
  const payload = canonicalize({ deviceId: config.deviceId, nonce, ts });
  const signature = signPayload(config.e2ePublicKey, payload);
  return {
    "x-device": config.deviceId,
    "x-device-signature": signature,
    "x-device-nonce": nonce,
    "x-device-ts": ts,
  };
}

async function request<T>(
  config: RelayConfig,
  req: { method?: string; url: string; data?: unknown },
): Promise<T> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}${req.url}`;
  // Note: AbortSignal.timeout() is NOT available in React Native's
  // `abort-controller` polyfill (only AbortController + instance .signal
  // are implemented), so we build the timeout manually instead.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10000);
  try {
    const res = await fetch(url, {
      method: req.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...signedHeaders(config),
        ...((req as any).headers ?? {}),
      },
      body: req.data ? JSON.stringify(req.data) : null,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Relay ${res.status}: ${body}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Register (or refresh) this device with the relay. */
export async function registerDevice(
  config: RelayConfig,
  displayName: string,
): Promise<void> {
  await request(config, {
    method: "POST",
    url: "/api/v1/devices/register",
    data: {
      deviceId: config.deviceId,
      displayName,
      pushToken: null,
      e2ePublicKey: config.e2ePublicKey,
    },
  });
}

/** Fetch the full simulated wallet state from the relay. */
export async function fetchRelayWallet(config: RelayConfig): Promise<RelayWallet> {
  const res = await request<{ wallet: RelayWallet }>(config, {
    method: "GET",
    url: `/api/v1/wallets/${config.walletId}`,
  });
  return res.wallet;
}

/** Fetch just the relay-managed balance (satoshis as string). */
export async function fetchRelayBalance(config: RelayConfig): Promise<string> {
  const res = await request<{ balance: string }>(config, {
    method: "GET",
    url: `/api/v1/wallets/${config.walletId}/balance`,
  });
  return res.balance;
}

/**
 * Simulate an outgoing transfer on the relay (the "send" replay). Records an
 * OUT transaction with the real txid's details, deducts amount + fee from the
 * balance, and clears any freeze state. This is what the app's broadcast step
 * calls instead of a real network broadcast for the relay account.
 */
export async function simulateRelayOutgoing(
  config: RelayConfig,
  input: { txid: string; amount: string; fee?: string; blockHeight?: number | null },
): Promise<RelayWallet> {
  const res = await request<{ wallet: RelayWallet }>(config, {
    method: "POST",
    url: `/api/v1/wallets/${config.walletId}/simulate-outgoing`,
    data: {
      txid: input.txid,
      amount: input.amount,
      fee: input.fee,
      blockHeight: input.blockHeight,
    },
  });
  return res.wallet;
}