const stateEls = {
  server: document.getElementById('server'),
  configuredBots: document.getElementById('configuredBots'),
  connectedBots: document.getElementById('connectedBots'),
  joinDelay: document.getElementById('joinDelay'),
  botGrid: document.getElementById('botGrid'),
  logFeed: document.getElementById('logFeed'),
  feedback: document.getElementById('feedback')
}

const commandForm = document.getElementById('commandForm')
const commandInput = document.getElementById('commandInput')
const stopAll = document.getElementById('stopAll')
const themeToggle = document.getElementById('themeToggle')

const socket = io()

function appendLog(entry) {
  const line = document.createElement('div')
  line.className = 'log-line'

  const time = new Date(entry.ts).toLocaleTimeString()
  const details = entry.details ? ` ${JSON.stringify(entry.details)}` : ''
  line.innerHTML = `<strong>[${time}] [${entry.scope}]</strong> ${entry.message}${details}`

  stateEls.logFeed.prepend(line)

  while (stateEls.logFeed.children.length > 120) {
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
      <div class="bot-meta">connected: ${bot.connected}</div>
      <div class="bot-meta">health: ${bot.health ?? 'n/a'}</div>
      <div class="bot-meta">position: ${position}</div>
      <div class="bot-meta">proxy: ${bot.usingProxy ? 'yes' : 'no'}</div>
      <div class="bot-meta">retries: ${bot.retries}</div>
    `

    stateEls.botGrid.appendChild(card)
  }
}

function renderState(state) {
  stateEls.server.textContent = state.server
  stateEls.configuredBots.textContent = String(state.configuredBots)
  stateEls.connectedBots.textContent = String(state.connectedBots)
  stateEls.joinDelay.textContent = `${state.joinDelayMs}ms`
  renderBots(state.bots || [])
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

  stateEls.feedback.textContent = 'sending...'

  try {
    await postJSON('/api/command', { input })
    stateEls.feedback.textContent = `ok: ${input}`
    commandInput.value = ''
  } catch (error) {
    stateEls.feedback.textContent = `error: ${error.message}`
  }
})

for (const button of document.querySelectorAll('[data-cmd]')) {
  button.addEventListener('click', async () => {
    const input = button.getAttribute('data-cmd') || ''
    try {
      await postJSON('/api/command', { input })
      stateEls.feedback.textContent = `ok: ${input}`
    } catch (error) {
      stateEls.feedback.textContent = `error: ${error.message}`
    }
  })
}

stopAll.addEventListener('click', async () => {
  try {
    await postJSON('/api/stop')
    stateEls.feedback.textContent = 'swarm stop requested'
  } catch (error) {
    stateEls.feedback.textContent = `error: ${error.message}`
  }
})

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
  const savedTheme = localStorage.getItem('vs-theme')
  if (savedTheme === 'light' || savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', savedTheme)
  }

  const response = await fetch('/api/state')
  if (response.ok) {
    const payload = await response.json()
    renderState(payload.state)
  }
}

bootstrap().catch((error) => {
  stateEls.feedback.textContent = `error: ${error.message}`
})
