const fs = require('fs/promises')
const path = require('path')
const http = require('http')
const mineflayer = require('mineflayer')
const express = require('express')
const { Server } = require('socket.io')
const { pathfinder, goals, Movements } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const mcDataLoader = require('minecraft-data')
const { ProxyAgent } = require('proxy-agent')

const ROOT = __dirname

const CONFIG = {
  host: process.env.MC_HOST || 'localhost',
  port: Number(process.env.MC_PORT || 25565),
  version: process.env.MC_VERSION || false,
  commandPrefix: process.env.CMD_PREFIX || '!',
  joinDelayMs: Number(process.env.JOIN_DELAY_MS || 2000),
  masterUsername: process.env.MASTER_USERNAME || 'MasterPlayer',
  masterUuid: process.env.MASTER_UUID || '',
  webHost: process.env.WEB_HOST || '0.0.0.0',
  webPort: Number(process.env.WEB_PORT || 3000),
  webToken: process.env.WEB_TOKEN || '',
  reconnect: {
    enabled: (process.env.RECONNECT_ENABLED || 'true') === 'true',
    maxRetries: Number(process.env.RECONNECT_MAX_RETRIES || 5),
    baseDelayMs: Number(process.env.RECONNECT_BASE_DELAY_MS || 5000)
  }
}

const logSubscribers = new Set()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function log(scope, message, details) {
  const ts = new Date().toISOString()
  const payload = {
    ts,
    scope,
    message,
    details: details || null
  }

  for (const subscriber of logSubscribers) {
    try {
      subscriber(payload)
    } catch (_error) {
      // no-op
    }
  }

  if (details) {
    console.log(`[${ts}] [${scope}] ${message}`, details)
    return
  }
  console.log(`[${ts}] [${scope}] ${message}`)
}

async function loadAccounts(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  const parsed = JSON.parse(raw)

  if (!Array.isArray(parsed)) {
    throw new Error('accounts.json must contain an array of account objects.')
  }

  const valid = []

  for (const [index, account] of parsed.entries()) {
    if (!account || typeof account !== 'object') {
      log('loader', `Skipping account #${index + 1}: entry is not an object.`)
      continue
    }

    if (!account.username || typeof account.username !== 'string') {
      log('loader', `Skipping account #${index + 1}: missing username.`)
      continue
    }

    valid.push({
      username: account.username,
      uuid: account.uuid || '',
      auth: account.auth || 'microsoft',
      password: account.password || '',
      accessToken: account.accessToken || '',
      clientToken: account.clientToken || ''
    })
  }

  return valid
}

function normalizeProxyLine(proxyLine) {
  const line = proxyLine.trim()
  if (!line || line.startsWith('#')) {
    return null
  }

  if (line.includes('://')) {
    return line
  }

  const chunks = line.split(':')

  if (chunks.length === 2) {
    const [host, port] = chunks
    return `socks5://${host}:${port}`
  }

  if (chunks.length === 4) {
    const [host, port, username, password] = chunks
    return `socks5://${username}:${password}@${host}:${port}`
  }

  log('proxy', `Ignoring invalid proxy format: ${line}`)
  return null
}

async function loadProxies(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  const lines = raw.split(/\r?\n/)
  return lines.map(normalizeProxyLine).filter(Boolean)
}

class BotManager {
  constructor(config, accounts, proxies) {
    this.config = config
    this.accounts = accounts
    this.proxies = proxies
    this.bots = new Map()
    this.recentCommands = new Map()
    this.stateSubscribers = new Set()
    this.started = false
  }

  async start() {
    if (this.started) {
      return
    }

    this.started = true
    log('manager', `Starting ${this.accounts.length} bots with ${this.config.joinDelayMs}ms join delay.`)

    for (let i = 0; i < this.accounts.length; i += 1) {
      const account = this.accounts[i]
      this.spawnBot(i, account, false)
      this.emitState()
      if (i < this.accounts.length - 1) {
        await sleep(this.config.joinDelayMs)
      }
    }
  }

  subscribeState(listener) {
    this.stateSubscribers.add(listener)
    return () => this.stateSubscribers.delete(listener)
  }

  emitState() {
    const state = this.getStateSnapshot()
    for (const listener of this.stateSubscribers) {
      try {
        listener(state)
      } catch (_error) {
        // no-op
      }
    }
  }

