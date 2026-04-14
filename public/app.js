const stateEls = {
  server: document.getElementById('server'),
  configuredBots: document.getElementById('configuredBots'),
  connectedBots: document.getElementById('connectedBots'),
  joinDelay: document.getElementById('joinDelay'),
  authModeBadge: document.getElementById('authModeBadge'),
  swarmStatus: document.getElementById('swarmStatus'),
  backendStatus: document.getElementById('backendStatus'),
  backendBanner: document.getElementById('backendBanner'),
  backendBannerText: document.getElementById('backendBannerText'),
  retryHealthCheck: document.getElementById('retryHealthCheck'),
  botGrid: document.getElementById('botGrid'),
  logFeed: document.getElementById('logFeed'),
  feedback: document.getElementById('feedback'),
  modeMicrosoft: document.getElementById('modeMicrosoft'),
  modeOffline: document.getElementById('modeOffline'),
  offlineOptions: document.getElementById('offlineOptions'),
  offlineNameStyle: document.getElementById('offlineNameStyle'),
  saveNames: document.getElementById('saveNames'),
  savedNamesList: document.getElementById('savedNamesList'),
  currentOfflineNamesList: document.getElementById('currentOfflineNamesList'),
  serverHost: document.getElementById('serverHost'),
  serverPort: document.getElementById('serverPort'),
  serverVersion: document.getElementById('serverVersion'),
  serverJoinDelay: document.getElementById('joinDelayMs'),
  botCount: document.getElementById('botCount'),
  botCountHint: document.getElementById('botCountHint'),
  applySettings: document.getElementById('applySettings')
}

const commandForm = document.getElementById('commandForm')
const commandInput = document.getElementById('commandInput')
const serverConfigForm = document.getElementById('serverConfigForm')
const startAll = document.getElementById('startAll')
const stopAll = document.getElementById('stopAll')
const themeToggle = document.getElementById('themeToggle')

const socket = io()

let modeChangeInFlight = false
let styleChangeInFlight = false
let settingsInFlight = false
let commandInFlight = false
let currentAuthMode = 'microsoft'
let currentOfflineNameStyle = 'mixed'
let currentWarningThreshold = 200
let serverFormDirty = false
let backendOnline = false
let feedbackTimer = null

let refreshBackendNow = async () => {}

function setFeedback(message, type = 'info', sticky = false) {
  if (!stateEls.feedback) {
    return
  }

  stateEls.feedback.textContent = message || ''
  stateEls.feedback.className = `feedback ${type}`

  if (feedbackTimer) {
    clearTimeout(feedbackTimer)
    feedbackTimer = null
  }

  if (!sticky && type === 'success' && message) {
    feedbackTimer = setTimeout(() => {
      if (stateEls.feedback.textContent === message) {
        stateEls.feedback.textContent = ''
        stateEls.feedback.className = 'feedback'
      }
    }, 3200)
  }
}

function updateOfflineUiState() {
  const isOfflineMode = currentAuthMode === 'offline'

  if (stateEls.offlineOptions) {
    stateEls.offlineOptions.classList.toggle('hidden', !isOfflineMode)
  }

  if (stateEls.offlineNameStyle) {
    stateEls.offlineNameStyle.disabled = !backendOnline || !isOfflineMode || styleChangeInFlight
  }

  if (stateEls.saveNames) {
    stateEls.saveNames.disabled = !backendOnline || !isOfflineMode
  }
}

