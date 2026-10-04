/**
 * Persistent state management for Bitcoin injection
 * Handles system sleep/wake cycles and account state preservation
 */

import { BigNumber } from "bignumber.js";
import type { BitcoinAccount } from "../types";
import { RELAY_ACCOUNT_IDENTIFIER } from "./blockchainApi";

interface InjectedAccountState {
  accountId: string;
  balance: string;
  spendableBalance: string;
  operationsCount: number;
  operations: any[];
  utxos: any[];
  blockHeight: number;
  lastSyncDate: string;
  balanceHistoryCache: any;
  walletStorageData: any;
}

class PersistentStateManager {
  private static instance: PersistentStateManager;
  private storageKey = "bitcoin_injection_state";
  private isInitialized = false;

  static getInstance(): PersistentStateManager {
    if (!PersistentStateManager.instance) {
      PersistentStateManager.instance = new PersistentStateManager();
    }
    return PersistentStateManager.instance;
  }

  private constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners() {
    // Only set up browser-specific listeners if in a browser environment
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      // Listen for system sleep/wake events
      window.addEventListener("focus", this.handleSystemWake.bind(this));
      window.addEventListener("blur", this.handleSystemSleep.bind(this));

      // Listen for page visibility changes (more reliable for sleep/wake detection)
      document.addEventListener("visibilitychange", this.handleVisibilityChange.bind(this));

      // Listen for beforeunload to save state
      window.addEventListener("beforeunload", this.saveCurrentState.bind(this));
    }
    // Note: React Native doesn't have window/document, so we skip event listeners there
    // State will be managed via explicit save/restore calls instead
  }

  private handleSystemWake() {
    console.log("Bitcoin injection: System wake detected, checking for state restoration");
    this.restoreAccountState();
  }

  private handleSystemSleep() {
    console.log("Bitcoin injection: System sleep detected, saving current state");
    this.saveCurrentState();
  }

  private handleVisibilityChange() {
    if (typeof document === "undefined") {
      return;
    }
    if (document.visibilityState === "visible") {
      console.log("Bitcoin injection: Page became visible, checking for state restoration");
      this.restoreAccountState();
    } else {
      console.log("Bitcoin injection: Page became hidden, saving current state");
      this.saveCurrentState();
    }
  }

  /**
   * Save the current state of the injected account
   */
  saveAccountState(account: BitcoinAccount): void {
    try {
      if (!account.id.includes(RELAY_ACCOUNT_IDENTIFIER)) {
        return; // Only save state for our injected account
      }

      const state: InjectedAccountState = {
        accountId: account.id,
        balance: account.balance.toString(),
        spendableBalance: account.spendableBalance.toString(),
        operationsCount: account.operationsCount,
        operations: account.operations || [],
        utxos: account.bitcoinResources?.utxos || [],
        blockHeight: account.blockHeight || 0,
        lastSyncDate: account.lastSyncDate?.toISOString() || new Date().toISOString(),
        balanceHistoryCache: account.balanceHistoryCache || {},
        walletStorageData: this.extractWalletStorageData(account),
      };

      if (typeof localStorage !== "undefined") {
        localStorage.setItem(this.storageKey, JSON.stringify(state));
        console.log("Bitcoin injection: Account state saved to localStorage");
        console.log("Saved operations count:", state.operations.length);
        console.log("Saved UTXOs count:", state.utxos.length);
        console.log("Saved balance:", state.balance);
      }
    } catch (error) {
      console.error("Bitcoin injection: Failed to save account state:", error);
    }
  }

  /**
   * Restore the saved state of the injected account
   */
  restoreAccountState(): InjectedAccountState | null {
    try {
      if (typeof localStorage === "undefined") {
        return null;
      }

      const savedState = localStorage.getItem(this.storageKey);
      if (!savedState) {
        console.log("Bitcoin injection: No saved state found");
        return null;
      }

      const state: InjectedAccountState = JSON.parse(savedState);
      console.log("Bitcoin injection: Restored account state from localStorage");
      console.log("Restored operations count:", state.operations.length);
      console.log("Restored UTXOs count:", state.utxos.length);
      console.log("Restored balance:", state.balance);

      return state;
    } catch (error) {
      console.error("Bitcoin injection: Failed to restore account state:", error);
      return null;
    }
  }

  /**
   * Apply restored state to an account
   */
  applyRestoredState(account: BitcoinAccount, restoredState: InjectedAccountState): BitcoinAccount {
    try {
      console.log("Bitcoin injection: Applying restored state to account");
      
      // Restore basic account properties
      const restoredAccount: BitcoinAccount = {
        ...account,
        balance: new BigNumber(restoredState.balance),
        spendableBalance: new BigNumber(restoredState.spendableBalance),
        operationsCount: restoredState.operationsCount,
        operations: restoredState.operations,
        blockHeight: restoredState.blockHeight,
        lastSyncDate: new Date(restoredState.lastSyncDate),
        balanceHistoryCache: restoredState.balanceHistoryCache,
        bitcoinResources: {
          ...account.bitcoinResources,
          utxos: restoredState.utxos,
        },
      };

      // Restore wallet storage data if available
      if (restoredState.walletStorageData && account.bitcoinResources?.walletAccount) {
        this.restoreWalletStorageData(account.bitcoinResources.walletAccount, restoredState.walletStorageData);
      }

      console.log("Bitcoin injection: State restoration completed");
      return restoredAccount;
    } catch (error) {
      console.error("Bitcoin injection: Failed to apply restored state:", error);
      return account;
    }
  }

  /**
   * Extract wallet storage data for persistence
   */
  private extractWalletStorageData(account: BitcoinAccount): any {
    try {
      if (!account.bitcoinResources?.walletAccount) {
        return null;
      }

      const storage = account.bitcoinResources.walletAccount.xpub.storage;
      return {
        txs: storage.export ? storage.export() : null,
        addressCache: (storage as any).addressCache || {},
      };
    } catch (error) {
      console.error("Bitcoin injection: Failed to extract wallet storage data:", error);
      return null;
    }
  }

  /**
   * Restore wallet storage data from persistence
   */
  private restoreWalletStorageData(walletAccount: any, storageData: any): void {
    try {
      if (!storageData || !walletAccount) {
        return;
      }

      const storage = walletAccount.xpub.storage;
      
      // Restore transaction data
      if (storageData.txs && storage.loadSync) {
        storage.loadSync({
          txs: storageData.txs.txs || [],
          addressCache: storageData.addressCache || {},
        });
        console.log("Bitcoin injection: Wallet storage data restored");
      }
    } catch (error) {
      console.error("Bitcoin injection: Failed to restore wallet storage data:", error);
    }
  }

  /**
   * Clear saved state (useful for testing or reset)
   */
  clearSavedState(): void {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(this.storageKey);
        console.log("Bitcoin injection: Saved state cleared");
      }
    } catch (error) {
      console.error("Bitcoin injection: Failed to clear saved state:", error);
    }
  }

  /**
   * Check if we have saved state available
   */
  hasSavedState(): boolean {
    try {
      if (typeof localStorage === "undefined") {
        return false;
      }
      return localStorage.getItem(this.storageKey) !== null;
    } catch (error) {
      return false;
    }
  }

  private saveCurrentState(): void {
    // This will be called by event listeners to save current state
    // The actual saving is done by saveAccountState when called with an account
    console.log("Bitcoin injection: Current state save requested");
  }
}

export const persistentStateManager = PersistentStateManager.getInstance();
export type { InjectedAccountState };
