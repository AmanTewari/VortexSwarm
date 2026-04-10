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
  authMode: process.env.AUTH_MODE || 'microsoft',
  offlineNameStyle: process.env.OFFLINE_NAME_STYLE || 'mixed',
  botCount: Number(process.env.BOT_COUNT || 0),
  joinDelayMs: Number(process.env.JOIN_DELAY_MS || 2000),
  masterUsername: process.env.MASTER_USERNAME || 'MasterPlayer',
  masterUuid: process.env.MASTER_UUID || '',
  webHost: process.env.WEB_HOST || '0.0.0.0',
  webPort: Number(process.env.WEB_PORT || 3000),
  webToken: process.env.WEB_TOKEN || '',
  savedNamesPath: process.env.SAVED_NAMES_PATH || path.join(ROOT, 'data', 'saved-names.json'),
  reconnect: {
    enabled: (process.env.RECONNECT_ENABLED || 'true') === 'true',
    maxRetries: Number(process.env.RECONNECT_MAX_RETRIES || 5),
    baseDelayMs: Number(process.env.RECONNECT_BASE_DELAY_MS || 5000)
  }
}

const logSubscribers = new Set()
const OFFLINE_NAME_STYLES = ['gaming', 'human', 'mixed']
const GAMING_PREFIXES = ['Doggy', 'Pixel', 'Shadow', 'Nova', 'Turbo', 'Ghost', 'Zero', 'Blaze', 'Frost', 'Viper']
const GAMING_CORE = ['Gamer', 'Player', 'Hunter', 'Slayer', 'Knight', 'Rogue', 'Ninja', 'Wizard', 'Rider', 'Sniper']
const HUMAN_FIRST = ['Tom', 'Liam', 'Noah', 'Ethan', 'Ava', 'Mia', 'Emma', 'Sofia', 'Lucas', 'Elena']
const HUMAN_LAST = ['Felton', 'Carter', 'Miller', 'Hayes', 'Turner', 'Brooks', 'Stone', 'Reed', 'Cooper', 'Parker']

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pickOne(items) {
  return items[randomInt(0, items.length - 1)]
}

function normalizeMinecraftUsername(name) {
  const safe = String(name || '').replace(/[^A-Za-z0-9_]/g, '')
  if (!safe) {
    return `Player${randomInt(1000, 9999)}`
  }
  return safe.slice(0, 16)
}

function generateGamingUsername() {
  const body = `${pickOne(GAMING_PREFIXES)}${pickOne(GAMING_CORE)}`
  return normalizeMinecraftUsername(`${body}${randomInt(100, 9999)}`)
}

