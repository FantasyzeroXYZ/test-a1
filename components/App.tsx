import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { SUPPORTED_SUBTITLE_TYPES } from '../constants';
import { SubtitleLine, Language, AudioTrack, Bookmark, SubtitleMode, ReaderSettings, GameType, AnkiSettings, LearningLanguage, SegmentationMode, PlaybackMode, WebSearchEngine, DictionaryResult, DictionaryEntry } from '../types';
import { getTranslation } from '../utils/i18n';
import { parseChapters } from '../utils/chapterUtils';
import { parseSRT, parseLRC, parseVTT, parseASS, formatTime } from '../utils/parsers';
import { saveTrackToDB, getAllTracksFromDB, deleteTrackFromDB, updateTrackMetadataInDB, getDictionaries, batchSearchTerms } from '../utils/storage';
import { detectAudioSegments } from '../utils/audioSegmenter';
import * as AnkiService from '../services/ankiService';
import { PlayerControls } from './PlayerControls';
import { SubtitleRenderer } from './SubtitleRenderer';
import DictionaryModal from './DictionaryModal';
import { Library } from './Library';
import { SidePanel } from './SidePanel';
import { SettingsPanel } from './SettingsPanel';
import { BookmarkModal } from './BookmarkModal';
import { VocabListModal } from './VocabListModal';
import { YomitanPopup, YomitanAnalysisResult } from './YomitanPopup';
import { TranslationPopup } from './TranslationPopup';
import { isNonSpacedLang } from '../utils/textUtils';
import { deinflector, DeinflectionResult, parseTransforms } from '../utils/deinflector';
// 引入日语处理工具和默认规则
import { normalizeCombiningCharacters, convertKatakanaToHiragana, isStringPartiallyJapanese, convertHalfWidthKanaToFullWidth } from '../utils/japanese';
import { japaneseDeinflectionRules } from '../utils/japaneseDeinflectionRules';

const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'light', language: 'zh', learningLanguage: 'en', subtitleMode: 'scroll', subtitleFontSize: 20, segmentationMode: 'browser',
  playbackMode: 'normal', webSearchEngine: 'bing_trans', webLinkMode: 'inline', copyToClipboard: false, dictMode: 'word',
  // FIX: Added missing 'yomitanModeType' property to satisfy ReaderSettings interface.
  dictExportMode: 'anki', ankiBoldWord: true, yomitanMode: false, yomitanModeType: 'comprehensive', enablePreprocessing: false,
  ttsEnabled: true, ttsVoice: '', ttsRate: 1, ttsPitch: 1, ttsVolume: 1,
  keybindings: { library: { import: 'KeyI', settings: 'KeyS' }, player: { playPause: 'Space', rewind: 'ArrowLeft', forward: 'ArrowRight', sidebar: 'KeyL', dict: 'KeyD' }, dictionary: { close: 'Escape', addAnki: 'KeyA', replay: 'KeyR' } },
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

// FIX: Added helper function to format a single dictionary entry for export.
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

