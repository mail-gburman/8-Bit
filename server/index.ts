import { createServer } from 'node:http'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import {
  createInitialSessionState,
  DEFAULT_CONFIG,
  type ClientMessage,
  type PoemConfig,
  type SelectedWord,
  type ServerMessage,
  type SessionState,
} from '../src/lib/protocol.ts'

// ── Types ─────────────────────────────────────────────────────────────────────

type StoredPoem = PoemConfig & { id: string; createdAt: number; updatedAt: number }

type SessionRecord = {
  id: string
  poemTitle: string
  selectedWords: SelectedWord[]
  accuracy: number
  mistakes: number
  totalWords: number
  startedAt: number
  endedAt: number
}

// ── Store ─────────────────────────────────────────────────────────────────────

const poems = new Map<string, StoredPoem>()
const sessions: SessionRecord[] = []
let currentSession: SessionState = createInitialSessionState(DEFAULT_CONFIG)
let sessionStartedAt = Date.now()

poems.set('default', {
  ...DEFAULT_CONFIG,
  id: 'default',
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

function archiveSession() {
  const { selectedWords, config } = currentSession
  if (selectedWords.length === 0) return
  const mistakes = selectedWords.filter((w) => !w.isCorrect).length
  const accuracy = Math.round(
    ((selectedWords.length - mistakes) / selectedWords.length) * 100,
  )
  sessions.unshift({
    id: `session-${Date.now()}`,
    poemTitle: config.title,
    selectedWords: [...selectedWords],
    accuracy,
    mistakes,
    totalWords: config.poem.length,
    startedAt: sessionStartedAt,
    endedAt: Date.now(),
  })
  if (sessions.length > 50) sessions.splice(50)
}

// ── WS helpers ────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true })

function broadcastSync() {
  const msg: ServerMessage = { type: 'sync', payload: currentSession }
  const data = JSON.stringify(msg)
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(data)
  }
}

function syncTo(socket: WebSocket) {
  socket.send(JSON.stringify({ type: 'sync', payload: currentSession } satisfies ServerMessage))
}

function appendWord(payload: Omit<SelectedWord, 'id' | 'createdAt'>) {
  const entry: SelectedWord = {
    id: currentSession.selectedWords.length + 1,
    createdAt: Date.now(),
    ...payload,
  }
  currentSession = { ...currentSession, selectedWords: [...currentSession.selectedWords, entry] }
}

wss.on('connection', (socket: WebSocket) => {
  syncTo(socket)

  socket.on('message', (buffer: RawData) => {
    try {
      const msg = JSON.parse(buffer.toString()) as ClientMessage
      switch (msg.type) {
        case 'pick_word':
          appendWord(msg.payload)
          break
        case 'update_config':
          archiveSession()
          currentSession = createInitialSessionState(msg.payload)
          sessionStartedAt = Date.now()
          break
        case 'transcript_update':
          currentSession = { ...currentSession, transcript: msg.payload }
          break
        case 'reset_session':
          archiveSession()
          currentSession = createInitialSessionState(currentSession.config)
          sessionStartedAt = Date.now()
          break
      }
      broadcastSync()
    } catch (error) {
      console.error('[WS] bad message', error)
    }
  })
})

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function sendJson(res: import('node:http').ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(data))
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => resolve(body))
  })
}

// ── HTTP server + REST routes ─────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const seg = url.pathname.replace(/^\/|\/$/g, '').split('/')

  try {
    // GET /health
    if (req.method === 'GET' && seg[0] === 'health') {
      sendJson(res, { ok: true, poems: poems.size, sessions: sessions.length })
      return
    }

    // ── Poems ──
    if (seg[0] === 'poems') {
      if (req.method === 'GET' && !seg[1]) {
        sendJson(res, [...poems.values()])
        return
      }
      if (req.method === 'POST' && !seg[1]) {
        const body = JSON.parse(await readBody(req)) as PoemConfig
        const id = `poem-${Date.now()}`
        const stored: StoredPoem = { ...body, id, createdAt: Date.now(), updatedAt: Date.now() }
        poems.set(id, stored)
        sendJson(res, stored, 201)
        return
      }
      if (req.method === 'PUT' && seg[1]) {
        const id = seg[1]
        if (!poems.has(id)) { sendJson(res, { error: 'Not found' }, 404); return }
        const body = JSON.parse(await readBody(req)) as PoemConfig
        const existing = poems.get(id)!
        const updated: StoredPoem = { ...existing, ...body, id, updatedAt: Date.now() }
        poems.set(id, updated)
        sendJson(res, updated)
        return
      }
      if (req.method === 'DELETE' && seg[1]) {
        const id = seg[1]
        if (id === 'default') { sendJson(res, { error: 'Cannot delete default poem' }, 400); return }
        if (!poems.has(id)) { sendJson(res, { error: 'Not found' }, 404); return }
        poems.delete(id)
        sendJson(res, { ok: true })
        return
      }
    }

    // ── Sessions ──
    if (seg[0] === 'sessions') {
      if (req.method === 'GET' && !seg[1]) {
        sendJson(res, sessions)
        return
      }
      if (req.method === 'GET' && seg[1] === 'current') {
        sendJson(res, currentSession)
        return
      }
    }

    sendJson(res, { error: 'Not found' }, 404)
  } catch (err) {
    sendJson(res, { error: String(err) }, 500)
  }
})

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
})

const port = Number(process.env.PORT ?? 8787)
server.listen(port, () => {
  console.log(`[MOUTH SHORE] Backend on :${port}`)
})
