# Runtime Flow

## 1. Bootstrap Sequence

1. Process starts index.js.
2. bootstrap() loads accounts.json and proxies.txt.
3. BotManager is created with config, accounts, and proxies.
4. Web server starts (Express + Socket.IO).
5. BotManager.start() spawns bots with staggered delays.

## 2. Bot Spawn Lifecycle

For each account:

1. Resolve proxy for index.
2. Build mineflayer options (token-first auth, fallback mode).
3. createBot() is called.
4. Plugins are loaded.
5. Event listeners are registered.

## 3. Bot Event Lifecycle

Important listeners:

- spawn
  - Initializes movement config for pathfinder.
  - Emits fresh state.

- chat/messagestr
  - Parses master commands.
  - Deduplicates command echoes.

- kicked/error/end
  - Logs failure context.
  - Emits fresh state.
  - Triggers reconnect scheduling on end.

## 4. Command Dispatch Path

1. Input arrives from:
- In-game chat command from master.
- Web API POST /api/command.

2. Input parsing:
- Prefix is stripped for in-game command path.
- Command and args are tokenized.

3. Execution:
- executeCommand() routes to commandCome, commandSpam, commandAttack, or commandStatus.

## 5. Reconnect Strategy

1. On disconnect, scheduleReconnect() increments retry counter.
2. Delay = baseDelay + jitter.
3. Reconnect stops when max retries is exceeded.

## 6. Shutdown Path

1. SIGINT/SIGTERM triggers manager.stop().
2. Each bot receives stop/quit calls.
3. Web server closes.
4. Process exits.
