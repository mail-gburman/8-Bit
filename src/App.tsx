import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react'
import './App.css'
import {
  AUDIENCE_DELAY_MS,
  buildWaves,
  getMouthPosition,
  getVisemeFrames,
  type MouthVariant,
} from './lib/game.ts'
import { WordMouth } from './lib/mouthSvg.tsx'
import {
  createInitialSessionState,
  DEFAULT_CONFIG,
  type ClientMessage,
  type PoemConfig,
  type SelectedWord,
  type ServerMessage,
  type SessionState,
  type TranscriptState,
} from './lib/protocol.ts'

// ── Speech recognition types ──────────────────────────────────────────────────

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

type RecognitionResult = { readonly transcript: string }
type RecognitionAlternative = { readonly 0: RecognitionResult; readonly isFinal: boolean; readonly length: number }
type RecognitionResultList = { readonly [index: number]: RecognitionAlternative; readonly length: number }
type SpeechRecognitionEventLike = Event & { readonly resultIndex: number; readonly results: RecognitionResultList }
type SpeechRecognitionLike = {
  continuous: boolean; interimResults: boolean; lang: string
  onend: (() => void) | null; onerror: ((event: Event) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  start(): void; stop(): void
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike
type MicState = 'idle' | 'listening' | 'unsupported' | 'blocked'

// ── App types ─────────────────────────────────────────────────────────────────

type ScreenMode = 'split' | 'performer' | 'audience' | 'admin'
type AdminTab = 'poems' | 'avatar-voice' | 'history'

type StoredPoem = PoemConfig & { id: string; createdAt: number; updatedAt: number }

type SessionRecord = {
  id: string; poemTitle: string; selectedWords: SelectedWord[]
  accuracy: number; mistakes: number; totalWords: number
  startedAt: number; endedAt: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WS_PORT = 8787
const API_BASE = `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:${WS_PORT}`

const AVATAR_OPTIONS = [
  { seed: 'Moonbeam',  bg: 'b6e3f4' },
  { seed: 'Stardust',  bg: 'c0aede' },
  { seed: 'Comet',     bg: 'd1d4f9' },
  { seed: 'Nebula',    bg: 'ffd5dc' },
  { seed: 'Aurora',    bg: 'ffdfbf' },
  { seed: 'Cosmos',    bg: 'c1f4c5' },
]

function dicebearUrl(seed: string, bg: string) {
  return `https://api.dicebear.com/9.x/pixel-art/png?seed=${encodeURIComponent(seed)}&size=64&backgroundColor=${bg}`
}

// ── Phonetic variant generator (no API needed) ────────────────────────────────

function generatePhoneticVariants(word: string): string[] {
  const w = word.toLowerCase().trim()
  if (w.length < 2) return []
  const variants = new Set<string>()

  const rules: [RegExp, string][] = [
    // endings
    [/ing$/,  "in'"], [/tion$/, 'shun'], [/ment$/, 'munt'],
    [/er$/,   'ur'],  [/or$/,   'ur'],   [/ly$/,   'lee'],
    [/ed$/,   't'],   [/ness$/, 'nus'],  [/ful$/,  'fool'],
    [/ight/,  'ite'], [/ough/,  'off'],  [/ight$/, 'ite'],
    // vowel clusters
    [/ay(?=\b)/, 'ai'], [/ai/, 'ay'], [/ee/, 'ea'], [/ea(?!d)/, 'ee'],
    [/oo/,   'ou'],  [/ou(?!t)/, 'oo'], [/ow(?=\b)/, 'oh'],
    // consonants
    [/ph/,   'f'],   [/ck/,   'k'],   [/wh/,   'w'],
    [/th/,   'dh'],  [/kn/,   'n'],   [/wr/,   'r'],
    [/c(?=[ei])/, 's'], [/que$/, 'k'],
    // double letters
    [/([lmns])\1/, '$1'], // un-double
  ]

  for (const [pattern, replacement] of rules) {
    if (variants.size >= 3) break
    const result = w.replace(pattern, replacement)
    if (result !== w && result.length > 1) {
      const cap = word[0] === word[0].toUpperCase()
        ? result.charAt(0).toUpperCase() + result.slice(1)
        : result
      if (cap !== word) variants.add(cap)
    }
  }

  // Fallback: double a vowel
  if (variants.size < 3) {
    for (const ch of 'aeiou') {
      if (variants.size >= 3) break
      const idx = w.indexOf(ch)
      if (idx !== -1) {
        const v = w.slice(0, idx) + ch + ch + w.slice(idx + 1)
        const cap = word[0] === word[0].toUpperCase()
          ? v.charAt(0).toUpperCase() + v.slice(1) : v
        if (cap !== word) variants.add(cap)
      }
    }
  }

  return [...variants].slice(0, 2)
}

// ── Text/PDF parsers ──────────────────────────────────────────────────────────

function parsePlainTextPoem(raw: string): PoemConfig {
  const text = raw.replace(/[^\w\s''-]/g, ' ')
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/^['']+|['']+$/g, '').trim())
    .filter((w) => w.length >= 2 && w.length <= 24)
    .slice(0, 60)

  if (words.length === 0) throw new Error('No usable words found in text.')

  const variants: Record<string, string[]> = {}
  for (const word of words) {
    if (!variants[word]) variants[word] = generatePhoneticVariants(word)
  }

  const titleLine = raw.split('\n')[0].trim().slice(0, 40)
  return { title: titleLine || 'Uploaded Poem', poem: words, variants }
}

async function extractPDFText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const latin1 = new TextDecoder('latin1').decode(new Uint8Array(buffer))
  let extracted = ''

  const btEtBlocks = latin1.match(/BT[\s\S]*?ET/g) ?? []
  for (const block of btEtBlocks) {
    const tjMatches = block.match(/\(((?:[^()\\]|\\[\s\S])*)\)\s*Tj/g) ?? []
    for (const m of tjMatches) {
      const text = m.match(/\(((?:[^()\\]|\\[\s\S])*)\)/)?.[1] ?? ''
      extracted += text.replace(/\\/g, '') + ' '
    }
    const tjArr = block.match(/\[[\s\S]*?\]\s*TJ/g) ?? []
    for (const arr of tjArr) {
      const parts = arr.match(/\(((?:[^()\\]|\\[\s\S])*)\)/g) ?? []
      for (const p of parts) extracted += p.slice(1, -1).replace(/\\/g, '') + ' '
    }
  }

  return extracted.replace(/\s+/g, ' ').trim()
}

