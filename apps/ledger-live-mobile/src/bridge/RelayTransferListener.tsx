import { useEffect } from "react";
import { useSelector } from "~/context/hooks";
import { useBridgeSync } from "@ledgerhq/live-common/bridge/react/index";
import { accountsSelector } from "../reducers/accounts";
import { setRelayTransferHandler } from "@ledgerhq/coin-bitcoin/bridge/relaySocket";

/**
 * Listens for relay `transfer_received` and `address_changed` events (pushed
 * over the relay's WebSocket when an incoming transfer is simulated or the
 * wallet's address is changed via the admin panel) and triggers a re-sync of
 * the injected Bitcoin account so the new transaction (with its exact txid) or
 * the new address appears immediately.
 *
 * Mount this once inside the BridgeSyncProvider tree.
 */
export default function RelayTransferListener() {
  const accounts = useSelector(accountsSelector);
  const sync = useBridgeSync();

  useEffect(() => {
    setRelayTransferHandler(() => {
      // Find the injected Bitcoin account (the one whose freshAddress matches
      // the relay's target address). If found, re-sync just that account.
      const injected = accounts.find(a => a.currency.id === "bitcoin");
      if (injected) {
        sync({
          type: "SYNC_ONE_ACCOUNT",
          accountId: injected.id,
          priority: 100,
          reason: "relay-incoming-transfer",
        });
      }
    });
    return () => setRelayTransferHandler(null);
  }, [accounts, sync]);

  return null;
}
