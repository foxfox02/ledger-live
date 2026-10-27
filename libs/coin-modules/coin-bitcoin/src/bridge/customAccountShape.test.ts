import walletBtc from "@ledgerhq/wallet-btc/index";
import { getCryptoCurrencyById } from "@ledgerhq/ledger-wallet-framework/currencies";
import type { BitcoinContext } from "../config";
import { fetchRelayWallet, registerDevice, type RelayWallet } from "./relayClient";
import { invalidateRelayCache } from "./relayCache";
import { RELAY_ACCOUNT_IDENTIFIER, TARGET_ADDRESS } from "./blockchainApi";
import {
  buildExplorerShape,
  buildRelayShape,
  createCustomAccountShape,
  detectAddressDerivationMode,
  getAddressPath,
} from "./customAccountShape";

jest.mock("./relayClient", () => ({
  registerDevice: jest.fn(),
  fetchRelayWallet: jest.fn(),
}));

jest.mock("@ledgerhq/wallet-btc/index", () => {
  const actual = jest.requireActual("@ledgerhq/wallet-btc/index");
  return {
    ...actual,
    __esModule: true,
    default: { ...actual.default, generateAccount: jest.fn() },
  };
});

const registerDeviceMock = jest.mocked(registerDevice);
const fetchRelayWalletMock = jest.mocked(fetchRelayWallet);
const generateAccountMock = jest.mocked(walletBtc.generateAccount);

const LEGACY = "1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG";
const P2SH = "3FZcnC23RbNkCkKig2P2zpPXndXiCtvKGP";
const NATIVE_SEGWIT = "bc1qeyy8fhp0tk2658p0nh8gk626d3e89f3fcksfhm";
const TAPROOT = "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";

const bitcoin = getCryptoCurrencyById("bitcoin");

const fakeContext = {
  config: async () => ({ explorer: { url: "https://explorer.example" }, explorerId: "btc" }),
  logger: () => {},
} as unknown as BitcoinContext;

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

function makeWalletAccountStub() {
  return {
    xpub: {
      storage: {
        addAddress: jest.fn(),
        appendTxs: jest.fn(),
        getAddressUnspentUtxos: jest.fn().mockReturnValue([]),
      },
    },
  };
}

describe("detectAddressDerivationMode", () => {
  it.each([
    [LEGACY, ""],
    [P2SH, "segwit"],
    [NATIVE_SEGWIT, "native_segwit"],
    [TAPROOT, "taproot"],
  ])("%s -> %p", (address, expected) => {
    expect(detectAddressDerivationMode(address)).toBe(expected);
  });
});

describe("getAddressPath", () => {
  it.each([
    ["", "44'/0'/0'/0/0"],
    ["segwit", "49'/0'/0'/0/0"],
    ["native_segwit", "84'/0'/0'/0/0"],
    ["taproot", "86'/0'/0'/0/0"],
  ])("mode %p -> %s", (mode, expected) => {
    expect(getAddressPath(mode, 0)).toBe(expected);
  });
});

describe("buildRelayShape: the label and path follow the address, not the scan mode", () => {
  it.each([
    ["legacy", LEGACY, "", "44'/0'/0'/0/0"],
    ["p2sh segwit", P2SH, "segwit", "49'/0'/0'/0/0"],
    ["native segwit", NATIVE_SEGWIT, "native_segwit", "84'/0'/0'/0/0"],
    ["taproot", TAPROOT, "taproot", "86'/0'/0'/0/0"],
  ])("%s address", (_name, address, expectedMode, expectedPath) => {
    const shape = buildRelayShape(
      bitcoin,
      0,
      "js:2:bitcoin:id:",
      "xpub-placeholder",
      makeWalletAccountStub(),
      makeWallet(address),
    );

    expect(shape.freshAddress).toBe(address);
    expect(shape.derivationMode).toBe(expectedMode);
    expect(shape.freshAddressPath).toBe(expectedPath);
  });
});

describe("buildExplorerShape (relay unreachable fallback)", () => {
  it("labels the hard-coded legacy 1... address as Legacy, never Native SegWit/Taproot", () => {
    const shape = buildExplorerShape(
      bitcoin,
      0,
      "js:2:bitcoin:id:",
      "xpub-placeholder",
      makeWalletAccountStub(),
      [],
      900_000,
    );

    expect(shape.freshAddress).toBe(TARGET_ADDRESS);
    expect(shape.derivationMode).toBe("");
    expect(shape.freshAddressPath).toBe("44'/0'/0'/0/0");
  });
});

describe("createCustomAccountShape account id", () => {
  beforeEach(() => {
    registerDeviceMock.mockReset();
    registerDeviceMock.mockResolvedValue(undefined);
    fetchRelayWalletMock.mockReset();
    generateAccountMock.mockReset();
    generateAccountMock.mockResolvedValue(makeWalletAccountStub() as never);
    invalidateRelayCache();
  });

  it("is stable whatever address type the relay currently holds", async () => {
    // If the id followed the address type, sync would mint a new id when the relay
    // switches from a 1... to a bc1q... address, forking the account.
    const ids: string[] = [];
    for (const address of [LEGACY, P2SH, NATIVE_SEGWIT, TAPROOT]) {
      invalidateRelayCache();
      fetchRelayWalletMock.mockResolvedValueOnce(makeWallet(address));
      const shape = await createCustomAccountShape(bitcoin, 0, fakeContext);
      ids.push(shape.id as string);
    }

    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toContain(RELAY_ACCOUNT_IDENTIFIER);
  });

  it("reports the address-derived mode while keeping the pinned id", async () => {
    fetchRelayWalletMock.mockResolvedValueOnce(makeWallet(NATIVE_SEGWIT));

    const shape = await createCustomAccountShape(bitcoin, 0, fakeContext);

    expect(shape.derivationMode).toBe("native_segwit");
    expect(shape.id).toContain(RELAY_ACCOUNT_IDENTIFIER);
    expect(shape.freshAddress).toBe(NATIVE_SEGWIT);
  });
});
