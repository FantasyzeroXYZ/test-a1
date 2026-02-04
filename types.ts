
export type Language = 'en' | 'zh' | 'zh-TW';

export type LearningLanguage = 'en' | 'zh' | 'ja' | 'es' | 'ru' | 'fr';

export type Theme = 'light' | 'dark';

export interface Pronunciation {
  text: string;
  type?: string;
  tags?: string[];
}

export interface Sense {
  definition: string;
  examples?: string[];
  subsenses?: Sense[];
  synonyms?: string[];
  antonyms?: string[];
}

export interface DictionaryEntry {
  language?: { code: string; name: string };
  partOfSpeech: string;
  pronunciations: Pronunciation[];
  senses: Sense[];
  tags?: string[]; // Added for Yomitan tags
}

export interface DictionaryResult {
  word: string;
  entries: DictionaryEntry[];
}

export type DictionaryResponse = DictionaryResult;

export interface SubtitleLine {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface Chapter {
  startTime: number;
  title: string;
}

export interface Bookmark {
  id: string;
  time: number;
  label: string;
  notes?: string;
  color?: string;
  createdAt: number;
}

export interface AudioTrack {
  id: string;
  title: string;
  filename?: string;
  url: string;
  category: 'music' | 'audiobook';
  file?: File;
  chapters?: Chapter[];
  coverBlob?: Blob;
  cover?: string;
  subtitles?: SubtitleLine[];
  subtitleFileName?: string;
  secondarySubtitles?: SubtitleLine[];
  secondarySubtitleFileName?: string;
  bookmarks?: Bookmark[];
  duration?: number;
  updatedAt?: number;
  language?: LearningLanguage; // Track specific language
}

export interface AnkiFieldMap {
  word: string;
  definition: string;
  sentence: string;
  translation: string;
  audio: string;
  examVocab: string;
}

export interface AnkiSettings {
  host: string;
  port: number;
  deckName: string;
  modelName: string;
  fieldMap: AnkiFieldMap;
  sentenceFieldMap?: Partial<AnkiFieldMap>; // Added for Sentence Mode specific mapping
  tags: string;
}

export type SubtitleMode = 'scroll' | 'single';
export type SegmentationMode = 'browser' | 'mecab' | 'none';
export type GameType = 'none' | 'cloze' | 'dictation';
export type PlaybackMode = 'normal' | 'pause-per-sentence';

export type WebSearchEngine = 'google' | 'baidu' | 'baidu_baike' | 'bing' | 'bing_trans' | 'deepl' | 'youdao_trans' | 'wikipedia' | 'moegirl';
export type WebLinkMode = 'inline' | 'external';

export type InputSource = 'keyboard' | 'gamepad';

export interface SceneKeybindings {
  library: Record<string, string>;
  player: Record<string, string>;
  dictionary: Record<string, string>;
}

export interface ReaderSettings {
  theme: Theme;
  language: Language;
  learningLanguage: LearningLanguage;
  subtitleMode: SubtitleMode;
  subtitleFontSize: number;
  segmentationMode: SegmentationMode;
  playbackMode: PlaybackMode;
  webSearchEngine: WebSearchEngine;
  webLinkMode: WebLinkMode;
  copyToClipboard: boolean;
  dictMode: 'word' | 'sentence'; // Controls initial search behavior
  ttsEnabled: boolean;
  ttsVoice: string;
  ttsRate: number;
  ttsPitch: number;
  ttsVolume: number;
  keybindings: SceneKeybindings;
  inputSource: InputSource; // Added for gamepad/keyboard switching
}
