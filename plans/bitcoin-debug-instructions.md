# Bitcoin Injection Debug — Log Capture Instructions

## What we know
The injection IS firing (confirmed in logs):
- `hw-getAddress-injected.ts` successfully injects the target address for paths `44'/0'/0'` and `44'/0'/0'/0/0`
- `synchronisation-injected.ts` correctly detects derivationMode "" and index 0, takes the injected branch

## What we need to find
The exact failure point in `createCustomAccountShape` — is it:
- `getTargetAddress()` returning wrong value?
- `fetchCurrentBlockHeight()` failing (network rejection)?
- `encodeAccountId()` throwing?
- The returned shape being rejected by the scan framework (missing/wrong field)?

## Command to run on your Mac terminal
```bash
adb -s R3CW20A32RH logcat -v time ReactNativeJS:V *:S | grep -E "customAccountShape|TAKING injected|Bitcoin address injection failed|getAddress"
```

## Steps
1. Run the command above
2. Open Ledger Wallet on your phone
3. Connect your Ledger device
4. Go to Add Account → Bitcoin → scan blockchain
5. The terminal will show log output. Share it here.