
export type Language = 'en' | 'zh';

export type LearningLanguage = 'en' | 'zh' | 'ja' | 'es' | 'ru' | 'fr';

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

export interface AnkiSettings {
  host: string;
  port: number;
  deckName: string;
  modelName: string;
  fieldMap: {
    word: string;
    definition: string;
    sentence: string;
    translation: string;
    audio: string;
  };
  tags: string;
}

export type SubtitleMode = 'scroll' | 'single'; // 'scroll' (滚动列表) 或 'single' (仅当前行)
export type SegmentationMode = 'browser' | 'mecab' | 'none'; // 新增 'none'
export type GameType = 'none' | 'cloze' | 'dictation';
export type PlaybackMode = 'normal' | 'pause-per-sentence';

export type WebSearchEngine = 'google' | 'baidu' | 'baidu_baike' | 'bing';
export type DictionaryTab = 'dictionary' | 'web' | 'userscript';


export interface Chapter {
  title: string;
  startTime: number;
}

export interface Bookmark {
  id: string;
  time: number;
  label: string;
  notes?: string; // 新增笔记字段
  color?: string; // 新增颜色字段
  createdAt: number;
}

export interface AudioTrack {
  id: string;
  title: string;
  filename?: string;
  url: string;
  category: 'music' | 'audiobook';
  duration?: number;
  lastPosition?: number;
  file?: File;
  cover?: string;
  coverBlob?: Blob;
  chapters?: Chapter[];
  bookmarks?: Bookmark[];
  subtitles?: SubtitleLine[];
  subtitleFileName?: string;
  secondarySubtitles?: SubtitleLine[];
  secondarySubtitleFileName?: string;
}

export interface KeyBindings {
  playPause: string;
  rewind: string;
  forward: string;
  toggleSidebar: string;
  toggleSubtitleMode: string;
}