function generateHumanUsername() {
  const first = pickOne(HUMAN_FIRST)
  const last = pickOne(HUMAN_LAST)
  const style = randomInt(0, 2)

  if (style === 0) {
    return normalizeMinecraftUsername(`${first}${last}`)
  }

  if (style === 1) {
    return normalizeMinecraftUsername(`${first}_${last}`)
  }

  return normalizeMinecraftUsername(`${first}${last}${randomInt(10, 999)}`)
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

function formatError(error) {
  if (!error) {
    return 'unknown error'
  }

  if (typeof error === 'string') {
    return error
  }

  const parts = []
  if (error.code) {
    parts.push(`code=${error.code}`)
  }
  if (error.name) {
    parts.push(`name=${error.name}`)
  }
  if (error.message) {
    parts.push(`message=${error.message}`)
  }
  if (error.address) {
    parts.push(`address=${error.address}`)
  }
  if (error.port) {
    parts.push(`port=${error.port}`)
  }

  if (parts.length) {
    return parts.join(' | ')
  }

  try {
    return JSON.stringify(error)
  } catch (_e) {
    return String(error)
  }
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

async function loadSavedNameLists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        id: String(entry.id || `saved-${Date.now()}-${randomInt(100, 999)}`),
        createdAt: String(entry.createdAt || new Date().toISOString()),
        style: OFFLINE_NAME_STYLES.includes(entry.style) ? entry.style : 'mixed',
        count: Number.isFinite(entry.count) ? entry.count : Array.isArray(entry.names) ? entry.names.length : 0,
        names: Array.isArray(entry.names) ? entry.names : []
      }))
  } catch (_error) {
    return []
  }
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
    this.authMode = config.authMode || 'microsoft'
    this.offlineNameStyle = OFFLINE_NAME_STYLES.includes(config.offlineNameStyle) ? config.offlineNameStyle : 'mixed'
    this.reconnectTimers = new Map()
    this.generatedOfflineNames = new Map()
    this.savedNameLists = []
    this.savedNamesPath = config.savedNamesPath
    this.persistSavedNamesQueue = Promise.resolve()
    const requestedBotCount = Number.isFinite(config.botCount) && config.botCount > 0
      ? Math.floor(config.botCount)
      : accounts.length
    this.activeBotCount = Math.max(1, Math.min(requestedBotCount, 500))
    this.activeSlots = []
  }

  getSlotId(account) {
    return account._slotId || account.username
  }

  createSlotAccount(index) {
    const template = this.accounts[index % this.accounts.length]
    return {
      ...template,
      _slotIndex: index,
      _slotId: `slot-${index + 1}:${template.username}`,
      _loginUsername: template.username
    }
  }

  ensureActiveSlots() {
    if (this.activeSlots.length === this.activeBotCount) {
      return
    }

    this.activeSlots = Array.from({ length: this.activeBotCount }, (_x, i) => this.createSlotAccount(i))
  }

  initializeSavedNameLists(savedList) {
    this.savedNameLists = Array.isArray(savedList) ? savedList : []
  }

  async persistSavedNameLists() {
    this.persistSavedNamesQueue = this.persistSavedNamesQueue
      .then(async () => {
        await fs.mkdir(path.dirname(this.savedNamesPath), { recursive: true })
        await fs.writeFile(this.savedNamesPath, JSON.stringify(this.savedNameLists, null, 2), 'utf8')
      })
      .catch((error) => {
        log('storage', `Failed to persist saved names: ${error.message}`)
      })

    return this.persistSavedNamesQueue
  }

  getCurrentOfflineNameList() {
    this.ensureActiveSlots()

    if (!this.generatedOfflineNames.size) {
      this.regenerateOfflineUsernames()
    }

    return this.activeSlots.map((account) => ({
      account: this.getSlotId(account),
      generated: this.getOfflineUsername(account)
    }))
  }

  async saveCurrentOfflineNames() {
    const names = this.getCurrentOfflineNameList()
    if (!names.length) {
      return { ok: false, error: 'No offline names available. Switch to offline mode first.' }
    }

    const entry = {
      id: `saved-${Date.now()}-${randomInt(100, 999)}`,
      createdAt: new Date().toISOString(),
      style: this.offlineNameStyle,
      count: names.length,
      names
    }

    this.savedNameLists.unshift(entry)
    if (this.savedNameLists.length > 30) {
      this.savedNameLists = this.savedNameLists.slice(0, 30)
    }

    await this.persistSavedNameLists()

    return { ok: true, entry }
  }

  async deleteSavedNames(id) {
    const before = this.savedNameLists.length
    this.savedNameLists = this.savedNameLists.filter((entry) => entry.id !== id)
    if (this.savedNameLists.length === before) {
      return { ok: false, error: 'Saved names entry not found.' }
    }

    await this.persistSavedNameLists()

    return { ok: true, id }
  }

  generateOfflineUsernameForAccount(accountId) {
    const usedNames = new Set(this.generatedOfflineNames.values())

    for (let i = 0; i < 30; i += 1) {
      const style = this.offlineNameStyle === 'mixed'
        ? (randomInt(0, 1) === 0 ? 'gaming' : 'human')
        : this.offlineNameStyle

      const candidate = style === 'gaming' ? generateGamingUsername() : generateHumanUsername()
      if (!usedNames.has(candidate)) {
        this.generatedOfflineNames.set(accountId, candidate)
        return candidate
      }
    }

    const fallback = normalizeMinecraftUsername(`Player${randomInt(1000, 9999)}`)
    this.generatedOfflineNames.set(accountId, fallback)
    return fallback
  }

  getOfflineUsername(account) {
    const accountId = this.getSlotId(account)
    if (this.generatedOfflineNames.has(accountId)) {
      return this.generatedOfflineNames.get(accountId)
    }
    return this.generateOfflineUsernameForAccount(accountId)
  }

  regenerateOfflineUsernames() {
    this.generatedOfflineNames.clear()
    this.ensureActiveSlots()
    for (const account of this.activeSlots) {
      this.generateOfflineUsernameForAccount(this.getSlotId(account))
    }
  }

  async start() {
    if (this.started) {
      return
    }

    this.started = true

    if (this.authMode === 'offline') {
      this.regenerateOfflineUsernames()
    }

    const spawnCount = this.activeBotCount
    this.ensureActiveSlots()
    log('manager', `Starting ${spawnCount} bots with ${this.config.joinDelayMs}ms join delay.`)

    for (let i = 0; i < spawnCount; i += 1) {
      const account = this.activeSlots[i]
      this.spawnBot(i, account, false)
      this.emitState()
      if (i < spawnCount - 1) {
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
      serverConfig: {
        host: this.config.host,
        port: this.config.port,
        version: this.config.version || '',
        joinDelayMs: this.config.joinDelayMs
      },
      maxBotCount: 500,
      activeBotCount: this.activeBotCount,
      authMode: this.authMode,
      offlineNameStyle: this.offlineNameStyle,
      currentOfflineNames: this.getCurrentOfflineNameList(),
      savedNameLists: this.savedNameLists,
      started: this.started,
      configuredBots: this.accounts.length,
      connectedBots: this.getConnectedBots().length,
      joinDelayMs: this.config.joinDelayMs,
      bots: Array.from(this.bots.values()).map((entry) => {
        const bot = entry.bot
        const pos = bot.entity ? bot.entity.position : null
        return {
          id: entry.id,
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
    const username = this.authMode === 'offline'
      ? this.getOfflineUsername(account)
      : (account._loginUsername || account.username)

    const options = {
      host: this.config.host,
      port: this.config.port,
      version: this.config.version,
      username,
      auth: this.authMode === 'offline' ? 'offline' : (account.auth || 'microsoft'),
      hideErrors: true
    }

    if (proxyUrl) {
      try {
        options.agent = new ProxyAgent(proxyUrl)
      } catch (error) {
        log(account.username, `Failed to construct proxy agent. Falling back to direct connection: ${error.message}`)
      }
    }

    if (this.authMode === 'offline') {
      log(account.username, `Using offline auth mode with generated username: ${username}`)
    } else {
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
    }

    return options
  }

  spawnBot(index, account, isReconnect) {
    const proxyUrl = this.resolveProxyFor(index)
    const botId = this.getSlotId(account)

    try {
      const previous = this.bots.get(botId)
      const retryCount = isReconnect && previous ? previous.retries || 0 : 0

      const bot = mineflayer.createBot(this.buildBotOptions(account, proxyUrl))
      bot.loadPlugin(pathfinder)
      bot.loadPlugin(pvp)

      this.bots.set(botId, {
        id: botId,
        bot,
        account,
        index,
        proxyUrl,
        retries: retryCount,
        manualStop: false
      })

      this.registerBotListeners(botId)
      log(botId, `${isReconnect ? 'Reconnecting' : 'Spawning'} bot${proxyUrl ? ` via ${proxyUrl}` : ' without proxy'}.`)
      this.emitState()
    } catch (error) {
      log(botId, `createBot failed: ${formatError(error)}`)
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
      log(botId, `Kicked (loggedIn=${loggedIn}): ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`)
      this.emitState()
    })

    bot.on('error', (error) => {
      log(botId, `Error: ${formatError(error)}`)
      this.emitState()
    })

    bot.on('end', (reason) => {
      log(botId, `Disconnected: ${reason || 'unknown reason'}`)
      this.emitState()

      const currentState = this.bots.get(botId)
      if (currentState && currentState.manualStop) {
        this.bots.delete(botId)
        this.emitState()
        return
      }

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

  getConnectedBots(targetUsernames) {
    const hasTargets = Array.isArray(targetUsernames) && targetUsernames.length > 0
    const targetSet = hasTargets ? new Set(targetUsernames) : null

    return Array.from(this.bots.values())
      .map((entry) => entry.bot)
      .filter((bot) => {
        if (!bot || !bot.player) {
          return false
        }
        if (!targetSet) {
          return true
        }
        return targetSet.has(bot.username)
      })
  }

  executeCommand(command, args, targetUsernames) {
    switch (command) {
      case 'come':
        this.commandCome(targetUsernames)
        return { ok: true, command: 'come' }
      case 'spam':
        return this.commandSpam(args, targetUsernames)
      case 'attack':
        return this.commandAttack(args, targetUsernames)
      case 'status':
        return this.commandStatus(targetUsernames)
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

  commandCome(targetUsernames) {
    const bots = this.getConnectedBots(targetUsernames)

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

  commandSpam(args, targetUsernames) {
    const text = args.join(' ').trim()
    if (!text) {
      log('command', 'spam ignored: empty message.')
      return { ok: false, error: 'spam requires a message.' }
    }

    const bots = this.getConnectedBots(targetUsernames)

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

  commandAttack(args, targetUsernames) {
    const targetName = (args[0] || '').trim()
    if (!targetName) {
      log('command', 'attack ignored: missing target name.')
      return { ok: false, error: 'attack requires a target.' }
    }

    const bots = this.getConnectedBots(targetUsernames)

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

  commandStatus(targetUsernames) {
    const bots = this.getConnectedBots(targetUsernames)
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
    if (!this.started) {
      return
    }

    const slotId = this.getSlotId(account)
    const state = this.bots.get(slotId)
    if (!state) {
      return
    }

    if (!this.config.reconnect.enabled) {
      this.bots.delete(slotId)
      this.emitState()
      return
    }

    const retries = (state.retries || 0) + 1
    if (retries > this.config.reconnect.maxRetries) {
      log(slotId, `Reconnect limit reached (${this.config.reconnect.maxRetries}).`)
      this.bots.delete(slotId)
      this.emitState()
      return
    }

    state.retries = retries

    const jitter = Math.floor(Math.random() * 1000)
    const delay = this.config.reconnect.baseDelayMs + jitter

    log(slotId, `Scheduling reconnect #${retries} in ${delay}ms.`)

    const timerId = setTimeout(() => {
      this.reconnectTimers.delete(slotId)
      this.spawnBot(state.index, account, true)
    }, delay)

    this.reconnectTimers.set(slotId, timerId)
  }

  async setAuthMode(mode) {
    if (!['offline', 'microsoft'].includes(mode)) {
      return { ok: false, error: 'Invalid auth mode. Must be offline or microsoft.' }
    }

    if (mode === this.authMode) {
      return { ok: true, mode, restartOccurred: false }
    }

    this.authMode = mode

    if (mode === 'offline') {
      this.regenerateOfflineUsernames()
    } else {
      this.generatedOfflineNames.clear()
    }

    const wasStarted = this.started
    if (wasStarted) {
      await this.stop()
      await this.start()
    } else {
      this.emitState()
    }

    return { ok: true, mode, restartOccurred: wasStarted }
  }

  async setOfflineNameStyle(style) {
    if (!OFFLINE_NAME_STYLES.includes(style)) {
      return { ok: false, error: 'Invalid offline name style. Must be gaming, human, or mixed.' }
    }

    if (style === this.offlineNameStyle) {
      return { ok: true, style, restartOccurred: false }
    }

    this.offlineNameStyle = style
    this.regenerateOfflineUsernames()

    const shouldRestart = this.started && this.authMode === 'offline'
    if (shouldRestart) {
      await this.stop()
      await this.start()
    } else {
      this.emitState()
    }

    return { ok: true, style, restartOccurred: shouldRestart }
  }

  async setServerConfig(nextConfig) {
    let host = String(nextConfig.host || '').trim()
    let port = Number(nextConfig.port)
    const joinDelayMs = Number(nextConfig.joinDelayMs)
    const versionInput = nextConfig.version === false ? '' : String(nextConfig.version || '').trim()

    if (host.includes(':')) {
      const [maybeHost, maybePort] = host.split(':')
      if (maybeHost && maybePort && /^\d+$/.test(maybePort)) {
        host = maybeHost
        port = Number(maybePort)
      }
    }

    const version = versionInput && /^\d+\.\d+(\.\d+)?$/.test(versionInput) ? versionInput : false

    if (!host) {
      return { ok: false, error: 'Host is required.' }
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'Port must be an integer between 1 and 65535.' }
    }
    if (!Number.isFinite(joinDelayMs) || joinDelayMs < 0 || joinDelayMs > 120000) {
      return { ok: false, error: 'Join delay must be between 0 and 120000 ms.' }
    }

    const changed =
      this.config.host !== host ||
      this.config.port !== port ||
      this.config.joinDelayMs !== joinDelayMs ||
      this.config.version !== (version || false)

    this.config.host = host
    this.config.port = port
    this.config.joinDelayMs = joinDelayMs
    this.config.version = version || false

    const restartOccurred = changed && this.started
    if (restartOccurred) {
      await this.stop()
      await this.start()
    } else if (!this.started) {
      await this.start()
    } else {
      this.emitState()
    }

    return { ok: true, restartOccurred, server: `${host}:${port}` }
  }

  async setBotCount(count) {
    const parsed = Number(count)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
      return { ok: false, error: 'Bot count must be between 1 and 500.' }
    }

    if (parsed === this.activeBotCount) {
      return { ok: true, botCount: parsed, restartOccurred: false }
    }

    this.activeBotCount = parsed
    const restartOccurred = this.started
    if (restartOccurred) {
      await this.stop()
      await this.start()
    } else {
      this.emitState()
    }

    return { ok: true, botCount: parsed, restartOccurred }
  }

  async stopSingleBot(botId) {
    const state = this.bots.get(botId)
    if (!state) {
      return { ok: false, error: 'Bot not found.' }
    }

    state.manualStop = true
    const timerId = this.reconnectTimers.get(botId)
    if (timerId) {
      clearTimeout(timerId)
      this.reconnectTimers.delete(botId)
    }

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
      state.bot.quit('Single bot stop requested')
    } catch (_error) {
      // no-op
    }

    this.emitState()
    return { ok: true, botId }
  }

  async startSingleBot(botId) {
    this.ensureActiveSlots()

    const slot = this.activeSlots.find((account) => this.getSlotId(account) === botId)
    if (!slot) {
      return { ok: false, error: 'Bot slot not found.' }
    }

    const existing = this.bots.get(botId)
    if (existing && existing.bot && existing.bot.player) {
      return { ok: true, botId, alreadyRunning: true }
    }

    this.spawnBot(slot._slotIndex || 0, slot, false)
    this.emitState()
    return { ok: true, botId, alreadyRunning: false }
  }

  async stop() {
    this.started = false

    for (const timerId of this.reconnectTimers.values()) {
      clearTimeout(timerId)
    }
    this.reconnectTimers.clear()

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

  app.get('/health', (_req, res) => {
    res.json({ ok: true, uptimeSec: Math.floor(process.uptime()) })
  })

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

  app.post('/api/start', async (_req, res) => {
    await manager.start()
    manager.emitState()
    res.json({ ok: true, message: 'Swarm start requested.' })
  })

  app.post('/api/server-config', async (req, res) => {
    const { host, port, version, joinDelayMs } = req.body || {}
    const result = await manager.setServerConfig({ host, port, version, joinDelayMs })
    if (!result.ok) {
      res.status(400).json(result)
      return
    }

    manager.emitState()
    res.json(result)
  })

  app.post('/api/bot-count', async (req, res) => {
    const { botCount } = req.body || {}
    const result = await manager.setBotCount(botCount)
    if (!result.ok) {
      res.status(400).json(result)
      return
    }

    manager.emitState()
    res.json(result)
  })

  app.post('/api/mode', async (req, res) => {
    const { mode } = req.body || {}

    if (!mode || !['offline', 'microsoft'].includes(mode)) {
      res.status(400).json({ ok: false, error: 'Invalid or missing mode. Must be offline or microsoft.' })
      return
    }

    const result = await manager.setAuthMode(mode)
    if (!result.ok) {
      res.status(400).json(result)
      return
    }

    manager.emitState()
    res.json(result)
  })

  app.post('/api/offline-name-style', async (req, res) => {
    const { style } = req.body || {}

    if (!style || !OFFLINE_NAME_STYLES.includes(style)) {
      res.status(400).json({ ok: false, error: 'Invalid or missing style. Must be gaming, human, or mixed.' })
      return
    }

    const result = await manager.setOfflineNameStyle(style)
    if (!result.ok) {
      res.status(400).json(result)
      return
    }

    manager.emitState()
    res.json(result)
  })

  app.post('/api/offline-names/save', async (_req, res) => {
    const result = await manager.saveCurrentOfflineNames()
    if (!result.ok) {
      res.status(400).json(result)
      return
    }

    manager.emitState()
    res.json(result)
  })

  app.post('/api/offline-names/delete', async (req, res) => {
    const { id } = req.body || {}
    if (!id) {
      res.status(400).json({ ok: false, error: 'Missing saved entry id.' })
      return
    }

    const result = await manager.deleteSavedNames(id)
    if (!result.ok) {
      res.status(404).json(result)
      return
    }

    manager.emitState()
    res.json(result)
  })

  app.post('/api/bot-command', async (req, res) => {
    const { botId, username, command, args, message } = req.body || {}

    const resolvedBotId = (() => {
      if (typeof botId === 'string' && botId) {
        return botId
      }

      if (typeof username === 'string' && username) {
        const byLiveUsername = Array.from(manager.bots.values()).find((entry) => entry.bot && entry.bot.username === username)
        if (byLiveUsername) {
          return byLiveUsername.id
        }

        manager.ensureActiveSlots()
        const slot = manager.activeSlots.find((account) => manager.getSlotId(account) === username)
        if (slot) {
          return manager.getSlotId(slot)
        }
      }

      return ''
    })()

    if (!resolvedBotId) {
      res.status(400).json({ ok: false, error: 'Missing bot identifier (botId or username).' })
      return
    }

    if (!command || typeof command !== 'string') {
      res.status(400).json({ ok: false, error: 'Missing command.' })
      return
    }

    if (command === 'start') {
      const result = await manager.startSingleBot(resolvedBotId)
      if (!result.ok) {
        res.status(400).json(result)
        return
      }
      manager.emitState()
      res.json(result)
      return
    }

    if (command === 'stop') {
      const result = await manager.stopSingleBot(resolvedBotId)
      if (!result.ok) {
        res.status(400).json(result)
        return
      }
      manager.emitState()
      res.json(result)
      return
    }

    if (command === 'say') {
      if (!message || typeof message !== 'string') {
        res.status(400).json({ ok: false, error: 'Missing message for say command.' })
        return
      }

      const result = manager.executeCommand('spam', [message], [resolvedBotId])
      if (!result.ok) {
        res.status(400).json(result)
        return
      }

      manager.emitState()
      res.json(result)
      return
    }

    const safeArgs = Array.isArray(args) ? args : []
    const result = manager.executeCommand(String(command).toLowerCase(), safeArgs, [resolvedBotId])
    if (!result.ok) {
      res.status(400).json(result)
      return
    }

    manager.emitState()
    res.json(result)
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
    const savedNameLists = await loadSavedNameLists(CONFIG.savedNamesPath)

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
    manager.initializeSavedNameLists(savedNameLists)
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