function setBackendStatus(online, reasonText = '') {
  const wasOnline = backendOnline
  backendOnline = online

  if (stateEls.backendStatus) {
    stateEls.backendStatus.textContent = online ? 'ONLINE' : 'OFFLINE'
  }

  if (stateEls.backendBanner) {
    stateEls.backendBanner.classList.toggle('hidden', online)
  }

  if (stateEls.backendBannerText) {
    stateEls.backendBannerText.textContent = online
      ? 'Backend is online.'
      : (reasonText || 'Backend is offline. Reconnecting...')
  }

  const controls = [
    commandInput,
    startAll,
    stopAll,
    stateEls.serverHost,
    stateEls.serverPort,
    stateEls.serverVersion,
    stateEls.serverJoinDelay,
    stateEls.botCount,
    stateEls.applySettings
  ].filter(Boolean)

  for (const control of controls) {
    control.disabled = !online
  }

  for (const button of document.querySelectorAll('[data-cmd]')) {
    button.disabled = !online || commandInFlight
  }

  for (const radio of document.querySelectorAll('input[name="authMode"]')) {
    radio.disabled = !online || modeChangeInFlight
  }

  updateOfflineUiState()

  if (!wasOnline && online) {
    setFeedback('Connection restored. Backend is online.', 'success')
  }
}

