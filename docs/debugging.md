# Debugging Guide

## Fast Triage Checklist

1. Confirm process starts without fatal startup errors.
2. Confirm accounts.json is valid JSON array with usernames.
3. Confirm proxies.txt formatting (or remove proxies to test direct connect).
4. Confirm web panel is reachable on configured WEB_PORT.
5. Confirm at least one bot reaches spawn event.

## Failure Domains

1. Bootstrap failures
- Symptom: process exits immediately.
- Typical causes:
  - Missing or invalid accounts.json.
  - JSON parse error.
- Action:
  - Validate accounts file and rerun.

2. Authentication failures
- Symptom: bot disconnects quickly with auth-related errors.
- Typical causes:
  - Expired accessToken.
  - Invalid clientToken/profile mapping.
- Action:
  - Refresh token material or test fallback account credentials.

3. Proxy failures
- Symptom: selected bots fail to connect while others work.
- Typical causes:
  - Dead proxy endpoint.
  - Bad formatting in proxies.txt.
- Action:
  - Remove proxy lines gradually to isolate failing entries.

4. Command execution failures
- Symptom: command accepted but no visible action.
- Typical causes:
  - Master entity not visible for come.
  - No matching target for attack.
  - Bots not fully connected.
- Action:
  - Use status to verify live bot health and position first.

5. Web panel/API failures
- Symptom: UI loads but commands fail.
- Typical causes:
  - WEB_TOKEN mismatch.
  - Wrong API request payload.
- Action:
  - Check browser network responses and API error body.

## Useful Runtime Signals

- [manager] Starting N bots... indicates spawn scheduling started.
- [botName] Spawned and ready. indicates bot became operational.
- [command] Accepted from master... confirms command authorization path.
- [botName] Disconnected... indicates reconnect path will execute.

## Practical Debug Workflow

1. Start with one account and no proxy.
2. Verify spawn and command path.
3. Add proxies one by one.
4. Increase account count after baseline stability.
5. Use the live log feed to correlate disconnect and reconnect timing.

## Suggested Future Improvements for Debuggability

1. Add structured log levels (debug/info/warn/error).
2. Add health endpoint with richer diagnostics.
3. Add command audit trail in memory with timestamps.
4. Add optional persistent log file output.
