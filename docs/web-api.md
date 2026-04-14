# Web API and Realtime Contract

## Web Surface

- Static UI root: /
- Static assets: /public/*
- Socket.IO endpoint: /socket.io

## Authentication Model

- Optional token gate for /api routes via WEB_TOKEN.
- Client sends token in x-web-token header when enabled.

## HTTP Endpoints

1. GET /api/state
- Purpose: return current swarm snapshot.
- Response shape:
  - ok: boolean
  - state:
    - server: string
    - serverConfig: { host, port, version, joinDelayMs }
    - activeBotCount: number
    - botCountAdvisory: { warning, warningThreshold, message }
    - authMode: microsoft|offline
    - offlineNameStyle: gaming|human|mixed
    - currentOfflineNames: array
    - savedNameLists: array
    - started: boolean
    - configuredBots: number
    - connectedBots: number
    - joinDelayMs: number
    - bots[]: { id, username, connected, health, position, retries, usingProxy }

2. POST /api/command
- Purpose: dispatch a command to the swarm.
- Body:
  - input: string (examples: come, spam hello, attack zombie, status)
- Success: command-specific payload with ok=true.
- Failure: ok=false with error message.

3. POST /api/stop
- Purpose: request full swarm stop.
- Response: ok=true and status message.

4. POST /api/start
- Purpose: request full swarm start.
- Response: ok=true and status message.

5. POST /api/server-config
- Purpose: update host/port/version/join delay.
- Body: { host, port, version, joinDelayMs }
- Response:
  - ok: true
  - restartOccurred: boolean (true when swarm was running and had to reconnect)
  - server: normalized host:port string

6. POST /api/bot-count
- Purpose: update target bot count.
- Body: { botCount }
- Validation: integer >= 1 (no hard max)
- Response:
  - ok: true
  - botCount: number
  - restartOccurred: boolean
  - advisory: { warning, warningThreshold, message }

7. POST /api/mode
- Purpose: switch auth mode.
- Body: { mode } where mode is microsoft or offline.

8. POST /api/offline-name-style
- Purpose: switch offline username generation style.
- Body: { style } where style is gaming, human, or mixed.

9. POST /api/offline-names/save
- Purpose: persist currently generated offline names.

10. POST /api/offline-names/delete
- Purpose: delete a saved offline name set.
- Body: { id }

11. POST /api/bot-command
- Purpose: target a single bot by botId (or username fallback).
- Body:
  - botId: string (preferred)
  - username: string (fallback)
  - command: start|stop|say|come|status|attack|spam
  - args: array (optional)
  - message: string (required for say)

12. GET /health
- Purpose: lightweight backend health probe.
- Response: ok and uptimeSec.

## Socket.IO Events

1. state
- Emitted on connection and on periodic/triggered updates.
- Payload is equivalent to state snapshot.

2. log
- Emitted on log() calls.
- Payload:
  - ts
  - scope
  - message
  - details (nullable)

## Frontend Data Flow

1. public/app.js fetches /api/state on load.
2. Socket updates merge in realtime state/log changes.
3. Settings form sends /api/server-config and /api/bot-count, then shows one coherent status message.
4. Command form and quick-action buttons send /api/command.
5. Per-bot actions use /api/bot-command with botId targeting.
6. UI re-renders bot cards and health badges from latest state payload.
