const stateEls = {
  server: document.getElementById('server'),
  configuredBots: document.getElementById('configuredBots'),
  connectedBots: document.getElementById('connectedBots'),
  joinDelay: document.getElementById('joinDelay'),
  authModeBadge: document.getElementById('authModeBadge'),
  swarmStatus: document.getElementById('swarmStatus'),
  backendStatus: document.getElementById('backendStatus'),
  botGrid: document.getElementById('botGrid'),
  logFeed: document.getElementById('logFeed'),
  feedback: document.getElementById('feedback'),
  modeMicrosoft: document.getElementById('modeMicrosoft'),
  modeOffline: document.getElementById('modeOffline'),
  offlineNameStyle: document.getElementById('offlineNameStyle'),
  saveNames: document.getElementById('saveNames'),
  savedNamesList: document.getElementById('savedNamesList'),
  currentOfflineNamesList: document.getElementById('currentOfflineNamesList'),
  serverHost: document.getElementById('serverHost'),
  serverPort: document.getElementById('serverPort'),
  serverVersion: document.getElementById('serverVersion'),
  serverJoinDelay: document.getElementById('joinDelayMs'),
  botCount: document.getElementById('botCount')
}

const commandForm = document.getElementById('commandForm')
const commandInput = document.getElementById('commandInput')
const serverConfigForm = document.getElementById('serverConfigForm')
const startAll = document.getElementById('startAll')
const stopAll = document.getElementById('stopAll')
const themeToggle = document.getElementById('themeToggle')

const socket = io()
let modeChangeInFlight = false
let currentAuthMode = 'microsoft'
let styleChangeInFlight = false
let currentOfflineNameStyle = 'mixed'
let serverFormDirty = false
let backendOnline = false

function setFeedback(message) {
  stateEls.feedback.textContent = message
}

function setBackendStatus(online) {
  backendOnline = online
  if (stateEls.backendStatus) {
    stateEls.backendStatus.textContent = online ? 'ONLINE' : 'OFFLINE'
  }

  const controls = [
    commandInput,
    startAll,
    stopAll,
    stateEls.offlineNameStyle,
    stateEls.saveNames,
    stateEls.serverHost,
    stateEls.serverPort,
    stateEls.serverVersion,
    stateEls.serverJoinDelay
  ].filter(Boolean)

  for (const control of controls) {
    control.disabled = !online
  }

  for (const button of document.querySelectorAll('[data-cmd]')) {
    button.disabled = !online
  }

  for (const radio of document.querySelectorAll('input[name="authMode"]')) {
    radio.disabled = !online
  }
}

function renderCurrentOfflineNames(state) {
  if (!stateEls.currentOfflineNamesList) {
    return
  }

  const names = Array.isArray(state.currentOfflineNames) ? state.currentOfflineNames : []
  stateEls.currentOfflineNamesList.innerHTML = ''

  if (!names.length) {
    const empty = document.createElement('div')
    empty.className = 'saved-names-empty'
    empty.textContent = 'No active offline names right now.'
    stateEls.currentOfflineNamesList.appendChild(empty)
    return
  }

  for (const row of names) {
    const item = document.createElement('article')
    item.className = 'saved-entry'
    item.innerHTML = `
      <div class="saved-entry-meta">account: ${row.account}</div>
      <div class="saved-entry-names">${row.generated}</div>
    `
    stateEls.currentOfflineNamesList.appendChild(item)
  }
}

function renderSavedNames(state) {
  if (!stateEls.savedNamesList) {
    return
  }

  const list = Array.isArray(state.savedNameLists) ? state.savedNameLists : []
  stateEls.savedNamesList.innerHTML = ''

  if (!list.length) {
    const empty = document.createElement('div')
    empty.className = 'saved-names-empty'
    empty.textContent = 'No saved name sets yet.'
    stateEls.savedNamesList.appendChild(empty)
    return
  }

  for (const entry of list) {
    const item = document.createElement('article')
    item.className = 'saved-entry'

    const created = new Date(entry.createdAt).toLocaleString()
    const names = (entry.names || []).map((n) => n.generated).join(', ')

    item.innerHTML = `
      <div class="saved-entry-meta">${created} | ${entry.style} | ${entry.count} names</div>
      <div class="saved-entry-names">${names}</div>
      <button class="btn ghost saved-delete" data-id="${entry.id}" type="button">Delete</button>
    `

    stateEls.savedNamesList.appendChild(item)
  }

  for (const button of stateEls.savedNamesList.querySelectorAll('.saved-delete')) {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-id')
      if (!id) {
        return
      }

      try {
        await postJSON('/api/offline-names/delete', { id })
        setFeedback('saved names entry deleted')
      } catch (error) {
        setFeedback(`error: ${error.message}`)
      }
    })
  }
}

