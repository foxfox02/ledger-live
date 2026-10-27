/**
 * Relay WebSocket client — connects to the relay's real-time event channel
 * (`/api/v1/ws`) so the app can react to incoming transfers immediately
 * instead of waiting for the next polled sync.
 *
 * Auth matches the relay's WS handshake: signed query params
 * `{ deviceId, nonce, ts }` using the same HMAC scheme as relayClient.ts.
 *
 * The relay pushes `{ type: "transfer_event", data: { type: "transfer_received", ... } }`.
 * On such an event we invoke the registered callback so the caller can trigger
 * a re-sync of the account (which pulls the new transaction with its exact txid).
 */
import { sha256 } from "../crypto-util";
import type { RelayConfig } from "./relayClient";
import { invalidateRelayCache } from "./relayCache";

/**
 * Module-level handler registry. The bridge layer starts the socket and
 * forwards incoming-transfer events here; the app layer (ledger-live-mobile)
 * registers a handler that triggers a re-sync of the account. This keeps the
 * bridge decoupled from the app's sync engine.
 */
let globalTransferHandler: ((event: RelayTransferEvent) => void) | null = null;

/** Register the app-level handler for incoming-transfer events. */
export function setRelayTransferHandler(cb: ((event: RelayTransferEvent) => void) | null): void {
  globalTransferHandler = cb;
}

/** Invoked by the socket when a transfer_received event arrives. */
function dispatchTransferReceived(event: RelayTransferEvent): void {
  // The relay state just changed: drop the cached wallet BEFORE the handler
  // triggers a re-sync, so that sync reads fresh data instead of the cache.
  invalidateRelayCache();
  if (globalTransferHandler) {
    try {
      globalTransferHandler(event);
    } catch (e) {
      console.warn("[relay-socket] transfer handler error:", e);
    }
  }
}

/** Canonicalize an object into a stable string (matches relay's crypto.ts). */
function canonicalize(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  return keys.map(k => `${k}=${String(obj[k])}`).join("&");
}

/** Dev-mode HMAC signature: base64(sha256(publicKey + payload)). */
function signPayload(publicKey: string, payload: string): string {
  const hash = sha256(publicKey + payload);
  return Buffer.from(hash).toString("base64");
}

/** Generate a random hex nonce. */
function generateNonce(): string {
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

/** A transfer event pushed by the relay over WebSocket. */
export interface RelayTransferEvent {
  type: string;
  intentId: string;
  currencyId: string;
  amount: string;
  senderName?: string;
  recipientName?: string;
  timestamp: string;
}

export interface RelaySocket {
  /** Start the connection (idempotent). */
  connect(): void;
  /** Stop the connection. */
  disconnect(): void;
  /** Register a handler for incoming-transfer events. */
  onTransferReceived(cb: (event: RelayTransferEvent) => void): void;
}

/**
 * Create a relay WebSocket client. `onTransferReceived` is invoked whenever the
 * relay emits a `transfer_received` event for this device.
 */
export function createRelaySocket(config: RelayConfig): RelaySocket {
  let ws: WebSocket | null = null;
  let shouldReconnect = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let transferHandler: ((event: RelayTransferEvent) => void) | null = null;

  function buildUrl(): string {
    const nonce = generateNonce();
    const ts = String(Date.now());
    const payload = canonicalize({ deviceId: config.deviceId, nonce, ts });
    const signature = signPayload(config.e2ePublicKey, payload);
    const base = config.baseUrl.replace(/^http/, "ws");
    return `${base}/api/v1/ws?deviceId=${encodeURIComponent(config.deviceId)}&signature=${encodeURIComponent(signature)}&nonce=${encodeURIComponent(nonce)}&ts=${encodeURIComponent(ts)}`;
  }

  function scheduleReconnect() {
    if (!shouldReconnect) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      connect();
    }, 5000);
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    try {
      ws = new WebSocket(buildUrl());
    } catch (e) {
      console.warn("[relay-socket] failed to open WS:", e);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log("[relay-socket] connected");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg?.type === "transfer_event") {
          const data = msg.data as RelayTransferEvent;
          // Re-sync on incoming transfers AND address changes so the app
          // reflects the relay's latest state (new tx or new address) promptly.
          if (data?.type === "transfer_received" || data?.type === "address_changed") {
            dispatchTransferReceived(data);
            transferHandler?.(data);
          }
        }
      } catch (e) {
        console.warn("[relay-socket] bad message:", e);
      }
    };

    ws.onclose = () => {
      ws = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire and schedule a reconnect.
    };
  }

  return {
    connect() {
      shouldReconnect = true;
      connect();
    },
    disconnect() {
      shouldReconnect = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
    },
    onTransferReceived(cb) {
      transferHandler = cb;
    },
  };
}