function parseConfigFile(raw: string): PoemConfig {
  const data = JSON.parse(raw) as Partial<PoemConfig> & {
    entries?: Array<{ word: string; variants?: string[] }>
  }
  if (Array.isArray(data.poem) && data.variants && typeof data.variants === 'object') {
    return {
      title: data.title?.trim() || 'Uploaded Poem',
      poem: data.poem.map(String),
      variants: Object.fromEntries(
        Object.entries(data.variants).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : []]),
      ),
    }
  }
  if (Array.isArray(data.entries)) {
    return {
      title: data.title?.trim() || 'Uploaded Poem',
      poem: data.entries.map((e) => e.word),
      variants: Object.fromEntries(data.entries.map((e) => [e.word, (e.variants ?? []).map(String)])),
    }
  }
  throw new Error('Expected `{ poem, variants }` or `{ entries }` JSON.')
}

// ── 8-bit Web Audio sound effects ─────────────────────────────────────────────

function use8BitSounds() {
  const ctxRef = useRef<AudioContext | null>(null)

  function ctx(): AudioContext {
    if (!ctxRef.current) ctxRef.current = new AudioContext()
    return ctxRef.current
  }

  function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.18) {
    try {
      const ac = ctx()
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.connect(gain); gain.connect(ac.destination)
      osc.type = type
      osc.frequency.setValueAtTime(freq, ac.currentTime)
      gain.gain.setValueAtTime(vol, ac.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur)
      osc.start(ac.currentTime); osc.stop(ac.currentTime + dur)
    } catch { /* audio blocked */ }
  }

  return {
    playCorrect() {
      tone(523, 0.08); setTimeout(() => tone(659, 0.08), 80); setTimeout(() => tone(784, 0.14), 160)
    },
    playWrong() {
      tone(160, 0.14, 'sawtooth', 0.2); setTimeout(() => tone(120, 0.14, 'sawtooth', 0.2), 100)
    },
    playArrival() { tone(330, 0.05, 'square', 0.08) },
    playComplete() {
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.15), i * 120))
    },
  }
}

// ── TTS hook ──────────────────────────────────────────────────────────────────

function useTTS() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceIndex, setVoiceIndex] = useState(0)
  const [speaking, setSpeaking] = useState(false)

  useEffect(() => {
    function load() {
      const v = window.speechSynthesis?.getVoices() ?? []
      if (v.length) setVoices(v)
    }
    load()
    window.speechSynthesis?.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load)
  }, [])

  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis || !text.trim()) return
    window.speechSynthesis.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.voice = voices[voiceIndex] ?? null
    utt.rate = 0.88
    utt.pitch = 1.05
    utt.onstart = () => setSpeaking(true)
    utt.onend = () => setSpeaking(false)
    utt.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(utt)
  }, [voices, voiceIndex])

  const cancel = useCallback(() => {
    window.speechSynthesis?.cancel()
    setSpeaking(false)
  }, [])

  return { voices, voiceIndex, setVoiceIndex, speak, cancel, speaking }
}

// ── Media recorder hook ───────────────────────────────────────────────────────

function useMediaRecorder() {
  const [recording, setRecording] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => chunksRef.current.push(e.data)
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setAudioUrl(URL.createObjectURL(blob))
        for (const t of stream.getTracks()) t.stop()
      }
      rec.start()
      recorderRef.current = rec
      setRecording(true)
    } catch { /* permission denied */ }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    setRecording(false)
  }

  return { recording, audioUrl, startRecording, stopRecording }
}

// ── Socket hook ───────────────────────────────────────────────────────────────