function updateBotCountHint(advisory, enteredCount) {
  if (!stateEls.botCountHint) {
    return
  }

  const threshold = advisory && Number.isFinite(advisory.warningThreshold)
    ? advisory.warningThreshold
    : currentWarningThreshold

  if (Number.isFinite(threshold) && threshold > 0) {
    currentWarningThreshold = threshold
  }

  if (advisory && advisory.warning) {
    stateEls.botCountHint.textContent = advisory.message || `High bot counts can reduce stability. Consider using less than ${threshold}.`
    stateEls.botCountHint.className = 'hint warning'
    return
  }

  if (Number.isFinite(enteredCount) && enteredCount >= currentWarningThreshold) {
    stateEls.botCountHint.textContent = `Large bot counts are allowed, but may overload your machine. Warning starts at ${currentWarningThreshold}+ bots.`
    stateEls.botCountHint.className = 'hint warning'
    return
  }

  stateEls.botCountHint.textContent = `No hard max is enforced. Warning starts at ${currentWarningThreshold}+ bots.`
  stateEls.botCountHint.className = 'hint'
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
    empty.textContent = 'No active offline names yet.'
    stateEls.currentOfflineNamesList.appendChild(empty)
    return
  }

  for (const row of names) {
    const item = document.createElement('article')
    item.className = 'saved-entry'
    item.innerHTML = `
      <div class="saved-entry-meta">Slot: ${row.account}</div>
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

      const confirmed = window.confirm('Delete this saved name set? This cannot be undone.')
      if (!confirmed) {
        return
      }

      try {
        await postJSON('/api/offline-names/delete', { id })
        setFeedback('Saved name set deleted.', 'success')
      } catch (error) {
        setFeedback(error.message || 'Could not delete saved names.', 'error', true)
      }
    })
  }
}

function appendLog(entry) {
  if (!stateEls.logFeed) {
    return
  }

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
  if (!stateEls.botGrid) {
    return
  }

  stateEls.botGrid.innerHTML = ''

  if (!bots.length) {
    const empty = document.createElement('div')
    empty.className = 'bot-card bot-card-empty'
    empty.textContent = 'No bots in the fleet yet. Save settings and start the swarm.'
    stateEls.botGrid.appendChild(empty)
    return
  }

  for (const bot of bots) {
    const card = document.createElement('article')
    card.className = 'bot-card'

    const position = bot.position ? `${bot.position.x}, ${bot.position.y}, ${bot.position.z}` : 'unknown'
    const statusClass = bot.connected ? 'connected' : 'disconnected'
    const statusLabel = bot.connected ? 'Connected' : 'Disconnected'

    card.innerHTML = `
      <div class="bot-head">
        <div class="bot-name">${bot.username}</div>
        <span class="bot-status ${statusClass}">${statusLabel}</span>
      </div>
      <div class="bot-meta">Health: ${bot.health ?? 'n/a'}</div>
      <div class="bot-meta">Position: ${position}</div>
      <details class="bot-details">
        <summary>Details</summary>
        <div class="bot-meta">ID: ${bot.id}</div>
        <div class="bot-meta">Proxy: ${bot.usingProxy ? 'Yes' : 'No'}</div>
        <div class="bot-meta">Retries: ${bot.retries}</div>
      </details>
      <div class="bot-actions">
        <button class="btn ghost bot-action" data-id="${bot.id}" data-action="status" type="button">Status</button>
        <button class="btn ghost bot-action" data-id="${bot.id}" data-action="come" type="button">Come</button>
        <button class="btn ghost bot-action" data-id="${bot.id}" data-action="start" type="button">Start</button>
        <button class="btn danger bot-action" data-id="${bot.id}" data-action="stop" type="button">Stop</button>
      </div>
      <div class="bot-say-row">
        <input class="bot-say-input" data-id="${bot.id}" type="text" placeholder="Message from this bot" />
        <button class="btn ghost bot-say-btn" data-id="${bot.id}" type="button">Say</button>
      </div>
    `

    stateEls.botGrid.appendChild(card)
  }

  for (const button of stateEls.botGrid.querySelectorAll('.bot-action')) {
    button.addEventListener('click', async () => {
      if (!backendOnline) {
        setFeedback('Backend is offline. Please wait for reconnection.', 'error', true)
        return
      }

      const botId = button.getAttribute('data-id')
      const action = button.getAttribute('data-action')
      if (!botId || !action) {
        return
      }

      const oldText = button.textContent
      button.disabled = true
      button.textContent = 'Working...'

      try {
        await postJSON('/api/bot-command', {
          botId,
          command: action,
          args: []
        })
        setFeedback(`Bot ${botId}: ${action} completed.`, 'success')
      } catch (error) {
        setFeedback(error.message || 'Bot command failed.', 'error', true)
      } finally {
        button.disabled = false
        button.textContent = oldText
      }
    })
  }

  for (const button of stateEls.botGrid.querySelectorAll('.bot-say-btn')) {
    button.addEventListener('click', async () => {
      if (!backendOnline) {
        setFeedback('Backend is offline. Please wait for reconnection.', 'error', true)
        return
      }

      const botId = button.getAttribute('data-id')
      const input = stateEls.botGrid.querySelector(`.bot-say-input[data-id="${botId}"]`)
      const message = input ? input.value.trim() : ''

      if (!botId || !message) {
        setFeedback('Enter a message before sending.', 'error', true)
        return
      }

      button.disabled = true
      try {
        await postJSON('/api/bot-command', {
          botId,
          command: 'say',
          message
        })
        setFeedback(`Bot ${botId}: message sent.`, 'success')
        input.value = ''
      } catch (error) {
        setFeedback(error.message || 'Could not send message.', 'error', true)
      } finally {
        button.disabled = false
      }
    })
  }
}

function renderState(state) {
  setBackendStatus(true)

  stateEls.server.textContent = state.server || '-'
  stateEls.configuredBots.textContent = String(state.configuredBots ?? 0)
  stateEls.connectedBots.textContent = String(state.connectedBots ?? 0)
  stateEls.joinDelay.textContent = `${state.joinDelayMs ?? 0}ms`
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

  updateOfflineUiState()

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

  updateBotCountHint(state.botCountAdvisory, Number(stateEls.botCount.value))

  if (startAll) {
    startAll.disabled = !backendOnline || Boolean(state.started)
  }

  if (stopAll) {
    stopAll.disabled = !backendOnline || !Boolean(state.started)
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

  const payload = await response.json().catch(() => ({ ok: false, error: 'Invalid response from backend.' }))
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed')
  }
  return payload
}

commandForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  if (commandInFlight) {
    return
  }

  const input = commandInput.value.trim()
  if (!input) {
    setFeedback('Type a command before sending.', 'error', true)
    return
  }

  commandInFlight = true
  setFeedback('Sending command...', 'info')

  try {
    await postJSON('/api/command', { input })
    setFeedback(`Command sent: ${input}`, 'success')
    commandInput.value = ''
  } catch (error) {
    setFeedback(error.message || 'Command failed.', 'error', true)
  } finally {
    commandInFlight = false
  }
})

for (const button of document.querySelectorAll('[data-cmd]')) {
  button.addEventListener('click', async () => {
    if (commandInFlight) {
      return
    }

    const input = (button.getAttribute('data-cmd') || '').trim()
    if (!input) {
      return
    }

    commandInFlight = true
    setFeedback(`Running quick action: ${input}`, 'info')

    try {
      await postJSON('/api/command', { input })
      setFeedback(`Quick action complete: ${input}`, 'success')
    } catch (error) {
      setFeedback(error.message || 'Quick action failed.', 'error', true)
    } finally {
      commandInFlight = false
    }
  })
}

if (serverConfigForm) {
  for (const field of serverConfigForm.querySelectorAll('input')) {
    field.addEventListener('input', () => {
      serverFormDirty = true

      if (field === stateEls.botCount) {
        const requestedCount = Number(stateEls.botCount.value)
        updateBotCountHint(null, requestedCount)
      }
    })
  }

  serverConfigForm.addEventListener('submit', async (event) => {
    event.preventDefault()

    if (settingsInFlight) {
      return
    }

    const host = (stateEls.serverHost.value || '').trim()
    const port = Number(stateEls.serverPort.value)
    const joinDelayMs = Number(stateEls.serverJoinDelay.value)
    const botCount = Number(stateEls.botCount.value)
    const versionRaw = (stateEls.serverVersion.value || '').trim()

    if (!host) {
      setFeedback('Host is required.', 'error', true)
      return
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setFeedback('Port must be between 1 and 65535.', 'error', true)
      return
    }

    if (!Number.isFinite(joinDelayMs) || joinDelayMs < 0 || joinDelayMs > 120000) {
      setFeedback('Join delay must be between 0 and 120000 milliseconds.', 'error', true)
      return
    }

    if (!Number.isInteger(botCount) || botCount < 1) {
      setFeedback('Bot count must be at least 1.', 'error', true)
      return
    }

    settingsInFlight = true
    if (stateEls.applySettings) {
      stateEls.applySettings.disabled = true
      stateEls.applySettings.textContent = 'Saving...'
    }

    setFeedback('Saving settings...', 'info')

    try {
      const configResult = await postJSON('/api/server-config', {
        host,
        port,
        version: versionRaw || false,
        joinDelayMs
      })

      const countResult = await postJSON('/api/bot-count', {
        botCount
      })

      serverFormDirty = false
      updateBotCountHint(countResult.advisory, botCount)

      const changedRunningSwarm = Boolean(configResult.restartOccurred || countResult.restartOccurred)
      if (changedRunningSwarm) {
        setFeedback('Settings saved. Running bots are reconnecting now.', 'success')
      } else {
        setFeedback('Settings saved. Swarm is ready with the new configuration.', 'success')
      }
    } catch (error) {
      setFeedback(error.message || 'Could not save settings.', 'error', true)
    } finally {
      settingsInFlight = false
      if (stateEls.applySettings) {
        stateEls.applySettings.disabled = !backendOnline
        stateEls.applySettings.textContent = 'Save Settings'
      }
    }
  })
}

if (startAll) {
  startAll.addEventListener('click', async () => {
    if (!backendOnline) {
      setFeedback('Backend is offline. Cannot start swarm yet.', 'error', true)
      return
    }

    startAll.disabled = true
    setFeedback('Starting swarm...', 'info')

    try {
      await postJSON('/api/start')
      setFeedback('Swarm start requested.', 'success')
    } catch (error) {
      setFeedback(error.message || 'Failed to start swarm.', 'error', true)
      startAll.disabled = false
    }
  })
}

if (stopAll) {
  stopAll.addEventListener('click', async () => {
    if (!backendOnline) {
      setFeedback('Backend is offline. Cannot stop swarm right now.', 'error', true)
      return
    }

    stopAll.disabled = true
    setFeedback('Stopping swarm...', 'info')

    try {
      await postJSON('/api/stop')
      setFeedback('Swarm stop requested.', 'success')
    } catch (error) {
      setFeedback(error.message || 'Failed to stop swarm.', 'error', true)
      stopAll.disabled = false
    }
  })
}

for (const radio of document.querySelectorAll('input[name="authMode"]')) {
  radio.addEventListener('change', async (event) => {
    const newMode = event.target.value
    if (modeChangeInFlight || newMode === currentAuthMode) {
      return
    }

    modeChangeInFlight = true
    updateOfflineUiState()
    setFeedback(`Changing authentication to ${newMode}...`, 'info')

    try {
      const result = await postJSON('/api/mode', { mode: newMode })
      currentAuthMode = result.mode
      updateOfflineUiState()

      setFeedback(result.restartOccurred
        ? `Authentication changed to ${result.mode}. Running bots are reconnecting.`
        : `Authentication changed to ${result.mode}.`, 'success')
    } catch (error) {
      setFeedback(error.message || 'Could not change authentication mode.', 'error', true)
      const prevMode = document.querySelector(`input[name="authMode"][value="${currentAuthMode}"]`)
      if (prevMode) {
        prevMode.checked = true
      }
      updateOfflineUiState()
    } finally {
      modeChangeInFlight = false
      for (const modeRadio of document.querySelectorAll('input[name="authMode"]')) {
        modeRadio.disabled = !backendOnline
      }
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
    updateOfflineUiState()
    setFeedback(`Changing offline name style to ${newStyle}...`, 'info')

    try {
      const result = await postJSON('/api/offline-name-style', { style: newStyle })
      currentOfflineNameStyle = result.style
      setFeedback(result.restartOccurred
        ? `Offline name style changed to ${result.style}. Running bots are reconnecting.`
        : `Offline name style changed to ${result.style}.`, 'success')
    } catch (error) {
      setFeedback(error.message || 'Could not change offline name style.', 'error', true)
      stateEls.offlineNameStyle.value = currentOfflineNameStyle
    } finally {
      styleChangeInFlight = false
      updateOfflineUiState()
    }
  })
}

if (stateEls.saveNames) {
  stateEls.saveNames.addEventListener('click', async () => {
    if (currentAuthMode !== 'offline') {
      setFeedback('Switch to Offline mode to save generated names.', 'error', true)
      return
    }

    stateEls.saveNames.disabled = true
    setFeedback('Saving current offline names...', 'info')

    try {
      await postJSON('/api/offline-names/save')
      setFeedback('Current offline names saved.', 'success')
    } catch (error) {
      setFeedback(error.message || 'Could not save names.', 'error', true)
    } finally {
      stateEls.saveNames.disabled = !backendOnline || currentAuthMode !== 'offline'
    }
  })
}

if (stateEls.retryHealthCheck) {
  stateEls.retryHealthCheck.addEventListener('click', async () => {
    await refreshBackendNow()
  })
}

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const html = document.documentElement
    const current = html.getAttribute('data-theme')
    const next = current === 'dark' ? 'light' : 'dark'
    html.setAttribute('data-theme', next)
    localStorage.setItem('vs-theme', next)
  })
}

socket.on('state', (state) => {
  renderState(state)
})

socket.on('log', (entry) => {
  appendLog(entry)
})

async function bootstrap() {
  if (window.location.protocol === 'file:') {
    setFeedback('Open this panel with http://localhost:3000, not as a local file.', 'error', true)
    setBackendStatus(false, 'Backend is offline. Open from localhost.')
    return
  }

  const savedTheme = localStorage.getItem('vs-theme')
  if (savedTheme === 'light' || savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', savedTheme)
  }

  refreshBackendNow = async () => {
    try {
      const health = await fetch('/health')
      if (!health.ok) {
        throw new Error('Backend unavailable')
      }

      setBackendStatus(true)

      const response = await fetch('/api/state')
      if (!response.ok) {
        throw new Error('Failed to load state')
      }

      const payload = await response.json()
      renderState(payload.state)
    } catch (error) {
      setBackendStatus(false, error.message || 'Backend is offline. Reconnecting...')
    }
  }

  await refreshBackendNow()
  setInterval(refreshBackendNow, 5000)
}

bootstrap().catch((error) => {
  setBackendStatus(false, error.message || 'Backend is offline. Reconnecting...')
  setFeedback(error.message || 'Failed to load control panel.', 'error', true)
})