const App: React.FC = () => {
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    const stored = localStorage.getItem('lf_settings_v5');
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
  });
  const [ankiSettings, setAnkiSettings] = useState<AnkiSettings>(() => {
    const stored = localStorage.getItem('lf_anki');
    return stored ? JSON.parse(stored) : { host: '127.0.0.1', port: 8765, deckName: 'Default', modelName: 'Basic', fieldMap: { word: 'Front', definition: 'Back', sentence: '', translation: '', audio: '', examVocab: '备注' }, tags: 'linguaflow' };
  });

  const [view, setView] = useState<'library' | 'player'>('library');
  const t = getTranslation(settings.language);

  const [showSettings, setShowSettings] = useState(false);
  const [showVocabTable, setShowVocabTable] = useState(false);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]); 
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<SubtitleLine[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeSubtitleIndex, setActiveSubtitleIndex] = useState<number>(-1);
  const audioRef = useRef<HTMLAudioElement>(null);

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

  useEffect(() => {
      const savedTransforms = localStorage.getItem('lf_transforms');
      if (savedTransforms) {
          const parsed = parseTransforms(savedTransforms);
          // FIX: The 'load' method on deinflector expects two arguments: the language code and the transforms object.
          if (parsed) deinflector.load(parsed.language, parsed);
      } else {
          // FIX: The 'load' method on deinflector expects two arguments: the language code ('ja') and the transforms object.
          deinflector.load('ja', japaneseDeinflectionRules);
      }
  }, []);

  const scope = useMemo(() => {
      const track = audioTracks.find(t => t.id === currentTrackId);
      return track?.language || settings.learningLanguage;
  }, [audioTracks, currentTrackId, settings.learningLanguage]);

  useEffect(() => { getAllTracksFromDB().then(setAudioTracks); }, []);
  const safePause = useCallback(() => { audioRef.current?.pause(); setIsPlaying(false); }, []);
  const safePlay = useCallback(async () => { try { await audioRef.current?.play(); setIsPlaying(true); } catch (e) {} }, []);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>, category: 'music' | 'audiobook') => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
        const { chapters, coverBlob } = await parseChapters(file);
        const id = crypto.randomUUID();
        const newTrack: AudioTrack = { id, title: file.name.replace(/\.[^/.]+$/, ''), filename: file.name, url: URL.createObjectURL(file), category, chapters, coverBlob, cover: coverBlob ? URL.createObjectURL(coverBlob) : undefined, updatedAt: Date.now(), file };
        await saveTrackToDB(newTrack, file);
        setAudioTracks(prev => [...prev, newTrack]);
    } catch (err) { alert(t.importFailed); } finally { e.target.value = ''; }
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

  const performYomitanAnalysis = useCallback(async (event: React.MouseEvent, line: SubtitleLine, triggerIndex: number) => {
    const chars = Array.from(line.text);
    const suffix = chars.slice(triggerIndex).join('');
    const maxScanLen = 10;
    const analysisResults: YomitanAnalysisResult[] = [];

    for (let len = Math.min(suffix.length, maxScanLen); len >= 1; len--) {
        const raw = suffix.substring(0, len);
        const foundWords: YomitanAnalysisResult['foundWords'] = [];
        
        const termsToSearch = new Set<string>();
        const directTerms = new Set<string>();
        
        const fullWidth = convertHalfWidthKanaToFullWidth(raw);
        const normalized = normalizeCombiningCharacters(fullWidth);
        directTerms.add(raw);
        directTerms.add(fullWidth);
        directTerms.add(normalized);
        directTerms.forEach(t => termsToSearch.add(t));

        const deinflections: DeinflectionResult[] = [];
        const deinflectedTerms = new Set<string>();
        let hiragana = '';

        if (settings.enablePreprocessing || isStringPartiallyJapanese(raw)) {
            hiragana = convertKatakanaToHiragana(normalized);
            const deinflectionResults = deinflector.deinflect(hiragana, 'ja');
            deinflections.push(...deinflectionResults);

            termsToSearch.add(hiragana);
            deinflectionResults.forEach(d => {
                termsToSearch.add(d.term);
                deinflectedTerms.add(d.term);
                const deinflectedReading = convertKatakanaToHiragana(d.term);
                if (deinflectedReading !== d.term) {
                    termsToSearch.add(deinflectedReading);
                    deinflectedTerms.add(deinflectedReading);
                }
            });
        }
        
        const allTermsToSearch = Array.from(termsToSearch);
        const searchResults = await batchSearchTerms(allTermsToSearch, scope);
        
        if (searchResults.length > 0) {
            for (const res of searchResults) {
                // Priority 1: Direct Match
                if (directTerms.has(res.word)) {
                    foundWords.push({ result: res, source: 'direct' });
                    continue;
                }

                // Priority 2: Deinflected match on HEADWORD
                const deinflectedHeadwordMatch = deinflections.find(d => d.term === res.word || convertKatakanaToHiragana(d.term) === res.word);
                if (deinflectedHeadwordMatch) {
                    foundWords.push({ result: res, source: 'deinflected', reason: deinflectedHeadwordMatch.reasons.join(' ← ') });
                    continue;
                }

                // Priority 3: Reading match on ORIGINAL input's reading
                if (hiragana && hiragana !== res.word && res.entries.some(e => e.pronunciations.some(p => p.text === hiragana))) {
                    foundWords.push({ result: res, source: 'reading' });
                    continue;
                }

                // Priority 4: Deinflected match on PRONUNCIATION (fallback)
                const deinflectedReadingMatch = deinflections.find(d => {
                    const deinflectedReading = convertKatakanaToHiragana(d.term);
                    return res.entries.some(e => e.pronunciations.some(p => p.text === d.term || p.text === deinflectedReading));
                });
                if (deinflectedReadingMatch) {
                    foundWords.push({ result: res, source: 'deinflected', secondarySource: 'reading', reason: deinflectedReadingMatch.reasons.join(' ← ') });
                    continue;
                }
            }
        }

        if (foundWords.length > 0) {
            analysisResults.push({
                segment: raw,
                length: len,
                foundWords: [...new Map(foundWords.map(item => [item.result.word, item])).values()] // Deduplicate
            });
            if (settings.yomitanModeType === 'fast') {
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
            highlight: { lineId: line.id, start: triggerIndex, length: firstResult.length },
            pinned: true,
        });
        if (firstResult.foundWords.length > 0) {
            setSeenWords(prev => new Set(prev).add(firstResult.foundWords[0].result.word));
        }
        return;
    }
    setYomitanPopup(null);
  }, [scope, settings.enablePreprocessing, settings.yomitanModeType]);

  const handleYomitanHover = useCallback((e: React.MouseEvent, char: string, line: SubtitleLine, idx: number) => {
      return;
  }, []);

  const handleYomitanClick = useCallback((e: React.MouseEvent, char: string, line: SubtitleLine, idx: number) => {
      performYomitanAnalysis(e, line, idx);
  }, [performYomitanAnalysis]);
  
  const handleTranslateClick = (event: React.MouseEvent, line: SubtitleLine) => {
      setTranslationPopup({
          visible: true,
          x: event.clientX,
          y: event.clientY,
          sentence: line.text,
      });
  };

  // FIX: Updated handler to support single-entry adding and unpinning instead of closing.
  const handleYomitanAddCard = async (result: DictionaryResult, entry?: DictionaryEntry) => {
      const definition = entry ? formatSingleEntryForExport(result.word, entry) : formatDefinitionForExport(result);
      const word = result.word;
      const allTags = new Set<string>();
      
      const entriesToScan = entry ? [entry] : result.entries;
      entriesToScan.forEach(e => e.tags?.forEach(t => allTags.add(t)));
      
      const line = yomitanPopup?.highlight ? subtitles.find(s => s.id === yomitanPopup.highlight!.lineId) : null;
      const sentence = line?.text || "";
      const sent = settings.ankiBoldWord ? sentence.replace(word, `<b>${word}</b>`) : sentence;

      if (settings.dictExportMode === 'table') {
          const raw = localStorage.getItem('lf_vocab_table');
          const table = raw ? JSON.parse(raw) : [];
          table.push({ id: crypto.randomUUID(), word, definition, sentence: sent, translation: '', tags: Array.from(allTags).join(' '), sourceTitle: audioTracks.find(t => t.id === currentTrackId)?.title || t.unknownSource, timeRange: line ? `${formatTime(line.start)}` : "0:00", addedAt: Date.now() });
          localStorage.setItem('lf_vocab_table', JSON.stringify(table));
          alert(t.addedToTable);
      } else {
          try {
              let map = { ...ankiSettings.fieldMap };
              if (settings.dictMode === 'sentence' && ankiSettings.sentenceFieldMap) map = { ...map, ...ankiSettings.sentenceFieldMap };
              await AnkiService.addNote({ ...ankiSettings, fieldMap: map as any }, { word, definition, sentence: sent, translation: '', examVocab: Array.from(allTags).join(' ') });
              alert(t.ankiSuccess);
          } catch (e) { alert(t.ankiError); }
      }
      setYomitanPopup(p => p ? {...p, pinned: false } : null); // Unpin after adding
  };

  // FIX: Added handler for "Add All" button in YomitanPopup.
  const handleAddAllCardsInTab = async (results: DictionaryResult[]) => {
    for (const result of results) {
        await handleYomitanAddCard(result);
    }
  };
  
  const handleRewind = () => {
    if (!audioRef.current || subtitles.length === 0) return;
    const current = audioRef.current.currentTime;
    const target = subtitles.slice().reverse().find(s => s.start < current - 0.5);
    const newTime = target ? target.start : 0;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleForward = () => {
    if (!audioRef.current || subtitles.length === 0) return;
    const current = audioRef.current.currentTime;
    const target = subtitles.find(s => s.start > current);
    if (target) {
        const newTime = target.start;
        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
    }
  };

  useEffect(() => {
      if (subtitles.length === 0) return;
      const idx = subtitles.findIndex(s => currentTime >= s.start && currentTime <= s.end);
      if (idx !== -1 && idx !== activeSubtitleIndex) setActiveSubtitleIndex(idx);
  }, [currentTime, subtitles, activeSubtitleIndex]);

  return (
    <div className="fixed inset-0 h-[100dvh] w-full bg-gray-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 flex flex-col overflow-hidden transition-colors duration-300">
      <audio ref={audioRef} src={audioSrc || undefined} onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} className="hidden" />
      <header className="flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-800 border-b h-16 shrink-0 z-50">
         <div className="flex items-center gap-4">
            <button onClick={() => { safePause(); setView('library'); }} className="w-8 h-8 bg-indigo-600 text-white rounded-lg flex items-center justify-center transition-colors"><i className="fa-solid fa-chevron-left text-sm"></i></button>
            <h1 className="font-bold text-sm truncate max-w-[150px]">{view === 'player' ? audioTracks.find(t=>t.id===currentTrackId)?.title : t.appTitle}</h1>
         </div>
         <div className="flex items-center gap-2">
            <button onClick={() => setShowVocabTable(true)} className="p-2 text-emerald-500 hover:text-emerald-600 transition-colors"><i className="fa-solid fa-table"></i></button>
            <button onClick={() => setShowSettings(true)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors"><i className="fa-solid fa-cog"></i></button>
         </div>
      </header>
      <div className="flex-1 overflow-hidden relative">
         {view === 'library' ? (
           <Library tracks={audioTracks} onTrackSelect={track => { setCurrentTrackId(track.id); setAudioSrc(track.url); setSubtitles(track.subtitles || []); setView('player'); setTimeout(safePlay, 100); }} language={settings.language} onTrackDelete={async id => { await deleteTrackFromDB(id); setAudioTracks(prev => prev.filter(t => t.id !== id)); }} onTrackUpdate={(id, up) => { setAudioTracks(prev => prev.map(t => t.id === id ? {...t, ...up} : t)); updateTrackMetadataInDB(id, up); }} onImport={handleImport} onReplaceFile={()=>{}} onImportLink={()=>{}} onImportSubtitle={handleImportSubtitle} />
         ) : (
           <div className="flex-1 flex flex-col h-full relative">
              <SubtitleRenderer subtitles={subtitles} activeSubtitleIndex={activeSubtitleIndex} onSeek={t => { if(audioRef.current) audioRef.current.currentTime=t; }} gameType="none" language={settings.language} learningLanguage={settings.learningLanguage} fontSize={settings.subtitleFontSize} onWordClick={()=>{}} onTextHover={handleYomitanHover} onTextClick={handleYomitanClick} onTranslateClick={handleTranslateClick} segmentationMode={settings.segmentationMode} onAutoSegment={()=>{}} isScanning={false} onShiftTimeline={()=>{}} subtitleMode={settings.subtitleMode} showSubtitles={true} yomitanMode={settings.yomitanMode} yomitanHighlight={yomitanPopup ? { ...yomitanPopup.highlight!, pinned: yomitanPopup.pinned } : undefined} />
              {/* FIX: Updated YomitanPopup call to use correct props based on the component's definition. */}
              {yomitanPopup && yomitanPopup.visible && (
                  <YomitanPopup 
                    position={{ x: yomitanPopup.x, y: yomitanPopup.y }} 
                    results={yomitanPopup.results}
                    activeSegmentIndex={yomitanPopup.activeSegmentIndex}
                    onSelectSegment={(index) => setYomitanPopup(p => p ? {...p, activeSegmentIndex: index} : null)}
                    onClose={() => setYomitanPopup(null)} 
                    onAddCard={handleYomitanAddCard}
                    onAddAllCardsInTab={handleAddAllCardsInTab}
                    seenWords={seenWords}
                    t={t}
                  />
              )}
              {translationPopup && translationPopup.visible && (
                  <TranslationPopup
                      position={{ x: translationPopup.x, y: translationPopup.y }}
                      sentence={translationPopup.sentence}
                      onClose={() => setTranslationPopup(null)}
                      t={t}
                      initialEngine={settings.webSearchEngine}
                      language={settings.language}
                  />
              )}
              <PlayerControls isPlaying={isPlaying} currentTime={currentTime} duration={duration} playbackRate={1} onPlayPause={() => isPlaying ? safePause() : safePlay()} onSeek={t => { if(audioRef.current) audioRef.current.currentTime=t; setCurrentTime(t); }} onForward={handleForward} onRewind={handleRewind} onReplay={()=>{}} onRateChange={()=>{}} onABLoopToggle={()=>{}} loopA={null} loopB={null} isSentenceRepeat={false} onSentenceRepeatToggle={()=>{}} language={settings.language} hasSecondarySubtitles={false} onToggleSubtitleType={()=>{}} activeSubtitleType="primary" onSaveBookmark={()=>{}} ttsEnabled={false} onTTSToggle={()=>{}} onToggleSidePanel={()=>{}} />
           </div>
         )}
      </div>
      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} language={settings.language} setLanguage={l=>setSettings({...settings, language:l})} learningLanguage={settings.learningLanguage} setLearningLanguage={l=>setSettings({...settings, learningLanguage:l})} readerSettings={settings} setReaderSettings={setSettings} ankiSettings={ankiSettings} setAnkiSettings={setAnkiSettings} subtitleMode={settings.subtitleMode} setSubtitleMode={m=>setSettings({...settings, subtitleMode:m})} subtitleFontSize={settings.subtitleFontSize} setSubtitleFontSize={s=>setSettings({...settings, subtitleFontSize:s})} segmentationMode={settings.segmentationMode} setSegmentationMode={m=>setSettings({...settings, segmentationMode:m})} webSearchEngine={settings.webSearchEngine} setWebSearchEngine={e=>setSettings({...settings, webSearchEngine:e})} />
      <VocabListModal isOpen={showVocabTable} onClose={() => setShowVocabTable(false)} language={settings.language} onUpdate={() => {}} />
    </div>
  );
};
export default App;