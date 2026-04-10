# VortexSwarm

Headless Minecraft bot swarm MVP built with Mineflayer.

## Install

```bash
npm install mineflayer mineflayer-pathfinder mineflayer-pvp proxy-agent minecraft-data
```

Or just run:

```bash
npm install
```

## Files

- `index.js`: Swarm manager and bot lifecycle.
- `accounts.json`: Account list (token-first auth, fallback supported).
- `proxies.txt`: Proxy list (one per line).

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

Use environment variables:

- `MC_HOST` (default: `localhost`)
- `MC_PORT` (default: `25565`)
- `MC_VERSION` (default: auto)
- `CMD_PREFIX` (default: `!`)
- `JOIN_DELAY_MS` (default: `2000`)
- `MASTER_USERNAME` (default: `MasterPlayer`)
- `MASTER_UUID` (default: empty)
- `RECONNECT_ENABLED` (default: `true`)
- `RECONNECT_MAX_RETRIES` (default: `5`)
- `RECONNECT_BASE_DELAY_MS` (default: `5000`)

## Run

```bash
npm start
```

## Commands (From Master)

All commands must be prefixed (default `!`):

- `!come`: Bots pathfind to master position.
- `!spam <message>`: All bots repeat the message.
- `!attack <target>`: All bots chase and attack matching entity.
- `!status`: Each bot reports health and coordinates.

## Notes

- Bots spawn with staggered joins (`JOIN_DELAY_MS`) to reduce anti-bot triggers.
- Each bot is assigned one proxy by index; proxies are reused if there are fewer proxies than accounts.
- Master auth uses UUID when available, then falls back to username.
- Errors, kicks, and disconnects are isolated per bot so one bot failing does not crash the process.