  getStateSnapshot() {
    return {
      server: `${this.config.host}:${this.config.port}`,
      started: this.started,
      configuredBots: this.accounts.length,
      connectedBots: this.getConnectedBots().length,
      joinDelayMs: this.config.joinDelayMs,
      bots: Array.from(this.bots.values()).map((entry) => {
        const bot = entry.bot
        const pos = bot.entity ? bot.entity.position : null
        return {
          username: bot.username,
          connected: Boolean(bot.player),
          health: Number.isFinite(bot.health) ? Number(bot.health.toFixed(1)) : null,
          position: pos
            ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }
            : null,
          retries: entry.retries || 0,
          usingProxy: Boolean(entry.proxyUrl)
        }
      })
    }
  }

  resolveProxyFor(index) {
    if (!this.proxies.length) {
      return null
    }

    if (index < this.proxies.length) {
      return this.proxies[index]
    }

    const reused = this.proxies[index % this.proxies.length]
    log('proxy', `Not enough proxies for all bots. Reusing proxy for bot index ${index + 1}.`)
    return reused
  }

  buildBotOptions(account, proxyUrl) {
    const options = {
      host: this.config.host,
      port: this.config.port,
      version: this.config.version,
      username: account.username,
      auth: account.auth || 'microsoft',
      hideErrors: true
    }

    if (proxyUrl) {
      try {
        options.agent = new ProxyAgent(proxyUrl)
      } catch (error) {
        log(account.username, `Failed to construct proxy agent. Falling back to direct connection: ${error.message}`)
      }
    }

    if (account.accessToken && account.clientToken) {
      options.auth = 'microsoft'
      options.session = {
        accessToken: account.accessToken,
        clientToken: account.clientToken,
        selectedProfile: {
          id: account.uuid || account.username,
          name: account.username
        }
      }
      log(account.username, 'Using token-based session auth.')
    } else {
      if (account.password) {
        options.password = account.password
      }
      log(account.username, 'Using fallback auth flow (no token pair found).')
    }

    return options
  }

  spawnBot(index, account, isReconnect) {
    const proxyUrl = this.resolveProxyFor(index)
    const botId = account.username

    try {
      const previous = this.bots.get(botId)
      const retryCount = isReconnect && previous ? previous.retries || 0 : 0

      const bot = mineflayer.createBot(this.buildBotOptions(account, proxyUrl))
      bot.loadPlugin(pathfinder)
      bot.loadPlugin(pvp)

      this.bots.set(botId, {
        bot,
        account,
        index,
        proxyUrl,
        retries: retryCount
      })

      this.registerBotListeners(botId)
      log(botId, `${isReconnect ? 'Reconnecting' : 'Spawning'} bot${proxyUrl ? ` via ${proxyUrl}` : ' without proxy'}.`)
      this.emitState()
    } catch (error) {
      log(botId, `createBot failed: ${error.message}`)
    }
  }

  registerBotListeners(botId) {
    const state = this.bots.get(botId)
    if (!state) {
      return
    }

    const { bot, account } = state

    bot.once('spawn', () => {
      try {
        const mcData = mcDataLoader(bot.version)
        bot.pathfinder.setMovements(new Movements(bot, mcData))
        log(botId, 'Spawned and ready.')
        this.emitState()
      } catch (error) {
        log(botId, `Failed to initialize pathfinder movements: ${error.message}`)
      }
    })

    bot.on('chat', (username, message) => {
      this.handleIncomingCommand({
        fromUsername: username,
        fromUuid: '',
        message,
        heardBy: botId
      })
    })

    bot.on('messagestr', (message, _position, _jsonMsg, sender) => {
      this.handleIncomingCommand({
        fromUsername: '',
        fromUuid: sender || '',
        message,
        heardBy: botId
      })
    })

    bot.on('kicked', (reason, loggedIn) => {
      log(botId, `Kicked (loggedIn=${loggedIn}): ${JSON.stringify(reason)}`)
      this.emitState()
    })

    bot.on('error', (error) => {
      log(botId, `Error: ${error.message}`)
      this.emitState()
    })

    bot.on('end', (reason) => {
      log(botId, `Disconnected: ${reason || 'unknown reason'}`)
      this.emitState()
      this.scheduleReconnect(account)
    })
  }

  isAuthorizedMaster(fromUsername, fromUuid) {
    if (this.config.masterUuid && fromUuid) {
      return fromUuid === this.config.masterUuid
    }

    return Boolean(this.config.masterUsername && fromUsername === this.config.masterUsername)
  }

  shouldDeduplicate(commandSignature) {
    const now = Date.now()

    for (const [sig, ts] of this.recentCommands.entries()) {
      if (now - ts > 2000) {
        this.recentCommands.delete(sig)
      }
    }

    if (this.recentCommands.has(commandSignature)) {
      return true
    }

    this.recentCommands.set(commandSignature, now)
    return false
  }

  handleIncomingCommand({ fromUsername, fromUuid, message, heardBy }) {
    if (typeof message !== 'string') {
      return
    }

    if (!message.startsWith(this.config.commandPrefix)) {
      return
    }

    if (!this.isAuthorizedMaster(fromUsername, fromUuid)) {
      return
    }

    const signature = `${fromUuid || fromUsername}:${message}`
    if (this.shouldDeduplicate(signature)) {
      return
    }

    const body = message.slice(this.config.commandPrefix.length).trim()
    if (!body) {
      return
    }

    const [command, ...args] = body.split(' ')
    log('command', `Accepted from master via ${heardBy}: ${command} ${args.join(' ')}`.trim())

    this.executeCommand(command.toLowerCase(), args)
  }

  getConnectedBots() {
    return Array.from(this.bots.values()).map((entry) => entry.bot).filter((bot) => bot && bot.player)
  }

  executeCommand(command, args) {
    switch (command) {
      case 'come':
        this.commandCome()
        return { ok: true, command: 'come' }
      case 'spam':
        return this.commandSpam(args)
      case 'attack':
        return this.commandAttack(args)
      case 'status':
        return this.commandStatus()
      default:
        log('command', `Unknown command: ${command}`)
        return { ok: false, error: `Unknown command: ${command}` }
    }
  }

  resolveMasterEntity(bot) {
    if (this.config.masterUuid) {
      const byUuid = Object.values(bot.players).find((player) => player && player.uuid === this.config.masterUuid)
      if (byUuid && byUuid.entity) {
        return byUuid.entity
      }
    }

    if (this.config.masterUsername && bot.players[this.config.masterUsername]) {
      return bot.players[this.config.masterUsername].entity || null
    }

    return null
  }

  commandCome() {
    const bots = this.getConnectedBots()

    for (const bot of bots) {
      try {
        const masterEntity = this.resolveMasterEntity(bot)
        if (!masterEntity) {
          log(bot.username, 'Cannot execute come: master is not visible.')
          continue
        }

        const { x, y, z } = masterEntity.position
        bot.pathfinder.setGoal(new goals.GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), 2))
      } catch (error) {
        log(bot.username, `come failed: ${error.message}`)
      }
    }
  }

  commandSpam(args) {
    const text = args.join(' ').trim()
    if (!text) {
      log('command', 'spam ignored: empty message.')
      return { ok: false, error: 'spam requires a message.' }
    }

    const bots = this.getConnectedBots()

    for (const bot of bots) {
      try {
        bot.chat(text)
      } catch (error) {
        log(bot.username, `spam failed: ${error.message}`)
      }
    }

    return { ok: true, command: 'spam', sent: bots.length }
  }

  resolveTarget(bot, targetName) {
    if (!targetName) {
      return null
    }

    const exactPlayer = bot.players[targetName]
    if (exactPlayer && exactPlayer.entity) {
      return exactPlayer.entity
    }

    const lowered = targetName.toLowerCase()
    return bot.nearestEntity((entity) => {
      const username = entity.username ? entity.username.toLowerCase() : ''
      const mobName = entity.name ? entity.name.toLowerCase() : ''
      return username.includes(lowered) || mobName.includes(lowered)
    })
  }

  commandAttack(args) {
    const targetName = (args[0] || '').trim()
    if (!targetName) {
      log('command', 'attack ignored: missing target name.')
      return { ok: false, error: 'attack requires a target.' }
    }

    const bots = this.getConnectedBots()

    for (const bot of bots) {
      try {
        const entity = this.resolveTarget(bot, targetName)
        if (!entity) {
          log(bot.username, `No target found for attack: ${targetName}`)
          continue
        }

        bot.pvp.attack(entity)
      } catch (error) {
        log(bot.username, `attack failed: ${error.message}`)
      }
    }

    return { ok: true, command: 'attack', target: targetName, attemptedBy: bots.length }
  }

  commandStatus() {
    const bots = this.getConnectedBots()
    const statuses = []

    for (const bot of bots) {
      try {
        const p = bot.entity ? bot.entity.position : { x: 0, y: 0, z: 0 }
        const status = `[status] hp=${bot.health.toFixed(1)} pos=${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`
        bot.chat(status)
        statuses.push({
          username: bot.username,
          health: Number(bot.health.toFixed(1)),
          position: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }
        })
      } catch (error) {
        log(bot.username, `status failed: ${error.message}`)
      }
    }

    return { ok: true, command: 'status', statuses }
  }

  scheduleReconnect(account) {
    const state = this.bots.get(account.username)
    if (!state) {
      return
    }

    if (!this.config.reconnect.enabled) {
      this.bots.delete(account.username)
      this.emitState()
      return
    }

    const retries = (state.retries || 0) + 1
    if (retries > this.config.reconnect.maxRetries) {
      log(account.username, `Reconnect limit reached (${this.config.reconnect.maxRetries}).`)
      this.bots.delete(account.username)
      this.emitState()
      return
    }

    state.retries = retries

    const jitter = Math.floor(Math.random() * 1000)
    const delay = this.config.reconnect.baseDelayMs + jitter

    log(account.username, `Scheduling reconnect #${retries} in ${delay}ms.`)

    setTimeout(() => {
      this.spawnBot(state.index, account, true)
    }, delay)
  }

  async stop() {
    const entries = Array.from(this.bots.entries())

    for (const [botId, state] of entries) {
      try {
        state.bot.pvp.stop()
      } catch (_error) {
        // no-op
      }

      try {
        state.bot.pathfinder.setGoal(null)
      } catch (_error) {
        // no-op
      }

      try {
        state.bot.quit('Swarm shutdown')
      } catch (_error) {
        // no-op
      }

      log(botId, 'Bot shutdown requested.')
    }

    this.bots.clear()
    this.started = false
    this.emitState()
  }
}

