export type PoemConfig = {
  title: string
  poem: string[]
  variants: Record<string, string[]>
}

export type SelectedWord = {
  id: number
  word: string
  source: string
  isCorrect: boolean
  createdAt: number
}

export type TranscriptState = {
  finalText: string
  finalWords: string[]
  interimText: string
  updatedAt: number | null
  active: boolean
}

export type SessionState = {
  config: PoemConfig
  selectedWords: SelectedWord[]
  transcript: TranscriptState
}

export type ClientMessage =
  | { type: 'pick_word'; payload: Omit<SelectedWord, 'id' | 'createdAt'> }
  | { type: 'update_config'; payload: PoemConfig }
  | { type: 'transcript_update'; payload: TranscriptState }
  | { type: 'reset_session' }

export type ServerMessage = {
  type: 'sync'
  payload: SessionState
}

export const DEFAULT_CONFIG: PoemConfig = {
  title: 'Mouth Shore',
  poem: [
    'Welcome',
    'to',
    'shore',
    'where',
    'mouths',
    'arrive',
    'in',
    'waves',
    'and',
    'memory',
    'mishears',
    'every',
    'name',
  ],
  variants: {
    Welcome:  ['Willcome', 'Welcame'],
    to:       ['too', 'tuw'],
    shore:    ['shoar', 'sure'],
    where:    ['wear', 'whare'],
    mouths:   ['mowths', 'mouts'],
    arrive:   ['arive', 'arryv'],
    in:       ['inn', 'en'],
    waves:    ['waives', 'weyvs'],
    and:      ['annd', 'und'],
    memory:   ['memoree', 'mimory'],
    mishears: ['mishers', 'mishearz'],
    every:    ['evry', 'ivory'],
    name:     ['naim', 'nayme'],
  },
}

export function createInitialSessionState(config: PoemConfig = DEFAULT_CONFIG): SessionState {
  return {
    config,
    selectedWords: [],
    transcript: {
      finalText: '',
      finalWords: [],
      interimText: '',
      updatedAt: null,
      active: false,
    },
  }
}
