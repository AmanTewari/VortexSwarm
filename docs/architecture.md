# Architecture

## High-Level Overview

The app is a single Node.js process with two major surfaces:

1. Bot runtime surface
- Loads account and proxy data.
- Spawns and manages Mineflayer bot instances.
- Applies plugins (pathfinder and pvp).
- Handles reconnect and fault isolation.

2. Control panel surface
- Serves a static webpage.
- Exposes HTTP endpoints for command execution.
- Streams state/log events over Socket.IO.

## Main Modules Inside index.js

1. CONFIG
- Central environment-driven runtime configuration.
- Includes Minecraft server settings, command policy, reconnect policy, and web settings.

2. Data loaders
- loadAccounts(): parses and validates account entries.
- loadProxies(): normalizes proxy input lines into usable URLs.

3. BotManager class
- Owns bot lifecycle and state snapshots.
- Registers Mineflayer event listeners.
- Routes command execution across the swarm.
- Publishes state updates to subscribers.

4. Web server factory
- createWebServer(manager, config) creates Express + Socket.IO server.
- Exposes API routes and emits state/log updates to connected browsers.

## State Ownership

- Source of truth: BotManager.bots (Map keyed by bot username).
- Derived state: getStateSnapshot() for UI and API responses.
- Event fan-out:
  - manager.emitState() for state events.
  - logSubscribers for live log relay.

## Design Tradeoffs

- Single-file runtime is simple to start and reason about.
- No external DB or queue; process memory is authoritative.
- Restarting process clears in-memory swarm state.
