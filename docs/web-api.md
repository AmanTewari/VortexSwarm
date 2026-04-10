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
  - state: server, configuredBots, connectedBots, joinDelayMs, bots[]

2. POST /api/command
- Purpose: dispatch a command to the swarm.
- Body:
  - input: string (examples: come, spam hello, attack zombie, status)
- Success: command-specific payload with ok=true.
- Failure: ok=false with error message.

3. POST /api/stop
- Purpose: request full swarm stop.
- Response: ok=true and status message.

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
3. Command form and quick-action buttons send /api/command.
4. UI re-renders bot cards from latest state payload.