function appendLog(entry) {
  const line = document.createElement('div')
  line.className = 'log-line'

  const time = new Date(entry.ts).toLocaleTimeString()
  const head = document.createElement('strong')
  head.textContent = `[${time}] [${entry.scope}]`
  line.appendChild(head)

  const msg = document.createElement('span')
  msg.textContent = ` ${entry.message || ''}`
  line.appendChild(msg)

  if (entry.details) {
    const details = document.createElement('div')
    details.className = 'log-details'
    details.textContent = typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details)
    line.appendChild(details)
  }

  stateEls.logFeed.prepend(line)

  while (stateEls.logFeed.children.length > 500) {
    stateEls.logFeed.removeChild(stateEls.logFeed.lastChild)
  }
}

function renderBots(bots) {
  stateEls.botGrid.innerHTML = ''
  if (!bots.length) {
    const empty = document.createElement('div')
    empty.className = 'bot-card'
    empty.textContent = 'No bots available yet.'
    stateEls.botGrid.appendChild(empty)
    return
  }

  for (const bot of bots) {
    const card = document.createElement('article')
    card.className = 'bot-card'

    const position = bot.position ? `${bot.position.x}, ${bot.position.y}, ${bot.position.z}` : 'n/a'
    card.innerHTML = `
      <div class="bot-name">${bot.username}</div>
      <div class="bot-meta">id: ${bot.id}</div>
      <div class="bot-meta">connected: ${bot.connected}</div>
      <div class="bot-meta">health: ${bot.health ?? 'n/a'}</div>
      <div class="bot-meta">position: ${position}</div>
      <div class="bot-meta">proxy: ${bot.usingProxy ? 'yes' : 'no'}</div>
      <div class="bot-meta">retries: ${bot.retries}</div>
      <div class="bot-actions">
        <button class="btn ghost bot-action" data-id="${bot.id}" data-action="status" type="button">Status</button>
        <button class="btn ghost bot-action" data-id="${bot.id}" data-action="come" type="button">Come</button>
        <button class="btn ghost bot-action" data-id="${bot.id}" data-action="start" type="button">Start</button>
        <button class="btn danger bot-action" data-id="${bot.id}" data-action="stop" type="button">Stop</button>
      </div>
      <div class="bot-say-row">
        <input class="bot-say-input" data-id="${bot.id}" type="text" placeholder="Say something" />
        <button class="btn ghost bot-say-btn" data-id="${bot.id}" type="button">Say</button>
      </div>
    `

    stateEls.botGrid.appendChild(card)
  }

  for (const button of stateEls.botGrid.querySelectorAll('.bot-action')) {
    button.addEventListener('click', async () => {
      const botId = button.getAttribute('data-id')
      const action = button.getAttribute('data-action')
      if (!botId || !action) {
        return
      }

      try {
        await postJSON('/api/bot-command', {
          botId,
          command: action,
          args: []
        })
        setFeedback(`bot ${botId}: ${action} ok`)
      } catch (error) {
        setFeedback(`error: ${error.message}`)
      }
    })
  }

  for (const button of stateEls.botGrid.querySelectorAll('.bot-say-btn')) {
    button.addEventListener('click', async () => {
      const botId = button.getAttribute('data-id')
      const input = stateEls.botGrid.querySelector(`.bot-say-input[data-id="${botId}"]`)
      const message = input ? input.value.trim() : ''

      if (!botId || !message) {
        return
      }

      try {
        await postJSON('/api/bot-command', {
          botId,
          command: 'say',
          message
        })
        setFeedback(`bot ${botId}: message sent`)
        input.value = ''
      } catch (error) {
        setFeedback(`error: ${error.message}`)
      }
    })
  }
}