function useSocketState() {
  const [sharedState, setSharedState] = useState<SessionState>(createInitialSessionState(DEFAULT_CONFIG))
  const [connected, setConnected] = useState(false)
  const [socketError, setSocketError] = useState('')
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${proto}://${window.location.hostname}:${WS_PORT}`)
    socketRef.current = socket
    socket.onopen = () => { setConnected(true); setSocketError('') }
    socket.onclose = () => { setConnected(false); setSocketError('Backend offline — run `npm run dev:server`') }
    socket.onerror = () => { setConnected(false); setSocketError('WS connection failed') }
    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMessage
      if (msg.type === 'sync') setSharedState(msg.payload)
    }
    return () => { socket.close(); socketRef.current = null }
  }, [])

  function send(msg: ClientMessage) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg))
    }
  }

  return { sharedState, connected, socketError, send }
}

// ── URL helpers ───────────────────────────────────────────────────────────────

function getScreenMode(): ScreenMode {
  const s = new URLSearchParams(window.location.search).get('screen')
  if (s === 'performer' || s === 'audience' || s === 'admin') return s
  return 'split'
}

function splitTranscript(text: string) {
  return text.split(/\s+/).map((w) => w.trim()).filter(Boolean)
}

// ── Main App ──────────────────────────────────────────────────────────────────

function ScreenNav({ current }: { current: ScreenMode }) {
  const links: { href: string; label: string; key: ScreenMode | 'admin' }[] = [
    { href: '?screen=split',     label: 'SPLIT',     key: 'split' },
    { href: '?screen=performer', label: 'PERFORMER', key: 'performer' },
    { href: '?screen=audience',  label: 'AUDIENCE',  key: 'audience' },
    { href: '?screen=admin',     label: 'ADMIN',     key: 'admin' },
  ]
  return (
    <div className="screen-nav">
      {links.map(({ href, label, key }) => (
        <a key={key} href={href} className={current === key ? 'active' : ''}>{label}</a>
      ))}
    </div>
  )
}

