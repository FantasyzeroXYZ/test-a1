
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { SUPPORTED_SUBTITLE_TYPES } from './constants';
import { SubtitleLine, Language, AudioTrack, Bookmark, SubtitleMode, ReaderSettings, GameType, AnkiSettings, LearningLanguage, SegmentationMode, PlaybackMode, WebSearchEngine, DictionaryResult, DictionaryEntry, SceneKeybindings } from './types';
import { getTranslation } from './utils/i18n';
import { parseChapters } from './utils/chapterUtils';
import { parseSRT, parseLRC, parseVTT, parseASS, formatTime } from './utils/parsers';
import { saveTrackToDB, getAllTracksFromDB, deleteTrackFromDB, updateTrackMetadataInDB, getDictionaries, batchSearchTerms } from './utils/storage';
import { detectAudioSegments } from './utils/audioSegmenter';
import * as AnkiService from './services/ankiService';
import { PlayerControls } from './components/PlayerControls';
import { SubtitleRenderer } from './components/SubtitleRenderer';
import DictionaryModal from './components/DictionaryModal';
import { Library } from './components/Library';
import { SidePanel } from './components/SidePanel';
import { SubtitleListPanel } from './components/SubtitleListPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { BookmarkModal } from './components/BookmarkModal';
import { VocabListModal } from './components/VocabListModal';
import { YomitanPopup, YomitanAnalysisResult } from './components/YomitanPopup';
import { TranslationPopup } from './components/TranslationPopup';
import { isNonSpacedLang, isWord } from './utils/textUtils';
import { deinflector, DeinflectionResult, parseTransforms } from './utils/deinflector';
// 引入日语处理工具和默认规则
import { normalizeCombiningCharacters, convertKatakanaToHiragana, isStringPartiallyJapanese, convertHalfWidthKanaToFullWidth } from './utils/japanese';
import { japaneseDeinflectionRules } from './utils/japaneseDeinflectionRules';
import { englishDeinflectionRules } from './utils/englishDeinflectionRules';
import { extractAudioClip } from './utils/audioUtils';
import { useGamepad } from './hooks/useGamepad';

const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'light',
  language: 'zh',
  learningLanguage: 'en',
  subtitleMode: 'scroll',
  subtitleFontSize: 20,
  segmentationMode: 'browser',
  playbackMode: 'normal',
  webSearchEngine: 'bing_trans',
  webLinkMode: 'inline',
  copyToClipboard: false,
  dictMode: 'word',
  dictExportMode: 'anki',
  ankiBoldWord: true,
  yomitanMode: false,
  yomitanModeType: 'comprehensive',
  autoCloseDictAfterAnki: false,
  enablePreprocessing: false,
  ttsEnabled: true,
  ttsVoice: '',
  ttsRate: 1,
  ttsPitch: 1,
  ttsVolume: 1,
  keybindings: { 
      library: { import: 'KeyI', settings: 'KeyS' }, 
      player: { 
          playPause: 'Space', rewind: 'ArrowLeft', forward: 'ArrowRight', sidebar: 'KeyL', dict: 'KeyD',
          toggleTranslation: 'KeyT', toggleYomitan: 'KeyY', toggleSentenceRepeat: 'KeyR', toggleABLoop: 'KeyA',
          scrollUp: 'ArrowUp', scrollDown: 'ArrowDown'
      }, 
      dictionary: { close: 'Escape', addAnki: 'KeyA', replay: 'KeyR', scrollUp: 'ArrowUp', scrollDown: 'ArrowDown' } 
  },
  inputSource: 'keyboard'
};

const formatContentPlain = (content: any, depth: number = 0): string => {
    if (content === null || content === undefined) return '';
    if (Array.isArray(content)) return content.map(child => formatContentPlain(child, depth)).join('');
    if (typeof content === 'string') return content;
    if (typeof content === 'object') {
        if (content.type === 'structured-content' && content.content) return formatContentPlain(content.content, depth);
        const tag = content.tag;
        const inner = formatContentPlain(content.content, depth + 1);
        if (tag === 'li') return `\n${'  '.repeat(depth)}- ${inner}`;
        if (tag === 'div' || tag === 'p') return `\n${inner}`;
        if (tag === 'br') return '\n';
        return inner;
    }
    return '';
};

const formatDefinitionForExport = (dictData: DictionaryResult): string => {
    if (!dictData.entries || dictData.entries.length === 0) return dictData.word;
    let text = "";
    dictData.entries.forEach((entry, idx) => {
        if (idx > 0) text += "\n\n";
        text += `[${entry.partOfSpeech}]\n`;
        entry.senses.forEach((s, sIdx) => {
            let defContent = s.definition;
            try {
                if (typeof defContent === 'string' && defContent.trim().startsWith('{') && defContent.includes('"type":"structured-content"')) {
                    const parsed = JSON.parse(defContent);
                    defContent = formatContentPlain(parsed);
                }
            } catch (e) {}
            text += `${sIdx + 1}. ${defContent}\n`;
        });
    });
    return text.trim();
};

const formatSingleEntryForExport = (word: string, entry: DictionaryEntry): string => {
    let text = `[${entry.partOfSpeech}]\n`;
    entry.senses.forEach((s, sIdx) => {
        let defContent = s.definition;
        try {
            if (typeof defContent === 'string' && defContent.trim().startsWith('{') && defContent.includes('"type":"structured-content"')) {
                const parsed = JSON.parse(defContent);
                defContent = formatContentPlain(parsed);
            }
        } catch (e) {}
        text += `${sIdx + 1}. ${defContent}\n`;
    });
    return text.trim();
};

import Hls from 'hls.js';

