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
  sessionSeed: number
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

// 10 phonetic variants per word — 2 are randomly picked each game via sessionSeed
export const DEFAULT_CONFIG: PoemConfig = {
  title: 'Mouth Shore',
  poem: [
    'Welcome', 'to', 'shore', 'where', 'mouths',
    'arrive', 'in', 'waves', 'and', 'memory',
    'mishears', 'every', 'name',
  ],
  variants: {
    Welcome:  ['Willcome', 'Welcame', 'Welcum', 'Welkome', 'Wulcum', 'Willkum', 'Welcohm', 'Wellkum', 'Whelkum', 'Welcoom'],
    to:       ['too', 'tuw', 'toh', 'tue', 'twoo', 'tow', 'tu', 'toe', 'twu', 'tuu'],
    shore:    ['shoar', 'sure', 'shor', 'showr', 'shoor', 'shoer', 'shuhr', 'shohr', 'shure', 'shoore'],
    where:    ['wear', 'whare', 'wher', 'wheyr', 'whar', 'wehre', 'wayr', 'whear', 'wheyre', 'wherr'],
    mouths:   ['mowths', 'mouts', 'muthz', 'mowtz', 'mauths', 'mooths', 'mowz', 'muthes', 'moths', 'mouwths'],
    arrive:   ['arive', 'arryv', 'arriv', 'arryve', 'ahryve', 'arrivv', 'arryff', 'arivv', 'ariv', 'ahrriv'],
    in:       ['inn', 'en', 'enn', 'yn', 'inne', 'ihn', 'ehn', 'iinn', 'ine', 'een'],
    waves:    ['waives', 'weyvs', 'wavz', 'wayves', 'weyves', 'wavves', 'wayvz', 'weivz', 'waivz', 'waivves'],
    and:      ['annd', 'und', 'ande', 'ahnd', 'andde', 'ann', 'aund', 'aunnd', 'andd', 'aaand'],
    memory:   ['memoree', 'mimory', 'memree', 'memury', 'memmry', 'mimree', 'memery', 'memori', 'memmory', 'mimmory'],
    mishears: ['mishers', 'mishearz', 'misheerz', 'myssherz', 'misherz', 'mishurz', 'missherz', 'mysheerz', 'mishearze', 'misshearz'],
    every:    ['evry', 'ivory', 'everry', 'evree', 'ivree', 'evary', 'evury', 'evvry', 'ivery', 'evvery'],
    name:     ['naim', 'nayme', 'naem', 'naimm', 'nayem', 'namm', 'nayim', 'naihm', 'naemm', 'nameey'],
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
    sessionSeed: Math.trunc(Math.random() * 0xFFFFFFFF),
  }
}