function App() {
  const screenMode = getScreenMode()
  const { sharedState, connected, socketError, send } = useSocketState()
  const { speak, cancel: cancelTTS, speaking: ttsSpeaking, voices, voiceIndex, setVoiceIndex } = useTTS()
  const { recording, audioUrl, startRecording, stopRecording } = useMediaRecorder()
  const sounds = use8BitSounds()

  const [now, setNow] = useState(Date.now)
  const [micState, setMicState] = useState<MicState>('idle')
  const [flashWrongIds, setFlashWrongIds] = useState<string[]>([])
  const [uploadError, setUploadError] = useState('')
  const [uploadName, setUploadName] = useState('')
  const [visemeIndex, setVisemeIndex] = useState(0)
  const [ttsVisemeText, setTtsVisemeText] = useState('')
  const [ttsVisemeIdx, setTtsVisemeIdx] = useState(0)
  const [avatarSeed, setAvatarSeed] = useState(AVATAR_OPTIONS[0].seed)
  const [aiGenerating, setAiGenerating] = useState(false)

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const config = sharedState.config
  const selectedWords = sharedState.selectedWords
  const waves = buildWaves(config)
  const activeWaves = waves
    .map((wave) => ({
      ...wave,
      mouths: wave.mouths.filter(
        (m) => !selectedWords.some((e) => e.word === m.label && e.source === m.source),
      ),
    }))
    .filter((wave) => wave.mouths.length > 0)

  const expectedWord = config.poem[selectedWords.length] ?? null
  const mistakes = selectedWords.filter((e) => !e.isCorrect).length
  const accuracy = selectedWords.length
    ? Math.round(((selectedWords.length - mistakes) / selectedWords.length) * 100) : 100

  const visibleAudienceWords = selectedWords.filter(
    (e) => now - e.createdAt >= AUDIENCE_DELAY_MS,
  )
  const clickedPoem = selectedWords.map((e) => e.word).join(' ')
  const audiencePoem = visibleAudienceWords.map((e) => e.word).join(' ')
  const transcriptText = sharedState.transcript.finalText || sharedState.transcript.interimText || ''

  // Viseme: TTS speaking → use ttsVisemeText; otherwise use transcript or clicked poem
  const baseLipText = transcriptText || audiencePoem
  const visemeFrames = getVisemeFrames(ttsSpeaking ? ttsVisemeText : baseLipText)
  const ttsVisemeFrames = getVisemeFrames(ttsVisemeText)
  const activeViseme = ttsSpeaking
    ? (ttsVisemeFrames[ttsVisemeIdx % Math.max(ttsVisemeFrames.length, 1)] ?? 'flat')
    : (visemeFrames[visemeIndex % Math.max(visemeFrames.length, 1)] ?? 'flat')

  // Sync audience avatar to clicked words too (not just TTS)
  // When a new word is added, set ttsVisemeText to that word so avatar syncs
  const lastClickedWord = selectedWords[selectedWords.length - 1]?.word ?? ''
  const prevLastWord = useRef('')

  useEffect(() => {
    if (lastClickedWord && lastClickedWord !== prevLastWord.current) {
      prevLastWord.current = lastClickedWord
      setTtsVisemeText(lastClickedWord)
      setTtsVisemeIdx(0)
    }
  }, [lastClickedWord])

  // Clocks
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 150)
    return () => window.clearInterval(t)
  }, [])

  // Normal viseme cycling (for non-TTS)
  useEffect(() => {
    const t = window.setInterval(() => {
      setVisemeIndex((i) => (i + 1) % Math.max(visemeFrames.length, 1))
    }, 110)
    return () => window.clearInterval(t)
  }, [visemeFrames])

  // Fast viseme cycling for TTS / clicked words
  useEffect(() => {
    const t = window.setInterval(() => {
      setTtsVisemeIdx((i) => (i + 1) % Math.max(ttsVisemeFrames.length, 1))
    }, 80)
    return () => window.clearInterval(t)
  }, [ttsVisemeFrames])

  // Play arrival sound when active waves change
  const prevWaveCount = useRef(activeWaves.length)
  useEffect(() => {
    if (activeWaves.length !== prevWaveCount.current) {
      sounds.playArrival()
      prevWaveCount.current = activeWaves.length
    }
  }, [activeWaves.length])

  // Complete poem
  useEffect(() => {
    if (selectedWords.length > 0 && selectedWords.length === config.poem.length && !expectedWord) {
      sounds.playComplete()
    }
  }, [selectedWords.length, config.poem.length])

  function sendTranscript(next: TranscriptState) {
    send({ type: 'transcript_update', payload: next })
  }

  function toggleMic() {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
      setMicState('idle')
      sendTranscript({ ...sharedState.transcript, active: false })
      return
    }
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Ctor) { setMicState('unsupported'); return }

    const rec = new Ctor()
    rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US'

    rec.onresult = (event) => {
      let finalText = sharedState.transcript.finalText
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const t = result[0]?.transcript?.trim() ?? ''
        if (!t) continue
        if (result.isFinal) finalText = `${finalText} ${t}`.trim()
        else interimText = t
      }
      sendTranscript({
        finalText, finalWords: splitTranscript(finalText),
        interimText, updatedAt: Date.now(), active: true,
      })
    }

    rec.onerror = () => setMicState('blocked')
    rec.onend = () => {
      recognitionRef.current = null
      setMicState('idle')
      sendTranscript({ ...sharedState.transcript, active: false })
    }

    rec.start()
    recognitionRef.current = rec
    setMicState('listening')
    sendTranscript({ ...sharedState.transcript, active: true, updatedAt: Date.now() })
  }

  function sendPick(mouth: MouthVariant) {
    send({
      type: 'pick_word',
      payload: { word: mouth.label, source: mouth.source, isCorrect: mouth.label === expectedWord },
    })
  }

  function handlePick(mouth: MouthVariant) {
    if (!expectedWord) return

    const isCorrect = mouth.label === expectedWord

    // Speak the clicked word via TTS → avatar lip-syncs
    speak(mouth.label)
    setTtsVisemeText(mouth.label)
    setTtsVisemeIdx(0)

    // AI generating flash
    setAiGenerating(true)
    window.setTimeout(() => setAiGenerating(false), 900)

    if (isCorrect) {
      sounds.playCorrect()
      sendPick(mouth)
      return
    }

    sounds.playWrong()
    setFlashWrongIds((ids) => [...ids, mouth.id])
    window.setTimeout(() => {
      setFlashWrongIds((ids) => ids.filter((id) => id !== mouth.id))
      sendPick(mouth)
    }, 360)
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      let config: PoemConfig
      const name = file.name.toLowerCase()
      if (name.endsWith('.json')) {
        config = parseConfigFile(await file.text())
      } else if (name.endsWith('.pdf')) {
        const text = await extractPDFText(file)
        if (!text) throw new Error('Could not extract text from PDF. Please use a text-based PDF or .txt file.')
        config = parsePlainTextPoem(text)
      } else {
        // .txt / .md / anything else — treat as plain text
        config = parsePlainTextPoem(await file.text())
      }
      setUploadName(file.name)
      setUploadError('')
      send({ type: 'update_config', payload: config })
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not parse file.')
    }
    event.target.value = ''
  }

  function resetSession() { send({ type: 'reset_session' }) }

  function renderPoemBar(words: SelectedWord[]) {
    return (
      <div className="poem-bar">
        {words.length ? (
          words.map((e) => (
            <span key={e.id} className={`poem-chip ${e.isCorrect ? 'correct' : 'wrong'}`}>
              {e.word}
            </span>
          ))
        ) : (
          <span className="poem-placeholder">Click mouths to assemble poem...</span>
        )}
      </div>
    )
  }

  const avatarOption = AVATAR_OPTIONS.find((a) => a.seed === avatarSeed) ?? AVATAR_OPTIONS[0]

  // ── Screens ──────────────────────────────────────────────────────────────────

  if (screenMode === 'admin') {
    return (
      <main className="app screen-admin">
        <AdminPanel
          send={send}
          voices={voices}
          voiceIndex={voiceIndex}
          setVoiceIndex={setVoiceIndex}
          avatarSeed={avatarSeed}
          setAvatarSeed={setAvatarSeed}
        />
      </main>
    )
  }

  return (
    <main className={`app screen-${screenMode}`}>
      {/* ── Performer panel ─────────────────────────────────────────────────── */}
      {(screenMode === 'split' || screenMode === 'performer') && (
        <section className="panel performer-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Performer Screen</p>
              <h1>{config.title}</h1>
            </div>
            <div className="mode-pills">
              <span className={`socket-pill ${connected ? 'online' : 'offline'}`}>
                {connected ? '● WS LIVE' : '○ WS DOWN'}
              </span>
              <ScreenNav current={screenMode} />
              <button type="button" className="px-btn red" onClick={resetSession}>↺ START OVER</button>
              <label className="upload-pill">
                UPLOAD POEM
                <input type="file" accept=".json,.txt,.md,.pdf" onChange={handleUpload} />
              </label>
            </div>
          </div>

          <div className="status-grid">
            <article>
              <span>Next Word</span>
              <strong style={{ fontSize: expectedWord && expectedWord.length > 8 ? '9px' : undefined }}>
                {expectedWord ?? '—DONE—'}
              </strong>
            </article>
            <article><span>Clicks</span><strong>{String(selectedWords.length).padStart(3, '0')}</strong></article>
            <article><span>Mistakes</span><strong>{String(mistakes).padStart(3, '0')}</strong></article>
            <article><span>Accuracy</span><strong>{accuracy}%</strong></article>
          </div>

          <div className="shore">
            <div className="water-stripes" />
            <div className="surf" />

            {/* Wave progress dots */}
            <div className="wave-progress">
              {waves.map((w) => {
                const done = !activeWaves.find((aw) => aw.id === w.id)
                const current = activeWaves[0]?.id === w.id
                return (
                  <span
                    key={w.id}
                    className={`wave-dot ${done ? 'done' : ''} ${current ? 'current' : ''}`}
                  />
                )
              })}
            </div>

            {/* Show ONLY the current (first active) wave */}
            {activeWaves[0] ? (
              <div
                key={activeWaves[0].id}
                className="wave-band"
              >
                <p className="wave-label">WAVE {activeWaves[0].id} / {waves.length}</p>
                <div className="mouth-grid">
                  {activeWaves[0].mouths.map((mouth, index) => {
                    const pos = getMouthPosition(index, activeWaves[0].mouths.length)
                    const style = {
                      left: pos.left,
                      top: pos.top,
                      '--mouth-rotate': `${pos.rotate}deg`,
                      '--float-delay': `${index * 0.15}s`,
                      '--drift-duration': `${5 + (index % 3)}s`,
                      '--arrival-delay': `${index * 0.06}s`,
                    } as CSSProperties & Record<string, string>
                    return (
                      <button
                        type="button"
                        key={mouth.id}
                        className={[
                          'mouth-piece',
                          mouth.isCorrect ? 'correct' : 'variant',
                          flashWrongIds.includes(mouth.id) ? 'wrong-flash' : '',
                        ].filter(Boolean).join(' ')}
                        style={style}
                        onClick={() => handlePick(mouth)}
                      >
                        <WordMouth word={mouth.label} className="mouth-piece-svg" />
                        <span>{mouth.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="shore-complete">
                <p>★ POEM COMPLETE ★</p>
                <button type="button" className="px-btn green" onClick={resetSession}>PLAY AGAIN</button>
              </div>
            )}
          </div>

          <div className="bottom-grid">
            <article className="console-card">
              <div className="card-head">
                <h2>GENERATED POEM</h2>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {clickedPoem && (
                    <button
                      type="button"
                      className={`px-btn green ${ttsSpeaking ? 'live' : ''}`}
                      onClick={() => ttsSpeaking ? cancelTTS() : speak(clickedPoem)}
                    >
                      {ttsSpeaking ? '■ STOP' : '▶ READ POEM'}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`px-btn ${micState === 'listening' ? 'live' : ''}`}
                    onClick={toggleMic}
                  >
                    {micState === 'listening' ? '■ STT' : '▶ STT'}
                  </button>
                  <button
                    type="button"
                    className={`px-btn ${recording ? 'live' : 'red'}`}
                    onClick={recording ? stopRecording : startRecording}
                  >
                    {recording ? '■ REC' : '● REC'}
                  </button>
                </div>
              </div>
              {renderPoemBar(selectedWords)}
              {/* Full poem as readable text — all clicked words, correct and wrong */}
              <div className="poem-full-text">
                {clickedPoem
                  ? selectedWords.map((e, i) => (
                      <span key={e.id} className={`poem-word-token ${e.isCorrect ? 'ok' : 'err'}`}>
                        {e.word}{(i + 1) % 5 === 0 ? '\n' : ' '}
                      </span>
                    ))
                  : <span className="poem-placeholder">{'> waiting for first click...'}</span>
                }
              </div>
              {audioUrl && (
                <div className="audio-controls">
                  <audio src={audioUrl} controls />
                </div>
              )}
              {uploadError && <p className="error-copy">ERROR: {uploadError}</p>}
            </article>

            <article className="console-card">
              <h2>SYNC + TRANSCRIPT</h2>
              <ul className="mic-log">
                <li>{connected ? 'websocket: connected' : socketError || 'websocket: offline'}</li>
                <li>
                  {micState === 'unsupported' ? 'stt: not supported'
                    : micState === 'blocked' ? 'stt: blocked'
                    : micState === 'listening' ? 'stt: LIVE ■'
                    : 'stt: idle'}
                </li>
                <li>{ttsSpeaking ? 'tts: SPEAKING ▶' : 'tts: idle'}</li>
                <li>{uploadName ? `file: ${uploadName}` : 'file: default poem'}</li>
              </ul>
              <p className="capture-copy term-cursor">
                {transcriptText || 'No speech yet.'}
              </p>
            </article>
          </div>
        </section>
      )}

      {/* ── Audience panel ───────────────────────────────────────────────────── */}
      {(screenMode === 'split' || screenMode === 'audience') && (
        <section className="panel audience-panel">
          <div className="ai-status-bar">
            <span className={`ai-blinker ${aiGenerating ? '' : 'red'}`} />
            {aiGenerating
              ? <span className="ai-generating-text">GENERATING...</span>
              : <span>MOCK AI v1.0</span>}
            <span style={{ marginLeft: 'auto' }}>
              {sharedState.transcript.active ? '🎙 VOICE → AVATAR' : 'CLICKS → AVATAR'}
            </span>
          </div>

          <div className="panel-header">
            <div>
              <p className="eyebrow">Audience Projection</p>
              <h1 className="term-cursor">GENERATING POEM</h1>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <ScreenNav current={screenMode} />
              <div className={`delay-chip ${ttsSpeaking ? 'active' : ''}`}>
                {ttsSpeaking ? '▶ SPEAKING' : `⧖ +${AUDIENCE_DELAY_MS}ms`}
              </div>
            </div>
          </div>

          <div className="avatar-stage">
            <div className="avatar-card">
              <div className="avatar-frame">
                <div className={`avatar-img-wrapper ${ttsSpeaking ? 'tts-active' : ''}`}>
                  <img
                    className="avatar-img"
                    src={dicebearUrl(avatarOption.seed, avatarOption.bg)}
                    alt="AI Avatar"
                  />
                  <div className={`avatar-mouth-overlay ${activeViseme}`} />
                </div>
                <div className="avatar-picker">
                  {AVATAR_OPTIONS.map((opt) => (
                    <button
                      key={opt.seed}
                      type="button"
                      className={`avatar-pick-btn ${avatarSeed === opt.seed ? 'selected' : ''}`}
                      onClick={() => setAvatarSeed(opt.seed)}
                      title={opt.seed}
                    >
                      <img
                        src={dicebearUrl(opt.seed, opt.bg)}
                        alt={opt.seed}
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
                <p className="avatar-meta">
                  VISEME: {activeViseme.toUpperCase()} | {avatarSeed.toUpperCase()}
                </p>

                {/* Voice selector */}
                {voices.length > 0 && (
                  <select
                    className="voice-select"
                    value={voiceIndex}
                    onChange={(e) => setVoiceIndex(Number(e.target.value))}
                  >
                    {voices.map((v, i) => (
                      <option key={i} value={i}>{v.name} ({v.lang})</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="subtitle-card" style={{ marginTop: '8px' }}>
                <h2>SUBTITLE FEED</h2>
                {renderPoemBar(visibleAudienceWords)}
                <p className="subtitle-text term-cursor">
                  {audiencePoem || '> awaiting words...'}
                </p>
                <div className="subtitle-metrics">
                  <article><span>Total</span><strong>{visibleAudienceWords.length}</strong></article>
                  <article><span>Errors</span>
                    <strong style={{ color: '#ff4444' }}>
                      {visibleAudienceWords.filter((e) => !e.isCorrect).length}
                    </strong>
                  </article>
                  <article><span>Waves</span><strong>{activeWaves.length}</strong></article>
                </div>
              </div>
            </div>
          </div>

          <article className="console-card audience-copy">
            <h2>SPEECH-TO-TEXT FEED</h2>
            <p>{transcriptText || '> no speech feed...'}</p>
          </article>
        </section>
      )}
    </main>
  )
}

// ── Admin Panel ───────────────────────────────────────────────────────────────

type AdminPanelProps = {
  send: (msg: ClientMessage) => void
  voices: SpeechSynthesisVoice[]
  voiceIndex: number
  setVoiceIndex: (i: number) => void
  avatarSeed: string
  setAvatarSeed: (s: string) => void
}

function AdminPanel({ send, voices, voiceIndex, setVoiceIndex, avatarSeed, setAvatarSeed }: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>('poems')
  const [poems, setPoems] = useState<StoredPoem[]>([])
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [editingPoem, setEditingPoem] = useState<StoredPoem | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newText, setNewText] = useState('')
  const [editError, setEditError] = useState('')
  const [parsePreview, setParsePreview] = useState<PoemConfig | null>(null)

  useEffect(() => {
    fetchPoems()
    fetchSessions()
  }, [])

  async function fetchPoems() {
    try {
      const res = await fetch(`${API_BASE}/poems`)
      setPoems(await res.json() as StoredPoem[])
    } catch { /* offline */ }
  }

  async function fetchSessions() {
    try {
      const res = await fetch(`${API_BASE}/sessions`)
      setSessions(await res.json() as SessionRecord[])
    } catch { /* offline */ }
  }

  function handleTextPreview() {
    setEditError('')
    try {
      const cfg = parsePlainTextPoem(newText)
      setParsePreview(cfg)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Parse error')
    }
  }

  async function handleSaveNew() {
    setEditError('')
    try {
      const cfg = parsePreview ?? parsePlainTextPoem(newText)
      cfg.title = newTitle.trim() || cfg.title
      await fetch(`${API_BASE}/poems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })
      setNewTitle(''); setNewText(''); setParsePreview(null)
      fetchPoems()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  async function handleDeletePoem(id: string) {
    await fetch(`${API_BASE}/poems/${id}`, { method: 'DELETE' })
    fetchPoems()
  }

  function handleLoadPoem(poem: StoredPoem) {
    send({ type: 'update_config', payload: poem })
  }

  async function handleUpdateVariants(poem: StoredPoem, word: string, rawVariants: string) {
    const variants = rawVariants.split(',').map((v) => v.trim()).filter(Boolean)
    const updated = { ...poem, variants: { ...poem.variants, [word]: variants } }
    await fetch(`${API_BASE}/poems/${poem.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })
    fetchPoems()
  }

  return (
    <section className="panel admin-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Admin Console</p>
          <h1>▶ MOUTH SHORE ADMIN</h1>
        </div>
        <ScreenNav current="admin" />
      </div>

      <div className="admin-tabs">
        {(['poems', 'avatar-voice', 'history'] as AdminTab[]).map((t) => (
          <button key={t} type="button" className={`admin-tab-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t.replace('-', ' + ').toUpperCase()}
          </button>
        ))}
      </div>

      {/* ── Poems tab ────────────────────────────────────────────────────────── */}
      {tab === 'poems' && (
        <div>
          <h2>SAVED POEMS</h2>
          <div className="poem-list">
            {poems.map((poem) => (
              <div key={poem.id} className="poem-row">
                <div className="poem-row-info">
                  <span className="poem-row-title">{poem.title}</span>
                  <span className="poem-row-meta">
                    {poem.poem.length} words · {Object.keys(poem.variants).length} variant sets
                  </span>
                </div>
                <div className="poem-row-actions">
                  <button type="button" className="px-btn green" onClick={() => handleLoadPoem(poem)}>LOAD</button>
                  <button type="button" className="px-btn sky" onClick={() => setEditingPoem(editingPoem?.id === poem.id ? null : poem)}>EDIT</button>
                  {poem.id !== 'default' && (
                    <button type="button" className="px-btn red" onClick={() => handleDeletePoem(poem.id)}>DEL</button>
                  )}
                </div>
                {editingPoem?.id === poem.id && (
                  <div style={{ width: '100%', marginTop: '8px' }}>
                    <p style={{ fontFamily: 'Press Start 2P', fontSize: '7px', color: 'var(--px-sky)', marginBottom: '8px' }}>
                      EDIT VARIANTS (comma-separated):
                    </p>
                    <div className="word-variants-grid">
                      {poem.poem.map((word) => (
                        <div key={word} className="word-variant-row">
                          <span className="variant-word-label">{word}</span>
                          <input
                            className="variant-input"
                            defaultValue={(poem.variants[word] ?? []).join(', ')}
                            onBlur={(e) => handleUpdateVariants(poem, word, e.target.value)}
                            placeholder="var1, var2, var3"
                          />
                          <button
                            type="button"
                            className="px-btn purple"
                            style={{ fontSize: '6px', padding: '4px 8px' }}
                            onClick={() => {
                              const auto = generatePhoneticVariants(word)
                              const input = document.querySelector<HTMLInputElement>(
                                `.word-variant-row input[data-word="${word}"]`,
                              )
                              if (input) input.value = auto.join(', ')
                              handleUpdateVariants(poem, word, auto.join(', '))
                            }}
                          >
                            AUTO
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <h2 style={{ marginTop: '20px' }}>ADD NEW POEM</h2>
          <div className="poem-editor">
            <div>
              <label>Poem Title</label>
              <input
                className="px-input"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="My Poem Title"
              />
            </div>
            <div>
              <label>Paste poem text (words separated by spaces/lines — variants auto-generated)</label>
              <textarea
                className="px-textarea"
                value={newText}
                onChange={(e) => { setNewText(e.target.value); setParsePreview(null) }}
                placeholder="Welcome to shore where mouths arrive..."
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="button" className="px-btn sky" onClick={handleTextPreview}>PREVIEW PARSE</button>
              <button type="button" className="px-btn green" onClick={handleSaveNew} disabled={!newText.trim()}>SAVE POEM</button>
            </div>
            {editError && <p className="error-copy">ERROR: {editError}</p>}
            {parsePreview && (
              <div style={{ border: '2px solid var(--px-green2)', padding: '8px' }}>
                <p style={{ fontFamily: 'Press Start 2P', fontSize: '7px', color: 'var(--px-green)', margin: '0 0 6px' }}>
                  PARSED: {parsePreview.poem.length} WORDS
                </p>
                <div style={{ fontFamily: 'VT323', fontSize: '18px', color: '#ccc' }}>
                  {parsePreview.poem.slice(0, 20).map((w) => (
                    <span key={w} style={{ marginRight: '8px' }}>
                      <strong style={{ color: 'var(--px-pink)' }}>{w}</strong>
                      <span style={{ color: 'var(--px-orange)', fontSize: '14px' }}>
                        {' '}({(parsePreview.variants[w] ?? []).join('|')})
                      </span>
                    </span>
                  ))}
                  {parsePreview.poem.length > 20 && ` ...+${parsePreview.poem.length - 20} more`}
                </div>
              </div>
            )}
            <div>
              <label>Or upload file (.txt, .pdf, .json)</label>
              <label className="upload-pill">
                CHOOSE FILE
                <input
                  type="file"
                  accept=".json,.txt,.md,.pdf"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    try {
                      let cfg: PoemConfig
                      if (file.name.endsWith('.json')) cfg = parseConfigFile(await file.text())
                      else if (file.name.endsWith('.pdf')) cfg = parsePlainTextPoem(await extractPDFText(file))
                      else cfg = parsePlainTextPoem(await file.text())
                      setNewTitle(cfg.title)
                      setNewText(cfg.poem.join(' '))
                      setParsePreview(cfg)
                    } catch (err) {
                      setEditError(err instanceof Error ? err.message : 'Parse failed')
                    }
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* ── Avatar + Voice tab ───────────────────────────────────────────────── */}
      {tab === 'avatar-voice' && (
        <div>
          <h2>AVATAR SELECTION</h2>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
            {AVATAR_OPTIONS.map((opt) => (
              <div
                key={opt.seed}
                style={{ textAlign: 'center', cursor: 'pointer' }}
                onClick={() => setAvatarSeed(opt.seed)}
              >
                <div
                  style={{
                    width: '96px', height: '96px',
                    border: `4px solid ${avatarSeed === opt.seed ? 'var(--px-sand)' : 'var(--px-gray)'}`,
                    boxShadow: avatarSeed === opt.seed ? '0 0 12px var(--px-sand)' : 'none',
                    overflow: 'hidden',
                    imageRendering: 'pixelated',
                  }}
                >
                  <img
                    src={dicebearUrl(opt.seed, opt.bg)}
                    alt={opt.seed}
                    style={{ width: '100%', height: '100%', imageRendering: 'pixelated', display: 'block' }}
                  />
                </div>
                <p style={{ fontFamily: 'Press Start 2P', fontSize: '6px', color: avatarSeed === opt.seed ? 'var(--px-sand)' : 'var(--px-gray)', marginTop: '6px' }}>
                  {opt.seed.toUpperCase()}
                </p>
              </div>
            ))}
          </div>

          <h2>VOICE SELECTION</h2>
          <p style={{ fontFamily: 'VT323', fontSize: '18px', color: 'var(--px-gray)', marginBottom: '8px' }}>
            Select TTS voice for avatar speech:
          </p>
          {voices.length === 0 ? (
            <p style={{ fontFamily: 'VT323', fontSize: '18px', color: 'var(--px-orange)' }}>
              No voices loaded yet. Try clicking in the audience panel.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: '6px', maxHeight: '300px', overflowY: 'auto' }}>
              {voices.map((v, i) => (
                <button
                  key={i}
                  type="button"
                  className={`px-btn ${voiceIndex === i ? 'green' : ''}`}
                  style={{ textAlign: 'left', fontSize: '6px' }}
                  onClick={() => setVoiceIndex(i)}
                >
                  {voiceIndex === i ? '▶ ' : '  '}{v.name} [{v.lang}]
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── History tab ──────────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <div>
          <h2>SESSION HISTORY</h2>
          <button type="button" className="px-btn sky" style={{ marginBottom: '10px' }} onClick={fetchSessions}>REFRESH</button>
          {sessions.length === 0 ? (
            <p style={{ fontFamily: 'VT323', fontSize: '20px', color: 'var(--px-gray)' }}>
              No sessions recorded yet. Play the game first!
            </p>
          ) : (
            <div className="session-list">
              {sessions.map((s) => (
                <div key={s.id} className="session-row">
                  <span className="session-row-title">{s.poemTitle}</span>
                  <div className="session-row-stats">
                    <span className="session-stat">
                      Words: <strong>{s.selectedWords.length}/{s.totalWords}</strong>
                    </span>
                    <span className={`session-stat ${s.accuracy < 70 ? 'bad' : ''}`}>
                      Accuracy: <strong>{s.accuracy}%</strong>
                    </span>
                    <span className="session-stat bad">
                      Mistakes: <strong>{s.mistakes}</strong>
                    </span>
                    <span className="session-stat">
                      Duration: <strong>{Math.round((s.endedAt - s.startedAt) / 1000)}s</strong>
                    </span>
                    <span className="session-stat">
                      {new Date(s.endedAt).toLocaleTimeString()}
                    </span>
                  </div>
                  {s.selectedWords.length > 0 && (
                    <div style={{ marginTop: '6px', fontFamily: 'VT323', fontSize: '16px', color: 'var(--px-gray)' }}>
                      {s.selectedWords.map((w) => (
                        <span
                          key={w.id}
                          style={{ color: w.isCorrect ? 'var(--px-green)' : 'var(--px-red)', marginRight: '6px' }}
                        >
                          {w.word}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default App