function renderState(state) {
  setBackendStatus(true)
  stateEls.server.textContent = state.server
  stateEls.configuredBots.textContent = String(state.configuredBots)
  stateEls.connectedBots.textContent = String(state.connectedBots)
  stateEls.joinDelay.textContent = `${state.joinDelayMs}ms`
  stateEls.authModeBadge.textContent = (state.authMode || currentAuthMode || 'microsoft').toUpperCase()
  stateEls.swarmStatus.textContent = state.started ? 'RUNNING' : 'STOPPED'

  if (state.authMode && state.authMode !== currentAuthMode) {
    currentAuthMode = state.authMode
  }

  const selectedMode = document.querySelector(`input[name="authMode"][value="${currentAuthMode}"]`)
  if (selectedMode) {
    selectedMode.checked = true
  }

  if (state.offlineNameStyle) {
    currentOfflineNameStyle = state.offlineNameStyle
  }

  if (stateEls.offlineNameStyle && stateEls.offlineNameStyle.value !== currentOfflineNameStyle) {
    stateEls.offlineNameStyle.value = currentOfflineNameStyle
  }

  if (stateEls.offlineNameStyle) {
    stateEls.offlineNameStyle.disabled = !backendOnline || currentAuthMode !== 'offline'
  }

  if (stateEls.saveNames) {
    stateEls.saveNames.disabled = !backendOnline || currentAuthMode !== 'offline'
  }

  if (!serverFormDirty && state.serverConfig) {
    stateEls.serverHost.value = state.serverConfig.host || ''
    stateEls.serverPort.value = Number.isFinite(state.serverConfig.port) ? String(state.serverConfig.port) : ''
    stateEls.serverVersion.value = state.serverConfig.version || ''
    stateEls.serverJoinDelay.value = Number.isFinite(state.serverConfig.joinDelayMs)
      ? String(state.serverConfig.joinDelayMs)
      : ''

    stateEls.botCount.value = Number.isFinite(state.activeBotCount)
      ? String(state.activeBotCount)
      : ''
  }

  if (startAll) {
    startAll.disabled = Boolean(state.started)
  }
  if (stopAll) {
    stopAll.disabled = !Boolean(state.started)
  }

  renderBots(state.bots || [])
  renderSavedNames(state)
  renderCurrentOfflineNames(state)
}

async function postJSON(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body || {})
  })

  const payload = await response.json().catch(() => ({ ok: false, error: 'Invalid response' }))
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed')
  }
  return payload
}

commandForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const input = commandInput.value.trim()
  if (!input) {
    return
  }

  setFeedback('sending...')

  try {
    await postJSON('/api/command', { input })
    setFeedback(`ok: ${input}`)
    commandInput.value = ''
  } catch (error) {
    setFeedback(`error: ${error.message}`)
  }
})

for (const button of document.querySelectorAll('[data-cmd]')) {
  button.addEventListener('click', async () => {
    const input = button.getAttribute('data-cmd') || ''
    try {
      await postJSON('/api/command', { input })
      setFeedback(`ok: ${input}`)
    } catch (error) {
      setFeedback(`error: ${error.message}`)
    }
  })
}

if (serverConfigForm) {
  for (const field of serverConfigForm.querySelectorAll('input')) {
    field.addEventListener('input', () => {
      serverFormDirty = true
    })
  }

  serverConfigForm.addEventListener('submit', async (event) => {
    event.preventDefault()

    const host = (stateEls.serverHost.value || '').trim()
    const port = Number(stateEls.serverPort.value)
    const joinDelayMs = Number(stateEls.serverJoinDelay.value)
    const botCount = Number(stateEls.botCount.value)
    const versionRaw = (stateEls.serverVersion.value || '').trim()

    if (!host) {
      setFeedback('error: host is required')
      return
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setFeedback('error: port must be between 1 and 65535')
      return
    }
    if (!Number.isFinite(joinDelayMs) || joinDelayMs < 0 || joinDelayMs > 120000) {
      setFeedback('error: join delay must be between 0 and 120000')
      return
    }
    if (!Number.isInteger(botCount) || botCount < 1) {
      setFeedback('error: bot count must be at least 1')
      return
    }

    setFeedback('applying server settings...')

    try {
      const result = await postJSON('/api/server-config', {
        host,
        port,
        version: versionRaw || false,
        joinDelayMs
      })

      const countResult = await postJSON('/api/bot-count', {
        botCount
      })

      serverFormDirty = false
      setFeedback((result.restartOccurred || countResult.restartOccurred)
        ? 'server settings applied (swarm restarting)'
        : 'server settings applied')
    } catch (error) {
      setFeedback(`error: ${error.message}`)
    }
  })
}

