# VortexSwarm

A simple control system for running multiple Minecraft bots at once.

## Disclaimer

Use this project only where you have explicit permission and in compliance with applicable laws, the Minecraft EULA, and server terms. You assume all risk and responsibility for use. See [disclaimer.md](disclaimer.md) for full terms.

## What This Project Does

- Runs multiple bots together as a group.
- Lets you control the group from a simple web page.
- Supports basic group actions like coming to you, chatting, attacking, and status reports.

## Developer Documentation

For architecture, flow, API, and debugging guides, see [docs/README.md](docs/README.md).

## Who This Is For

This README is written for anyone who wants to run the tool, even with limited coding experience.

## Before You Start

You need:

- A Windows, macOS, or Linux machine.
- Node.js installed.
- A Minecraft server you are allowed to test on.
- Account and proxy info prepared in the included files.

## Setup

1. Open this project folder.
2. Install dependencies:

```bash
npm install mineflayer mineflayer-pathfinder mineflayer-pvp proxy-agent minecraft-data
```

Or just run:

```bash
npm install
```

## Files

- `accounts.json`: Your bot accounts.
- `proxies.txt`: Your proxies (one per line).
- `disclaimer.md`: Full legal and responsibility notice.

## accounts.json Structure

```json
[
	{
		"username": "AltOne",
		"uuid": "00000000-0000-0000-0000-000000000001",
		"accessToken": "MICROSOFT_ACCESS_TOKEN_HERE",
		"clientToken": "CLIENT_TOKEN_HERE",
		"auth": "microsoft"
	},
	{
		"username": "AltTwo",
		"auth": "microsoft",
		"password": "OPTIONAL_FALLBACK_PASSWORD"
	}
]
```

## proxies.txt Structure

```txt
socks5://127.0.0.1:1080
socks5://127.0.0.1:1081
127.0.0.1:1082:user:pass
127.0.0.1:1083
```

## Configuration

You can customize behavior using environment variables:

- `MC_HOST` (default: `localhost`)
- `MC_PORT` (default: `25565`)
- `MC_VERSION` (default: auto)
- `CMD_PREFIX` (default: `!`)
- `AUTH_MODE` (default: `microsoft`, options: `microsoft` or `offline`)
- `OFFLINE_NAME_STYLE` (default: `mixed`, options: `gaming`, `human`, `mixed`)
- `JOIN_DELAY_MS` (default: `2000`)
- `MASTER_USERNAME` (default: `MasterPlayer`)
- `MASTER_UUID` (default: empty)
- `WEB_HOST` (default: `0.0.0.0`)
- `WEB_PORT` (default: `3000`)
- `WEB_TOKEN` (default: empty, optional API auth token)
- `SAVED_NAMES_PATH` (default: `data/saved-names.json`)
- `RECONNECT_ENABLED` (default: `true`)
- `RECONNECT_MAX_RETRIES` (default: `5`)
- `RECONNECT_BASE_DELAY_MS` (default: `5000`)

## Run

Start the swarm:

```bash
npm start
```

Then open the web control panel:

- Open `http://localhost:3000` (or your `WEB_PORT`)
- Configure server host/port/version/join delay in the dashboard and apply changes
- Set the number of active bots in the dashboard with `Bot Count`
- Use the command box to send: `come`, `spam hello`, `attack zombie`, `status`
- View bot activity and live logs
- Switch between grayscale light and dark themes
- Toggle bot authentication mode between Microsoft and Offline from the control panel
- In Offline mode, choose random username style:
	- `gaming` examples: `DoggyGamer2331`, `PixelHunter827`
	- `human` examples: `TomFelton`, `Tom_Felton`
	- `mixed` randomizes between both styles
- Use `Save Names` to store the current generated offline names in a list in the panel, and delete saved entries when needed
- Saved names are persistent and loaded from disk at startup (default file: `data/saved-names.json`)
- Control bots one-by-one from each bot card (`Start`, `Stop`, `Come`, `Status`, and per-bot `Say`)

## Commands (From Master)

All commands must be prefixed (default `!`):

- `!come`: Bots pathfind to master position.
- `!spam <message>`: All bots repeat the message.
- `!attack <target>`: All bots chase and attack matching entity.
- `!status`: Each bot reports health and coordinates.

## Troubleshooting (Simple)

- If the page does not open, check that the app is running and your `WEB_PORT` is correct.
- If bots do not join, recheck `accounts.json` values.
- If some bots fail but others work, inspect `proxies.txt` for invalid entries.

## Final Note

Use this responsibly and only in places where automation is allowed.