const App: React.FC = () => {
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    const stored = localStorage.getItem('lf_settings_v5');
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
  });
  const [ankiSettings, setAnkiSettings] = useState<AnkiSettings>(() => {
    const stored = localStorage.getItem('lf_anki');
    return stored ? JSON.parse(stored) : { host: '127.0.0.1', port: 8765, deckName: 'Default', modelName: 'Basic', fieldMap: { word: 'Front', definition: 'Back', sentence: '', translation: '', audio: '', examVocab: '备注', image: 'Image' }, tags: 'linguaflow' };
  });

  const [view, setView] = useState<'library' | 'player'>('library');
  const t = getTranslation(settings.language);

  const [showSettings, setShowSettings] = useState(false);
  const [showVocabTable, setShowVocabTable] = useState(false);
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [showSubtitleList, setShowSubtitleList] = useState(false);
  const [showBookmarkModal, setShowBookmarkModal] = useState(false);
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  const [isImporting, setIsImporting] = useState(false); 

  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]); 
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<SubtitleLine[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1); 
  const [activeSubtitleIndex, setActiveSubtitleIndex] = useState<number>(-1);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [isSentenceRepeat, setIsSentenceRepeat] = useState(false);

  const dictAddAnkiRef = useRef<(() => void) | null>(null);
  const dictScrollRef = useRef<((direction: 'up' | 'down') => void) | null>(null);
  const yomitanScrollRef = useRef<((direction: 'up' | 'down') => void) | null>(null);
  const transAddAnkiRef = useRef<(() => void) | null>(null);
  const transScrollRef = useRef<((direction: 'up' | 'down') => void) | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const wasPlayingRef = useRef(false);
  const [hasDictionaries, setHasDictionaries] = useState(false);

  const [dictionaryModalState, setDictionaryModalState] = useState<{
    isOpen: boolean;
    initialWord: string;
    initialSegmentIndex: number;
    sentence: string;
    contextLine: SubtitleLine | null;
  }>({
    isOpen: false,
    initialWord: '',
    initialSegmentIndex: -1,
    sentence: '',
    contextLine: null,
  });

  const [yomitanPopup, setYomitanPopup] = useState<{
    visible: boolean;
    x: number;
    y: number;
    results: YomitanAnalysisResult[];
    activeSegmentIndex: number;
    highlight: { lineId: string; start: number; length: number };
    pinned?: boolean;
  } | null>(null);

  const [translationPopup, setTranslationPopup] = useState<{
    visible: boolean;
    x: number;
    y: number;
    sentence: string;
  } | null>(null);

  const [seenWords, setSeenWords] = useState(new Set<string>());
  const searchCache = useRef<Map<string, DictionaryResult[]>>(new Map());

  // Persist Settings
  useEffect(() => {
    localStorage.setItem('lf_settings_v5', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('lf_anki', JSON.stringify(ankiSettings));
  }, [ankiSettings]);

  // Dark Mode Effect
  useEffect(() => {
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [settings.theme]);

  useEffect(() => {
      // Load default rules first
      deinflector.load('ja', japaneseDeinflectionRules);
      deinflector.load('en', englishDeinflectionRules);

      // Load user-provided custom rules, which may override defaults
      const savedTransforms = localStorage.getItem('lf_transforms');
      if (savedTransforms) {
          const parsed = parseTransforms(savedTransforms);
          if (parsed) deinflector.load(parsed.language, parsed);
      }
      
      getDictionaries().then(dicts => setHasDictionaries(dicts.length > 0));
  }, []);

  const scope = useMemo(() => {
      const track = audioTracks.find(t => t.id === currentTrackId);
      return track?.language || settings.learningLanguage;
  }, [audioTracks, currentTrackId, settings.learningLanguage]);

  const [pendingStartTime, setPendingStartTime] = useState<number | null>(null);

  useEffect(() => { getAllTracksFromDB().then(setAudioTracks); }, []);
  const safePause = useCallback(() => { 
      audioRef.current?.pause(); 
      setIsPlaying(false); 
  }, []);

  const handleBackToLibrary = useCallback(() => {
      safePause();
      if (currentTrackId && audioRef.current) {
          const time = audioRef.current.currentTime;
          updateTrackMetadataInDB(currentTrackId, { currentTime: time });
          setAudioTracks(prev => prev.map(t => t.id === currentTrackId ? { ...t, currentTime: time } : t));
      }
      setView('library');
      setPendingStartTime(null);
  }, [currentTrackId, safePause]);

  const safePlay = useCallback(async () => { 
      try { 
          await audioRef.current?.play(); 
          setIsPlaying(true); 
      } catch (e: any) {
          console.error("Playback failed", e);
          if (e.name === 'NotAllowedError') {
              showToast("Playback blocked. Please interact with the page first.", 'error');
          }
      } 
  }, []);

  // HLS Support
  useEffect(() => {
      const audio = audioRef.current;
      if (!audio || !audioSrc) return;

      let hls: Hls | null = null;

      if (audioSrc.includes('.m3u8') || (audioSrc.startsWith('blob:') === false && audioSrc.includes('m3u8'))) {
          if (Hls.isSupported()) {
              hls = new Hls();
              hls.loadSource(audioSrc);
              hls.attachMedia(audio);
              hls.on(Hls.Events.MANIFEST_PARSED, () => {
                  if (pendingStartTime !== null) {
                      audio.currentTime = pendingStartTime;
                  }
                  // Optional: auto play
                  // safePlay();
              });
          } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
              audio.src = audioSrc;
              // Native HLS support (Safari)
          }
      } else {
          // Normal playback
          // If previously HLS was attached, we might need cleanup, but React handles src change usually.
          // However, hls.js recommends detaching.
      }

      return () => {
          if (hls) {
              hls.destroy();
          }
      };
  }, [audioSrc]);

  // Handle pending start time when metadata loaded
  const onLoadedMetadata = (e: React.SyntheticEvent<HTMLAudioElement>) => {
      setDuration(e.currentTarget.duration);
      if (pendingStartTime !== null) {
          e.currentTarget.currentTime = pendingStartTime;
          setCurrentTime(pendingStartTime);
          setPendingStartTime(null);
      }
  };

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
      setNotification({ message, type });
      setTimeout(() => setNotification(null), 3000);
  };

  const pauseForLookup = () => {
    if (!audioRef.current) {
        wasPlayingRef.current = false;
        return;
    }
    
    // Read the "playing" state directly from the audio element to avoid state sync issues.
    const wasPlaying = !audioRef.current.paused;
    wasPlayingRef.current = wasPlaying;

    if (wasPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
    }
  };

  const resumeAfterLookup = () => {
      if (wasPlayingRef.current) {
          safePlay();
      }
      wasPlayingRef.current = false;
  };

  const handleTimeUpdate = () => {
      const audio = audioRef.current;
      if (!audio) return;
      
      const time = audio.currentTime;
      setCurrentTime(time);

      if (loopA !== null && loopB !== null) {
          if (time >= loopB) {
              audio.currentTime = loopA;
              return; 
          }
      }

      if (isSentenceRepeat && activeSubtitleIndex !== -1) {
          const sub = subtitles[activeSubtitleIndex];
          if (sub && time >= sub.end) {
              audio.currentTime = sub.start + 0.01;
              if (!isPlaying) safePlay();
          }
      }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>, category: 'music' | 'audiobook') => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsImporting(true);
    try {
        const { chapters, coverBlob } = await parseChapters(file);
        const id = crypto.randomUUID();
        const newTrack: AudioTrack = { id, title: file.name.replace(/\.[^/.]+$/, ''), filename: file.name, url: URL.createObjectURL(file), category, chapters, coverBlob, cover: coverBlob ? URL.createObjectURL(coverBlob) : undefined, updatedAt: Date.now(), file };
        await saveTrackToDB(newTrack, file);
        setAudioTracks(prev => [...prev, newTrack]);
    } catch (err) { alert(t.importFailed); } 
    finally { 
        // Small timeout to ensure Library detects the change while isImporting is true
        setTimeout(() => setIsImporting(false), 500);
        e.target.value = ''; 
    }
  };

  const handleImportLink = async (url: string, category: 'music' | 'audiobook') => {
      try {
          const id = crypto.randomUUID();
          let title = url.split('/').pop()?.split('?')[0] || 'Unknown Stream';
          title = title.replace(/\.[^/.]+$/, ""); // Remove extension
          
          const newTrack: AudioTrack = { 
              id, 
              title, 
              url, 
              category, 
              chapters: [], 
              updatedAt: Date.now() 
          };
          
          await saveTrackToDB(newTrack);
          setAudioTracks(prev => [...prev, newTrack]);
          showToast(t.importSuccess);
          return newTrack;
      } catch (err) {
          console.error(err);
          showToast(t.importFailed, 'error');
          return null;
      }
  };

  const handleImportSubtitle = async (trackId: string, file: File, isSecondary: boolean) => {
    try {
        const content = await file.text();
        let parsedSubs: SubtitleLine[] = [];
        const ext = file.name.split('.').pop()?.toLowerCase();

        if (ext === 'srt') {
            parsedSubs = parseSRT(content);
        } else if (ext === 'lrc') {
            parsedSubs = parseLRC(content);
        } else if (ext === 'vtt') {
            parsedSubs = parseVTT(content);
        } else if (ext === 'ass') {
            parsedSubs = parseASS(content);
        } else {
            parsedSubs = parseSRT(content);
            if (parsedSubs.length === 0) parsedSubs = parseLRC(content);
        }

        if (parsedSubs.length === 0) {
            alert(t.subtitleParseError);
            return;
        }

        const updates: Partial<AudioTrack> = isSecondary
            ? { secondarySubtitles: parsedSubs, secondarySubtitleFileName: file.name }
            : { subtitles: parsedSubs, subtitleFileName: file.name };

        setAudioTracks(prev => prev.map(t => t.id === trackId ? { ...t, ...updates } : t));
        await updateTrackMetadataInDB(trackId, updates);
        
        if (currentTrackId === trackId && !isSecondary) {
            setSubtitles(parsedSubs);
        }
        alert(t.subtitleImportSuccess.replace('{filename}', file.name));
    } catch (err) {
        alert(t.importFailed);
    }
  };

  const handleDeleteBookmark = async (id: string) => {
      if (!currentTrackId) return;
      const track = audioTracks.find(t => t.id === currentTrackId);
      if (!track || !track.bookmarks) return;
      
      const newBookmarks = track.bookmarks.filter(b => b.id !== id);
      const updates = { bookmarks: newBookmarks };
      
      setAudioTracks(prev => prev.map(t => t.id === currentTrackId ? { ...t, ...updates } : t));
      await updateTrackMetadataInDB(currentTrackId, updates);
  };

  const performYomitanAnalysis = useCallback(async (event: React.MouseEvent, line: SubtitleLine, triggerIndex: number) => {
    // Explicitly use the memoized scope which prioritizes track language
    const learningLang = scope;
    const analysisResults: YomitanAnalysisResult[] = [];
    
    const scanSegments: { term: string, start: number }[] = [];
    if (learningLang === 'en') {
        const text = line.text;
        let start = triggerIndex;
        while (start > 0 && /\S/.test(text[start - 1])) {
            start--;
        }
        let end = triggerIndex;
        while (end < text.length - 1 && /\S/.test(text[end + 1])) {
            end++;
        }
        const raw = text.substring(start, end + 1).replace(/[.,!?;:"'()]+$/, '');
        if (raw) {
            scanSegments.push({ term: raw, start: start });
        }
    } else { // Japanese, Chinese, etc.
        const chars = Array.from(line.text);
        const suffix = chars.slice(triggerIndex).join('');
        const maxScanLen = 10;
        for (let len = Math.min(suffix.length, maxScanLen); len >= 1; len--) {
            scanSegments.push({ term: suffix.substring(0, len), start: triggerIndex });
        }
    }

    if (scanSegments.length === 0) {
        setYomitanPopup(null);
        return;
    }

    pauseForLookup(); 

    // Collect all terms to search across all segments to batch them
    const allTermsToSearch = new Set<string>();
    const segmentData = scanSegments.map(segment => {
        const raw = segment.term;
        const terms = new Set<string>();
        const deinflections: DeinflectionResult[] = [];
        
        terms.add(raw);
        let hiragana = '';

        if (learningLang === 'ja') {
            const fullWidth = convertHalfWidthKanaToFullWidth(raw);
            const normalized = normalizeCombiningCharacters(fullWidth);
            terms.add(fullWidth);
            terms.add(normalized);
            
            if (settings.enablePreprocessing || isStringPartiallyJapanese(raw)) {
                hiragana = convertKatakanaToHiragana(normalized);
                terms.add(hiragana);

                // Treat raw/hiragana as reading and deinflect it
                const deinflectionResults = deinflector.deinflect(hiragana, 'ja');
                deinflections.push(...deinflectionResults);
                deinflectionResults.forEach(d => {
                    terms.add(d.term);
                    const deinflectedReading = convertKatakanaToHiragana(d.term);
                    if (deinflectedReading !== d.term) terms.add(deinflectedReading);
                });

                // Add raw as a potential reading search term
                terms.add(raw);
                if (hiragana !== raw) terms.add(hiragana);
            }
        } else if (learningLang === 'en') {
            terms.add(raw.toLowerCase());
            if (settings.enablePreprocessing) {
                const deinflectionResults = deinflector.deinflect(raw.toLowerCase(), 'en');
                deinflections.push(...deinflectionResults);
                deinflectionResults.forEach(d => terms.add(d.term));
            }
        }
        
        terms.forEach(t => allTermsToSearch.add(t));
        return { raw, terms, deinflections, hiragana, start: segment.start };
    });

    // Check cache first
    const missingTerms = Array.from(allTermsToSearch).filter(t => !searchCache.current.has(t));
    if (missingTerms.length > 0) {
        const batchResults = await batchSearchTerms(missingTerms, scope);
        // Map results back to the terms that might have found them
        missingTerms.forEach(term => {
            const termHira = convertKatakanaToHiragana(term);
            const matches = batchResults.filter(r => 
                r.word === term || 
                r.word === termHira ||
                r.entries.some(e => e.pronunciations.some(p => p.text === term || p.text === termHira))
            );
            searchCache.current.set(term, matches);
        });
    }

    for (const data of segmentData) {
        const { raw, terms, deinflections, hiragana } = data;
        const foundWords: YomitanAnalysisResult['foundWords'] = [];
        
        // Get results from cache
        const searchResults: DictionaryResult[] = [];
        terms.forEach(t => {
            const cached = searchCache.current.get(t);
            if (cached) searchResults.push(...cached);
        });

        if (searchResults.length > 0) {
            for (const res of searchResults) {
                // ... same matching logic as before ...
                if (learningLang === 'ja') {
                    if (raw === res.word || normalizeCombiningCharacters(raw) === res.word || hiragana === res.word) {
                        foundWords.push({ result: res, source: 'direct' });
                    } else {
                        const deinflectedHeadwordMatch = deinflections.find(d => d.term === res.word || convertKatakanaToHiragana(d.term) === res.word);
                        if (deinflectedHeadwordMatch) {
                            foundWords.push({ result: res, source: 'deinflected', reason: deinflectedHeadwordMatch.reasons.join(' ← ') });
                        } else {
                            const originalReadingMatch = hiragana && res.entries.some(e => e.pronunciations.some(p => p.text === hiragana));
                            const deinflectedReadingMatch = deinflections.find(d => {
                                const termHira = convertKatakanaToHiragana(d.term);
                                return res.entries.some(e => e.pronunciations.some(p => p.text === d.term || p.text === termHira));
                            });

                            // Also check if the raw/hiragana itself matches a reading in the dictionary
                            const rawReadingMatch = res.entries.some(e => e.pronunciations.some(p => p.text === raw || p.text === hiragana));
                            
                            // Check if any deinflected term matches a reading in the dictionary
                            const deinflectedTermAsReadingMatch = deinflections.find(d => {
                                const termHira = convertKatakanaToHiragana(d.term);
                                return res.entries.some(e => e.pronunciations.some(p => p.text === d.term || p.text === termHira));
                            });

                            if (originalReadingMatch || rawReadingMatch) {
                                foundWords.push({ result: res, source: 'reading' });
                            } else if (deinflectedReadingMatch || deinflectedTermAsReadingMatch) {
                                foundWords.push({ result: res, source: 'deinflected', secondarySource: 'reading', reason: (deinflectedReadingMatch || deinflectedTermAsReadingMatch)?.reasons.join(' ← ') });
                            }
                        }
                    }
                } else if (learningLang === 'en') {
                    if (res.word.toLowerCase() === raw.toLowerCase()) {
                        foundWords.push({ result: res, source: 'direct' });
                    } else {
                        const match = deinflections.find(d => d.term === res.word);
                        if (match) {
                           const newResult: DictionaryResult = {
                               ...res,
                               entries: res.entries.map(entry => ({
                                   ...entry,
                                   tags: [...new Set([...(entry.tags || []), ...match.tags])]
                               }))
                           };
                           foundWords.push({ result: newResult, source: 'deinflected', reason: match.reasons.join(' ← ') });
                        }
                    }
                } else { 
                    if (res.word === raw) {
                        foundWords.push({ result: res, source: 'direct' });
                    }
                }
            }
        }

        if (foundWords.length > 0) {
            analysisResults.push({
                segment: raw,
                length: raw.length,
                foundWords: [...new Map(foundWords.map(item => [item.result.word, item])).values()]
            });
            if (settings.yomitanModeType === 'fast' && learningLang !== 'en') {
                break;
            }
        }
    }

    if (analysisResults.length > 0) {
        const firstResult = analysisResults[0];
        setYomitanPopup({
            visible: true, x: event.clientX, y: event.clientY,
            results: analysisResults,
            activeSegmentIndex: 0,
            highlight: { lineId: line.id, start: scanSegments[0].start, length: firstResult.length },
            pinned: true,
        });
        if (firstResult.foundWords.length > 0) {
            setSeenWords(prev => new Set(prev).add(firstResult.foundWords[0].result.word));
        }
    } else {
        setYomitanPopup(null);
        resumeAfterLookup(); 
    }
  }, [scope, settings.enablePreprocessing, settings.yomitanModeType, isPlaying]);

  const handleWordClick = (word: string, line: SubtitleLine, index: number) => {
      if (settings.yomitanMode || !isWord(word)) return;
      pauseForLookup();
      setDictionaryModalState({
          isOpen: true,
          initialWord: word,
          initialSegmentIndex: index,
          sentence: line.text,
          contextLine: line,
      });
  };

  const handleSentenceClick = (line: SubtitleLine) => {
      if (settings.yomitanMode) return;
      pauseForLookup();
      setDictionaryModalState({
          isOpen: true,
          initialWord: line.text,
          initialSegmentIndex: 0,
          sentence: line.text,
          contextLine: line,
      });
  };
  
  const handleYomitanHover = useCallback((e: React.MouseEvent, char: string, line: SubtitleLine, idx: number) => {
      return;
  }, []);

  const handleYomitanClick = useCallback((e: React.MouseEvent, char: string, line: SubtitleLine, idx: number) => {
      performYomitanAnalysis(e, line, idx);
  }, [performYomitanAnalysis]);
  
  const handleTranslateClick = (event: React.MouseEvent, line: SubtitleLine) => {
      pauseForLookup();
      setTranslationPopup({
          visible: true,
          x: event.clientX,
          y: event.clientY,
          sentence: line.text,
      });
  };

  const handleAddSentenceCard = async (sentence: string) => {
      try {
          const currentTrack = audioTracks.find(t => t.id === currentTrackId);
          let audioBase64: string | undefined = undefined;
          
          // Find the line corresponding to this sentence to extract audio
          const line = subtitles.find(s => s.text === sentence);
          if (line && currentTrack?.file && ankiSettings.fieldMap.audio) {
              audioBase64 = await extractAudioClip(currentTrack.file, line.start, line.end);
          }

          // Use sentence field map if available, otherwise fallback to default
          let map = { ...ankiSettings.fieldMap };
          if (ankiSettings.sentenceFieldMap && Object.keys(ankiSettings.sentenceFieldMap).length > 0) {
              map = { ...map, ...ankiSettings.sentenceFieldMap };
          }
          
          await AnkiService.addNote({ 
              ...ankiSettings, 
              deckName: ankiSettings.sentenceDeckName || ankiSettings.deckName,
              modelName: ankiSettings.sentenceModelName || ankiSettings.modelName,
              fieldMap: map as any 
          }, { 
              word: sentence, // In sentence mode, the "word" is the sentence
              definition: '', 
              sentence: sentence, 
              translation: '', 
              audioBase64, 
              examVocab: '' 
          });
          
          showToast(t.ankiSuccess);
      } catch (e) { 
          console.error("Anki error:", e);
          showToast(t.ankiError, 'error'); 
      }
      setTranslationPopup(null);
      resumeAfterLookup();
  };

  const handleAddCard = async (result: DictionaryResult, entry?: DictionaryEntry) => {
      const definition = entry ? formatSingleEntryForExport(result.word, entry) : formatDefinitionForExport(result);
      const word = result.word;
      const reading = entry?.pronunciations?.[0]?.text || result.entries[0]?.pronunciations?.[0]?.text || '';
      const allTags = new Set<string>();
      
      const entriesToScan = entry ? [entry] : result.entries;
      entriesToScan.forEach(e => e.tags?.forEach(t => allTags.add(t)));
      
      const line = yomitanPopup?.highlight ? subtitles.find(s => s.id === yomitanPopup.highlight!.lineId) : null;
      let sent = line?.text || "";
      
      if (settings.ankiBoldWord && line && yomitanPopup?.highlight) {
           const { start, length } = yomitanPopup.highlight;
           // Ensure indices are within bounds
           if (start >= 0 && start + length <= sent.length) {
               const prefix = sent.substring(0, start);
               const target = sent.substring(start, start + length);
               const suffix = sent.substring(start + length);
               sent = `${prefix}<b>${target}</b>${suffix}`;
           } else {
               // Fallback to replace if indices are off (e.g. deinflection mismatch)
               sent = sent.replace(word, `<b>${word}</b>`);
           }
      } else if (settings.ankiBoldWord) {
           sent = sent.replace(word, `<b>${word}</b>`);
      }

      if (settings.dictExportMode === 'table') {
          const raw = localStorage.getItem('lf_vocab_table');
          const table = raw ? JSON.parse(raw) : [];
          table.push({ id: crypto.randomUUID(), word, definition, sentence: sent, translation: '', tags: Array.from(allTags).join(' '), sourceTitle: audioTracks.find(t => t.id === currentTrackId)?.title || t.unknownSource, timeRange: line ? `${formatTime(line.start)}` : "0:00", addedAt: Date.now() });
          localStorage.setItem('lf_vocab_table', JSON.stringify(table));
          showToast(t.addedToTable);
      } else {
          try {
              const currentTrack = audioTracks.find(t => t.id === currentTrackId);
              let audioBase64: string | undefined = undefined;

              if (line && currentTrack?.file && ankiSettings.fieldMap.audio) {
                  audioBase64 = await extractAudioClip(currentTrack.file, line.start, line.end);
              }

              let map = { ...ankiSettings.fieldMap };
              if (settings.dictMode === 'sentence' && ankiSettings.sentenceFieldMap) map = { ...map, ...ankiSettings.sentenceFieldMap };
              
              await AnkiService.addNote({ ...ankiSettings, fieldMap: map as any }, { word, reading, definition, sentence: sent, translation: '', audioBase64, examVocab: Array.from(allTags).join(' ') });
              
              showToast(t.ankiSuccess);
          } catch (e) { 
              console.error("Anki error:", e);
              showToast(t.ankiError, 'error'); 
          }
      }
      setYomitanPopup(p => p ? {...p, pinned: false } : null); // Unpin after adding
      
      if (settings.autoCloseDictAfterAnki) {
          setYomitanPopup(null);
          setDictionaryModalState(prev => ({ ...prev, isOpen: false }));
          resumeAfterLookup();
      }
  };

  const handleAddAllCardsInTab = async (results: DictionaryResult[]) => {
    for (const result of results) {
        await handleAddCard(result);
    }
  };
  
  const handleRewind = () => {
    if (!audioRef.current) return;
    const current = audioRef.current.currentTime;
    
    if (subtitles.length === 0) {
        const target = Math.max(0, current - 10);
        audioRef.current.currentTime = target;
        setCurrentTime(target);
        return;
    }
    
    const currentIndex = subtitles.findIndex(s => current >= s.start && current <= s.end);
    let targetIndex;

    if (currentIndex !== -1) {
        const currentSub = subtitles[currentIndex];
        if (current - currentSub.start > 1) {
            audioRef.current.currentTime = currentSub.start;
            setCurrentTime(currentSub.start);
            return;
        }
        targetIndex = Math.max(0, currentIndex - 1);
    } else {
        targetIndex = subtitles.findIndex(s => s.start > current) - 1;
        if (targetIndex < 0) targetIndex = 0;
    }

    const targetSub = subtitles[targetIndex];
    if (targetSub) {
        audioRef.current.currentTime = targetSub.start;
        setCurrentTime(targetSub.start);
    }
  };

  const handleForward = () => {
    if (!audioRef.current) return;
    const current = audioRef.current.currentTime;
    
    if (subtitles.length === 0) {
        const target = Math.min(duration, current + 10);
        audioRef.current.currentTime = target;
        setCurrentTime(target);
        return;
    }
    
    const currentIndex = subtitles.findIndex(s => current >= s.start && current <= s.end);
    let targetIndex;

    if (currentIndex === -1) {
        targetIndex = subtitles.findIndex(s => s.start > current);
    } else {
        targetIndex = currentIndex + 1;
    }

    if (targetIndex !== -1 && targetIndex < subtitles.length) {
        const targetSub = subtitles[targetIndex];
        if (audioRef.current) {
            audioRef.current.currentTime = targetSub.start;
            setCurrentTime(targetSub.start);
            // If paused, we might need to force an update or just rely on state
        }
    }
  };

  const handleABLoopToggle = () => {
      const current = currentTime;
      if (loopA === null) {
          setLoopA(current);
      } else if (loopB === null) {
          if (current > loopA) {
              setLoopB(current);
              if (audioRef.current) audioRef.current.currentTime = loopA;
          } else {
              setLoopA(current);
          }
      } else {
          setLoopA(null);
          setLoopB(null);
      }
  };

  const handleRateChange = (rate: number) => {
      setPlaybackRate(rate);
      if (audioRef.current) audioRef.current.playbackRate = rate;
  };

  const handleSaveBookmark = (bm: Bookmark) => {
      if (!currentTrackId) return;
      const track = audioTracks.find(t => t.id === currentTrackId);
      if (!track) return;
      
      const newBookmarks = [...(track.bookmarks || [])];
      const bookmarkToSave = { ...bm, id: bm.id || crypto.randomUUID() };
      
      const existingIdx = newBookmarks.findIndex(b => b.id === bookmarkToSave.id);
      if (existingIdx !== -1) {
          newBookmarks[existingIdx] = bookmarkToSave;
      } else {
          newBookmarks.push(bookmarkToSave);
      }
      
      const updates = { bookmarks: newBookmarks };
      setAudioTracks(prev => prev.map(t => t.id === currentTrackId ? { ...t, ...updates } : t));
      updateTrackMetadataInDB(currentTrackId, updates);
      setShowBookmarkModal(false);
  };

  useEffect(() => {
      if (subtitles.length === 0) return;
      const idx = subtitles.findIndex(s => currentTime >= s.start && currentTime <= s.end);
      if (idx !== activeSubtitleIndex) setActiveSubtitleIndex(idx);
  }, [currentTime, subtitles, activeSubtitleIndex]);

  useEffect(() => {
      if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate, audioSrc]); 

  const handleInput = useCallback((code: string, source: 'keyboard' | 'gamepad') => {
      // Determine scene
      let scene: keyof SceneKeybindings = 'library';
      if (view === 'player') {
          if (dictionaryModalState.isOpen || yomitanPopup?.visible || translationPopup?.visible) {
              scene = 'dictionary';
          } else {
              scene = 'player';
          }
      }

      const bindings = settings.keybindings[scene];
      if (!bindings) return false;

      const action = Object.entries(bindings).find(([_, boundCode]) => boundCode === code)?.[0];
      if (!action) return false;

      switch (action) {
          case 'playPause': isPlaying ? safePause() : safePlay(); break;
          case 'rewind': handleRewind(); break;
          case 'forward': handleForward(); break;
          case 'sidebar': setShowSidePanel(prev => !prev); break;
          case 'dict': 
              if (settings.yomitanMode) break;
              if (dictionaryModalState.isOpen) {
                  setDictionaryModalState(prev => ({ ...prev, isOpen: false }));
                  resumeAfterLookup();
              } else {
                  const currentSub = activeSubtitleIndex !== -1 ? subtitles[activeSubtitleIndex] : null;
                  setDictionaryModalState({
                      isOpen: true,
                      initialWord: '',
                      initialSegmentIndex: -1,
                      sentence: currentSub ? currentSub.text : '',
                      contextLine: currentSub || { id: '0', start: 0, end: 0, text: '' }
                  });
                  pauseForLookup();
              }
              break;
          case 'toggleTranslation':
              if (translationPopup?.visible) {
                  setTranslationPopup(null);
                  resumeAfterLookup();
              } else if (activeSubtitleIndex !== -1 && subtitles[activeSubtitleIndex]) {
                  setTranslationPopup({
                      visible: true,
                      x: window.innerWidth / 2,
                      y: window.innerHeight / 2,
                      sentence: subtitles[activeSubtitleIndex].text
                  });
                  pauseForLookup();
              }
              break;
          case 'toggleYomitan':
              setSettings(s => ({ ...s, yomitanMode: !s.yomitanMode }));
              showToast(!settings.yomitanMode ? t.yomitanModeEnabled : t.yomitanModeDisabled);
              break;
          case 'toggleSentenceRepeat':
              setIsSentenceRepeat(prev => !prev);
              showToast(!isSentenceRepeat ? t.sentenceRepeatEnabled : t.sentenceRepeatDisabled);
              break;
          case 'toggleABLoop':
              handleABLoopToggle();
              break;
          case 'import': 
              if (view === 'library') {
                 // Trigger import logic if possible, or show help
              }
              break;
          case 'settings': setShowSettings(prev => !prev); break;
          case 'close': 
              setDictionaryModalState(prev => ({...prev, isOpen: false}));
              setYomitanPopup(null);
              setTranslationPopup(null);
              resumeAfterLookup();
              break;
          case 'addAnki':
               if (dictionaryModalState.isOpen && dictAddAnkiRef.current) {
                   dictAddAnkiRef.current();
               } else if (translationPopup?.visible && transAddAnkiRef.current) {
                   transAddAnkiRef.current();
               }
               break;
          case 'scrollUp':
               if (dictionaryModalState.isOpen && dictScrollRef.current) {
                   dictScrollRef.current('up');
               } else if (yomitanPopup?.visible && yomitanScrollRef.current) {
                   yomitanScrollRef.current('up');
               } else if (translationPopup?.visible && transScrollRef.current) {
                   transScrollRef.current('up');
               }
               break;
          case 'scrollDown':
               if (dictionaryModalState.isOpen && dictScrollRef.current) {
                   dictScrollRef.current('down');
               } else if (yomitanPopup?.visible && yomitanScrollRef.current) {
                   yomitanScrollRef.current('down');
               } else if (translationPopup?.visible && transScrollRef.current) {
                   transScrollRef.current('down');
               }
               break;
          case 'replay':
               if (audioRef.current) audioRef.current.currentTime = subtitles[activeSubtitleIndex]?.start || 0;
               break;
      }
      return true;
  }, [view, dictionaryModalState.isOpen, yomitanPopup, translationPopup, settings, isPlaying, safePause, safePlay, handleRewind, handleForward, subtitles, activeSubtitleIndex, isSentenceRepeat, handleABLoopToggle, t]);

  useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
          if (settings.inputSource === 'keyboard') {
              if (handleInput(e.code, 'keyboard')) {
                  e.preventDefault();
              }
          }
          if (e.code === 'Escape') {
              if (showSettings) setShowSettings(false);
              if (showVocabTable) setShowVocabTable(false);
          }
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleInput, settings.inputSource, showSettings, showVocabTable]);

  useGamepad((buttonIndex) => {
      if (settings.inputSource === 'gamepad') {
          handleInput(`Button${buttonIndex}`, 'gamepad');
      }
  });

  const ttsSettings = { enabled: settings.ttsEnabled, rate: settings.ttsRate, pitch: settings.ttsPitch, volume: settings.ttsVolume, voice: settings.ttsVoice };

  return (
    <div className="fixed inset-0 h-[100dvh] w-full bg-gray-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 flex flex-col overflow-hidden transition-colors duration-300">
      <audio 
        ref={audioRef} 
        src={audioSrc || undefined} 
        onTimeUpdate={handleTimeUpdate} 
        onLoadedMetadata={onLoadedMetadata} 
        className="hidden" 
      />
      <header className="flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-800 border-b h-16 shrink-0 z-50">
         <div className="flex items-center gap-4">
            <button onClick={handleBackToLibrary} className="w-8 h-8 bg-indigo-600 text-white rounded-lg flex items-center justify-center transition-colors"><i className="fa-solid fa-chevron-left text-sm"></i></button>
            {view === 'player' && audioTracks.find(t => t.id === currentTrackId)?.cover && (
                <img 
                   src={audioTracks.find(t => t.id === currentTrackId)?.cover} 
                   className="w-10 h-10 rounded-lg object-cover shadow-sm border border-gray-200 dark:border-slate-700" 
                   alt="" 
                />
            )}
            <h1 className="font-bold text-sm truncate max-w-[150px]">{view === 'player' ? audioTracks.find(t=>t.id===currentTrackId)?.title : t.appTitle}</h1>
         </div>
         <div className="flex items-center gap-2">
            {/* Added Subtitle List Button Top Right */}
            {view === 'player' && (
                <button onClick={() => setShowSubtitleList(true)} className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white transition-colors" title="Subtitle List">
                    <i className="fa-solid fa-list-ul"></i>
                </button>
            )}
            <button onClick={() => setShowVocabTable(true)} className="p-2 text-emerald-500 hover:text-emerald-600 transition-colors"><i className="fa-solid fa-table"></i></button>
            <button onClick={() => setShowSettings(true)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors"><i className="fa-solid fa-cog"></i></button>
         </div>
      </header>
      <div className="flex-1 overflow-hidden relative">
         {view === 'library' ? (
           <Library tracks={audioTracks} onTrackSelect={track => { 
               setCurrentTrackId(track.id); 
               setAudioSrc(track.url); 
               setSubtitles(track.subtitles || []); 
               
               // Use pendingStartTime to ensure it's set after metadata loads
               const t = track.currentTime || 0; 
               setPendingStartTime(t);
               setCurrentTime(t); 
               
               setView('player'); 
               setTimeout(safePlay, 100); 
           }} language={settings.language} onTrackDelete={async id => { await deleteTrackFromDB(id); setAudioTracks(prev => prev.filter(t => t.id !== id)); }} onTrackUpdate={(id, up) => { setAudioTracks(prev => prev.map(t => t.id === id ? {...t, ...up} : t)); updateTrackMetadataInDB(id, up); }} onImport={handleImport} onReplaceFile={()=>{}} onImportLink={handleImportLink} onImportSubtitle={handleImportSubtitle} isImporting={isImporting} />
         ) : (
           <div className="flex-1 flex flex-col h-full relative">
              <SubtitleRenderer subtitles={subtitles} activeSubtitleIndex={activeSubtitleIndex} onSeek={t => { if(audioRef.current) { audioRef.current.currentTime=t; setCurrentTime(t); } }} gameType="none" language={settings.language} learningLanguage={scope} fontSize={settings.subtitleFontSize} onWordClick={handleWordClick} onSentenceClick={handleSentenceClick} onTextHover={handleYomitanHover} onTextClick={handleYomitanClick} onTranslateClick={handleTranslateClick} segmentationMode={settings.segmentationMode} onAutoSegment={()=>{}} isScanning={false} onShiftTimeline={()=>{}} subtitleMode={settings.subtitleMode} dictMode={settings.dictMode} showSubtitles={true} yomitanMode={settings.yomitanMode} yomitanHighlight={yomitanPopup ? { ...yomitanPopup.highlight!, pinned: yomitanPopup.pinned } : undefined} currentTime={currentTime} />
              
              <SidePanel 
                  isOpen={showSidePanel} 
                  onClose={() => setShowSidePanel(false)}
                  chapters={audioTracks.find(t => t.id === currentTrackId)?.chapters || []}
                  bookmarks={audioTracks.find(t => t.id === currentTrackId)?.bookmarks || []}
                  onSeek={(t) => { if(audioRef.current) { audioRef.current.currentTime = t; setCurrentTime(t); } }}
                  onDeleteBookmark={handleDeleteBookmark}
                  onEditBookmark={()=>{}}
                  language={settings.language}
                  currentTrack={audioTracks.find(t => t.id === currentTrackId)}
              />

              <SubtitleListPanel
                  isOpen={showSubtitleList}
                  onClose={() => setShowSubtitleList(false)}
                  subtitles={subtitles}
                  activeSubtitleIndex={activeSubtitleIndex}
                  onSeek={(t) => { if(audioRef.current) { audioRef.current.currentTime = t; setCurrentTime(t); } }}
                  language={settings.language}
              />

              {showBookmarkModal && (
                  <BookmarkModal 
                      isOpen={showBookmarkModal}
                      onClose={() => setShowBookmarkModal(false)}
                      currentTime={currentTime}
                      currentTrackTitle={audioTracks.find(t => t.id === currentTrackId)?.title || ''}
                      onSave={handleSaveBookmark}
                      language={settings.language}
                  />
              )}

              {notification && (
                  <div className={`fixed top-20 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full shadow-xl z-[200] animate-fade-in-up font-bold text-sm flex items-center gap-2 pointer-events-none ${notification.type === 'error' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'}`}>
                      <i className={`fa-solid ${notification.type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}`}></i>
                      {notification.message}
                  </div>
              )}

              {dictionaryModalState.isOpen && dictionaryModalState.contextLine && (
                <DictionaryModal
                    isOpen={dictionaryModalState.isOpen}
                    onClose={() => {
                        setDictionaryModalState(prev => ({...prev, isOpen: false}));
                        resumeAfterLookup();
                    }}
                    initialWord={dictionaryModalState.initialWord}
                    initialSegmentIndex={dictionaryModalState.initialSegmentIndex}
                    sentence={dictionaryModalState.sentence}
                    contextLine={dictionaryModalState.contextLine}
                    language={settings.language}
                    learningLanguage={scope}
                    ankiSettings={ankiSettings}
                    segmentationMode={settings.segmentationMode}
                    webSearchEngine={settings.webSearchEngine}
                    currentTrack={audioTracks.find(t => t.id === currentTrackId)}
                    audioRef={audioRef}
                    ttsSettings={ttsSettings}
                    settings={settings}
                    setSettings={setSettings}
                    hasDictionaries={hasDictionaries}
                    onAnkiSuccess={() => { showToast(t.ankiSuccess); }}
                    onTableSuccess={() => { showToast(t.addedToTable); }}
                    onAddAnkiRef={dictAddAnkiRef}
                    scrollRef={dictScrollRef}
                />
              )}
              {yomitanPopup && yomitanPopup.visible && (
                  <YomitanPopup 
                    position={{ x: yomitanPopup.x, y: yomitanPopup.y }} 
                    results={yomitanPopup.results}
                    activeSegmentIndex={yomitanPopup.activeSegmentIndex}
                    onSelectSegment={(index) => setYomitanPopup(p => p ? {...p, activeSegmentIndex: index} : null)}
                    onClose={() => {
                        setYomitanPopup(null);
                        resumeAfterLookup();
                    }} 
                    onAddCard={handleAddCard}
                    onAddAllCardsInTab={handleAddAllCardsInTab}
                    seenWords={seenWords}
                    t={t}
                    learningLanguage={scope}
                    ttsSettings={ttsSettings}
                    scrollRef={yomitanScrollRef}
                  />
              )}
              {translationPopup && translationPopup.visible && (
                  <TranslationPopup
                      position={{ x: translationPopup.x, y: translationPopup.y }}
                      sentence={translationPopup.sentence}
                      onClose={() => {
                          setTranslationPopup(null);
                          resumeAfterLookup();
                      }}
                      t={t}
                      initialEngine={settings.webSearchEngine}
                      language={settings.language}
                      onEngineChange={(engine) => setSettings({...settings, webSearchEngine: engine})}
                      onAddAnki={() => handleAddSentenceCard(translationPopup.sentence)}
                      onAddAnkiRef={transAddAnkiRef}
                      scrollRef={transScrollRef}
                  />
              )}
              <PlayerControls 
                  isPlaying={isPlaying} 
                  currentTime={currentTime} 
                  duration={duration} 
                  playbackRate={playbackRate} 
                  onPlayPause={() => isPlaying ? safePause() : safePlay()} 
                  onSeek={t => { if(audioRef.current) audioRef.current.currentTime=t; setCurrentTime(t); }} 
                  onForward={handleForward} 
                  onRewind={handleRewind} 
                  onReplay={() => { if(audioRef.current) audioRef.current.currentTime=0; }} 
                  onRateChange={handleRateChange} 
                  onABLoopToggle={handleABLoopToggle} 
                  loopA={loopA} 
                  loopB={loopB} 
                  isSentenceRepeat={isSentenceRepeat} 
                  onSentenceRepeatToggle={() => setIsSentenceRepeat(!isSentenceRepeat)} 
                  language={settings.language} 
                  hasSecondarySubtitles={false} 
                  onToggleSubtitleType={()=>{}} 
                  activeSubtitleType="primary" 
                  onSaveBookmark={() => setShowBookmarkModal(true)} 
                  ttsEnabled={false} 
                  onTTSToggle={()=>{}} 
                  onToggleSidePanel={() => setShowSidePanel(!showSidePanel)} 
              />
           </div>
         )}
      </div>
      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} language={settings.language} setLanguage={l=>setSettings({...settings, language:l})} learningLanguage={settings.learningLanguage} setLearningLanguage={l=>setSettings({...settings, learningLanguage:l})} readerSettings={settings} setReaderSettings={setSettings} ankiSettings={ankiSettings} setAnkiSettings={setAnkiSettings} subtitleMode={settings.subtitleMode} setSubtitleMode={m=>setSettings({...settings, subtitleMode:m})} subtitleFontSize={settings.subtitleFontSize} setSubtitleFontSize={s=>setSettings({...settings, subtitleFontSize:s})} segmentationMode={settings.segmentationMode} setSegmentationMode={m=>setSettings({...settings, segmentationMode:m})} webSearchEngine={settings.webSearchEngine} setWebSearchEngine={e=>setSettings({...settings, webSearchEngine:e})} showToast={showToast} />
      <VocabListModal isOpen={showVocabTable} onClose={() => setShowVocabTable(false)} language={settings.language} onUpdate={() => {}} />
    </div>
  );
};
export default App;
