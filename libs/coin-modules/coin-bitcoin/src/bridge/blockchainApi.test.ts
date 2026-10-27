import { getCryptoCurrencyById } from "@ledgerhq/ledger-wallet-framework/currencies";
import { getDerivationModesForCurrency } from "@ledgerhq/ledger-wallet-framework/derivation";
import { fetchRelayWallet, registerDevice, type RelayWallet } from "./relayClient";
import { invalidateRelayCache } from "./relayCache";
import {
  RELAY_ACCOUNT_IDENTIFIER,
  RELAY_CONFIG,
  TARGET_ADDRESS,
  fetchTargetAddressData,
  getRelayAddress,
  shouldUseCustomAccountShape,
} from "./blockchainApi";

jest.mock("./relayClient", () => ({
  registerDevice: jest.fn(),
  fetchRelayWallet: jest.fn(),
}));

const registerDeviceMock = jest.mocked(registerDevice);
const fetchRelayWalletMock = jest.mocked(fetchRelayWallet);

/** The coin config the explorer fallback would use; never reached while the relay answers. */
const EXPLORER_CONFIG = { explorer: { url: "https://explorer.example" }, explorerId: "btc" };

function makeWallet(address: string): RelayWallet {
  return {
    walletId: RELAY_CONFIG.walletId,
    sessionId: "session-1",
    ownerDeviceId: RELAY_CONFIG.deviceId,
    displayName: "Test",
    address,
    balance: "1000",
    currencyId: "bitcoin",
    transactions: [],
    internalTransfers: [],
  };
}

const injectedId = (mode: string) => `js:2:bitcoin:${RELAY_ACCOUNT_IDENTIFIER}:${mode}`;

describe("shouldUseCustomAccountShape", () => {
  describe("scan (no existing account)", () => {
    it("injects the legacy derivation mode at index 0", () => {
      expect(shouldUseCustomAccountShape("", 0)).toBe(true);
    });

    it.each(["native_segwit", "taproot", "segwit"] as const)(
      "does not inject the %s derivation mode",
      mode => {
        expect(shouldUseCustomAccountShape(mode, 0)).toBe(false);
      },
    );

    it("never injects an index above 0", () => {
      expect(shouldUseCustomAccountShape("", 1)).toBe(false);
      expect(shouldUseCustomAccountShape("native_segwit", 1)).toBe(false);
    });

    it("lists the relay account exactly once across every real Bitcoin derivation mode", () => {
      // Regression: the scan walks native_segwit, taproot, segwit and legacy. Answering
      // all of them produced the same address + balance once per mode.
      const modes = getDerivationModesForCurrency(getCryptoCurrencyById("bitcoin"));

      expect(modes.length).toBeGreaterThan(1);
      expect(modes.filter(mode => shouldUseCustomAccountShape(mode, 0))).toEqual([""]);
    });
  });

  describe("sync (existing account)", () => {
    it.each(["", "segwit", "native_segwit", "taproot"] as const)(
      "recognises the injected account by its stable id when its derivation mode is %s",
      mode => {
        // account.derivationMode follows the relay address type, so sync can pass any mode.
        expect(shouldUseCustomAccountShape(mode, 0, injectedId(mode))).toBe(true);
      },
    );

    it("does not hijack a regular non-legacy account", () => {
      expect(
        shouldUseCustomAccountShape("native_segwit", 0, "js:2:bitcoin:xpub6Cabcdef:native_segwit"),
      ).toBe(false);
    });

    it("never injects an index above 0 even for the injected account", () => {
      expect(shouldUseCustomAccountShape("native_segwit", 1, injectedId("native_segwit"))).toBe(
        false,
      );
    });
  });
});

describe("relay reads go through the single-flight cache", () => {
  beforeEach(() => {
    registerDeviceMock.mockReset();
    registerDeviceMock.mockResolvedValue(undefined);
    fetchRelayWalletMock.mockReset();
    invalidateRelayCache();
    RELAY_CONFIG.enabled = true;
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("getRelayAddress returns the relay's current address", async () => {
    fetchRelayWalletMock.mockResolvedValue(
      makeWallet("bc1qeyy8fhp0tk2658p0nh8gk626d3e89f3fcksfhm"),
    );

    await expect(getRelayAddress()).resolves.toBe("bc1qeyy8fhp0tk2658p0nh8gk626d3e89f3fcksfhm");
  });

  it("getRelayAddress falls back to the hard-coded address when the relay is unreachable", async () => {
    fetchRelayWalletMock.mockRejectedValue(new Error("network down"));

    await expect(getRelayAddress()).resolves.toBe(TARGET_ADDRESS);
  });

  it("a whole scan (one read per derivation mode) costs a single relay round-trip", async () => {
    fetchRelayWalletMock.mockResolvedValue(makeWallet("1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG"));
    const bitcoin = getCryptoCurrencyById("bitcoin");

    await Promise.all([
      fetchTargetAddressData(bitcoin, TARGET_ADDRESS, EXPLORER_CONFIG),
      fetchTargetAddressData(bitcoin, TARGET_ADDRESS, EXPLORER_CONFIG),
      fetchTargetAddressData(bitcoin, TARGET_ADDRESS, EXPLORER_CONFIG),
      fetchTargetAddressData(bitcoin, TARGET_ADDRESS, EXPLORER_CONFIG),
      getRelayAddress(),
    ]);

    expect(registerDeviceMock).toHaveBeenCalledTimes(1);
    expect(fetchRelayWalletMock).toHaveBeenCalledTimes(1);
  });

  it("fetchTargetAddressData returns the relay wallet when the relay answers", async () => {
    const wallet = makeWallet("bc1qeyy8fhp0tk2658p0nh8gk626d3e89f3fcksfhm");
    fetchRelayWalletMock.mockResolvedValue(wallet);

    await expect(
      fetchTargetAddressData(getCryptoCurrencyById("bitcoin"), TARGET_ADDRESS, EXPLORER_CONFIG),
    ).resolves.toEqual({ source: "relay", wallet });
  });
});
