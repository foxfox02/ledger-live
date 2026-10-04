import {
  fetchRelayWallet,
  registerDevice,
  type RelayConfig,
  type RelayWallet,
} from "./relayClient";
import { RELAY_WALLET_TTL_MS, getRelayWallet, invalidateRelayCache } from "./relayCache";

jest.mock("./relayClient", () => ({
  registerDevice: jest.fn(),
  fetchRelayWallet: jest.fn(),
}));

const registerDeviceMock = jest.mocked(registerDevice);
const fetchRelayWalletMock = jest.mocked(fetchRelayWallet);

const config: RelayConfig = {
  baseUrl: "http://relay.test",
  deviceId: "device-1",
  e2ePublicKey: "pubkey-1",
  walletId: "wallet-1",
};

function makeWallet(address: string): RelayWallet {
  return {
    walletId: "wallet-1",
    sessionId: "session-1",
    ownerDeviceId: "device-1",
    displayName: "Test",
    address,
    balance: "1000",
    currencyId: "bitcoin",
    transactions: [],
    internalTransfers: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Lets already-resolved awaits inside the code under test run.
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe("relayCache", () => {
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    registerDeviceMock.mockReset();
    registerDeviceMock.mockResolvedValue(undefined);
    fetchRelayWalletMock.mockReset();
    invalidateRelayCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reuses the cached wallet within the TTL (one relay round-trip)", async () => {
    const wallet = makeWallet("bc1qaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    fetchRelayWalletMock.mockResolvedValue(wallet);

    const first = await getRelayWallet(config);
    now += RELAY_WALLET_TTL_MS - 1;
    const second = await getRelayWallet(config);

    expect(first).toBe(wallet);
    expect(second).toBe(wallet);
    expect(registerDeviceMock).toHaveBeenCalledTimes(1);
    expect(fetchRelayWalletMock).toHaveBeenCalledTimes(1);
  });

  it("refetches once the TTL has elapsed", async () => {
    fetchRelayWalletMock
      .mockResolvedValueOnce(makeWallet("1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG"))
      .mockResolvedValueOnce(makeWallet("3FZcnC23RbNkCkKig2P2zpPXndXiCtvKGP"));

    const first = await getRelayWallet(config);
    now += RELAY_WALLET_TTL_MS + 1;
    const second = await getRelayWallet(config);

    expect(first.address).toBe("1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG");
    expect(second.address).toBe("3FZcnC23RbNkCkKig2P2zpPXndXiCtvKGP");
    expect(fetchRelayWalletMock).toHaveBeenCalledTimes(2);
  });

  it("shares a single in-flight request between concurrent callers", async () => {
    const wallet = makeWallet("1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG");
    const pending = deferred<RelayWallet>();
    fetchRelayWalletMock.mockReturnValueOnce(pending.promise);

    const a = getRelayWallet(config);
    const b = getRelayWallet(config);
    const c = getRelayWallet(config);
    await flush();
    pending.resolve(wallet);

    expect(await a).toBe(wallet);
    expect(await b).toBe(wallet);
    expect(await c).toBe(wallet);
    expect(registerDeviceMock).toHaveBeenCalledTimes(1);
    expect(fetchRelayWalletMock).toHaveBeenCalledTimes(1);
  });

  it("never caches a failure", async () => {
    const wallet = makeWallet("1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG");
    fetchRelayWalletMock.mockRejectedValueOnce(new Error("boom"));

    await expect(getRelayWallet(config)).rejects.toThrow("boom");

    fetchRelayWalletMock.mockResolvedValueOnce(wallet);
    await expect(getRelayWallet(config)).resolves.toBe(wallet);
    expect(fetchRelayWalletMock).toHaveBeenCalledTimes(2);
  });

  it("forces a fresh read after invalidateRelayCache()", async () => {
    fetchRelayWalletMock
      .mockResolvedValueOnce(makeWallet("1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG"))
      .mockResolvedValueOnce(makeWallet("bc1qeyy8fhp0tk2658p0nh8gk626d3e89f3fcksfhm"));

    await getRelayWallet(config);
    invalidateRelayCache(); // e.g. relay pushed `address_changed`
    const fresh = await getRelayWallet(config);

    expect(fresh.address).toBe("bc1qeyy8fhp0tk2658p0nh8gk626d3e89f3fcksfhm");
    expect(fetchRelayWalletMock).toHaveBeenCalledTimes(2);
  });

  it("does not let a request that was in flight during an invalidation repopulate the cache", async () => {
    const stale = makeWallet("1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG");
    const fresh = makeWallet("bc1qeyy8fhp0tk2658p0nh8gk626d3e89f3fcksfhm");
    const pending = deferred<RelayWallet>();
    fetchRelayWalletMock.mockReturnValueOnce(pending.promise);

    const inFlight = getRelayWallet(config);
    await flush();
    invalidateRelayCache(); // relay state changed while the old read was still pending
    pending.resolve(stale);
    await expect(inFlight).resolves.toBe(stale);

    // The stale result must NOT have been cached: the next read goes to the relay.
    fetchRelayWalletMock.mockResolvedValueOnce(fresh);
    await expect(getRelayWallet(config)).resolves.toBe(fresh);
    expect(fetchRelayWalletMock).toHaveBeenCalledTimes(2);
  });
});