function splitCommandInput(input) {
  const text = String(input || '').trim()
  if (!text) {
    return { command: '', args: [] }
  }
  const [command, ...args] = text.split(' ')
  return { command: command.toLowerCase(), args }
}

function createWebServer(manager, config) {
  const app = express()
  const server = http.createServer(app)
  const io = new Server(server)

  app.use(express.json({ limit: '32kb' }))
  app.use(express.static(path.join(ROOT, 'public')))

  if (config.webToken) {
    app.use('/api', (req, res, next) => {
      const token = req.header('x-web-token') || ''
      if (token !== config.webToken) {
        res.status(401).json({ ok: false, error: 'Unauthorized' })
        return
      }
      next()
    })
  }

  app.get('/api/state', (_req, res) => {
    res.json({ ok: true, state: manager.getStateSnapshot() })
  })

  app.post('/api/command', (req, res) => {
    const { input } = req.body || {}
    const { command, args } = splitCommandInput(input)

    if (!command) {
      res.status(400).json({ ok: false, error: 'Command input is empty.' })
      return
    }

    const result = manager.executeCommand(command, args)
    if (!result || result.ok === false) {
      res.status(400).json(result || { ok: false, error: 'Command failed.' })
      return
    }

    manager.emitState()
    res.json(result)
  })

  app.post('/api/stop', async (_req, res) => {
    await manager.stop()
    res.json({ ok: true, message: 'Swarm stop requested.' })
  })

  io.on('connection', (socket) => {
    socket.emit('state', manager.getStateSnapshot())
  })

  const unsubscribeState = manager.subscribeState((state) => {
    io.emit('state', state)
  })

  const logSubscriber = (entry) => {
    io.emit('log', entry)
  }
  logSubscribers.add(logSubscriber)

  const poller = setInterval(() => {
    manager.emitState()
  }, 2500)

  server.listen(config.webPort, config.webHost, () => {
    log('web', `Control panel running at http://localhost:${config.webPort}`)
  })

  return {
    async close() {
      clearInterval(poller)
      unsubscribeState()
      logSubscribers.delete(logSubscriber)
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  }
}

async function bootstrap() {
  try {
    const accountsPath = path.join(ROOT, 'accounts.json')
    const proxiesPath = path.join(ROOT, 'proxies.txt')

    const accounts = await loadAccounts(accountsPath)
    if (!accounts.length) {
      throw new Error('No valid accounts found in accounts.json.')
    }

    let proxies = []
    try {
      proxies = await loadProxies(proxiesPath)
    } catch (error) {
      log('bootstrap', `No proxies loaded (${error.message}). Bots will connect directly.`)
    }

    const manager = new BotManager(CONFIG, accounts, proxies)
    const web = createWebServer(manager, CONFIG)
    await manager.start()

    process.on('SIGINT', async () => {
      log('process', 'SIGINT received. Shutting down swarm...')
      await manager.stop()
      await web.close()
      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      log('process', 'SIGTERM received. Shutting down swarm...')
      await manager.stop()
      await web.close()
      process.exit(0)
    })
  } catch (error) {
    log('bootstrap', `Fatal startup failure: ${error.message}`)
    process.exit(1)
  }
}

process.on('unhandledRejection', (error) => {
  log('process', `Unhandled rejection: ${error.message}`)
})

process.on('uncaughtException', (error) => {
  log('process', `Uncaught exception: ${error.message}`)
})

bootstrap()