if (startAll) {
  startAll.addEventListener('click', async () => {
    setFeedback('starting swarm...')
    try {
      await postJSON('/api/start')
      setFeedback('swarm start requested')
    } catch (error) {
      setFeedback(`error: ${error.message}`)
    }
  })
}

stopAll.addEventListener('click', async () => {
  try {
    await postJSON('/api/stop')
    setFeedback('swarm stop requested')
  } catch (error) {
    setFeedback(`error: ${error.message}`)
  }
})

for (const radio of document.querySelectorAll('input[name="authMode"]')) {
  radio.addEventListener('change', async (event) => {
    const newMode = event.target.value
    if (modeChangeInFlight || newMode === currentAuthMode) {
      return
    }

    modeChangeInFlight = true
    setFeedback(`changing auth mode to ${newMode}...`)

    try {
      const result = await postJSON('/api/mode', { mode: newMode })
      currentAuthMode = result.mode
      setFeedback(result.restartOccurred
        ? `auth mode: ${result.mode} (swarm restarting)`
        : `auth mode: ${result.mode}`)
    } catch (error) {
      setFeedback(`error: ${error.message}`)
      const prevMode = document.querySelector(`input[name="authMode"][value="${currentAuthMode}"]`)
      if (prevMode) {
        prevMode.checked = true
      }
    } finally {
      modeChangeInFlight = false
    }
  })
}

if (stateEls.offlineNameStyle) {
  stateEls.offlineNameStyle.addEventListener('change', async (event) => {
    const newStyle = event.target.value
    if (styleChangeInFlight || newStyle === currentOfflineNameStyle) {
      return
    }

    styleChangeInFlight = true
    setFeedback(`changing offline name style to ${newStyle}...`)

    try {
      const result = await postJSON('/api/offline-name-style', { style: newStyle })
      currentOfflineNameStyle = result.style
      setFeedback(result.restartOccurred
        ? `offline name style: ${result.style} (swarm restarting)`
        : `offline name style: ${result.style}`)
    } catch (error) {
      setFeedback(`error: ${error.message}`)
      stateEls.offlineNameStyle.value = currentOfflineNameStyle
    } finally {
      styleChangeInFlight = false
    }
  })
}

if (stateEls.saveNames) {
  stateEls.saveNames.addEventListener('click', async () => {
    try {
      await postJSON('/api/offline-names/save')
      setFeedback('current offline names saved')
    } catch (error) {
      setFeedback(`error: ${error.message}`)
    }
  })
}

themeToggle.addEventListener('click', () => {
  const html = document.documentElement
  const current = html.getAttribute('data-theme')
  const next = current === 'dark' ? 'light' : 'dark'
  html.setAttribute('data-theme', next)
  localStorage.setItem('vs-theme', next)
})

socket.on('state', (state) => {
  renderState(state)
})

socket.on('log', (entry) => {
  appendLog(entry)
})

async function bootstrap() {
  if (window.location.protocol === 'file:') {
    setFeedback('error: open via http://localhost:3000, not as a local file')
    setBackendStatus(false)
    return
  }

  const savedTheme = localStorage.getItem('vs-theme')
  if (savedTheme === 'light' || savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', savedTheme)
  }

  const refreshBackend = async () => {
    try {
      const health = await fetch('/health')
      if (!health.ok) {
        throw new Error('backend unavailable')
      }

      const wasOffline = !backendOnline
      setBackendStatus(true)

      if (wasOffline) {
        setFeedback('backend online')
      }

      const response = await fetch('/api/state')
      if (!response.ok) {
        throw new Error('failed to load state')
      }

      const payload = await response.json()
      renderState(payload.state)
    } catch (error) {
      setBackendStatus(false)
      setFeedback(`error: ${error.message}`)
    }
  }

  await refreshBackend()
  setInterval(refreshBackend, 5000)
}

bootstrap().catch((error) => {
  setBackendStatus(false)
  setFeedback(`error: ${error.message}`)
})
