
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { SUPPORTED_SUBTITLE_TYPES } from './constants';
import { SubtitleLine, Language, AudioTrack, Bookmark, SubtitleMode, ReaderSettings, GameType, AnkiSettings, LearningLanguage, SegmentationMode, PlaybackMode, WebSearchEngine } from './types';
import { getTranslation } from './utils/i18n';
import { parseChapters } from './utils/chapterUtils';
import { parseSRT, parseLRC, parseVTT, parseASS } from './utils/parsers';
import { saveTrackToDB, getAllTracksFromDB, deleteTrackFromDB, updateTrackMetadataInDB } from './utils/storage';
import { detectAudioSegments } from './utils/audioSegmenter';
import * as AnkiService from './services/ankiService';
import { PlayerControls } from './components/PlayerControls';
import { SubtitleRenderer } from './components/SubtitleRenderer';
import DictionaryModal from './components/DictionaryModal';
import { Library } from './components/Library';
import { SidePanel } from './components/SidePanel';
import { SettingsPanel } from './components/SettingsPanel';
import { BookmarkModal } from './components/BookmarkModal';

const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'light',
  language: 'zh',
  learningLanguage: 'en',
  subtitleMode: 'scroll',
  subtitleFontSize: 20,
  segmentationMode: 'browser',
  playbackMode: 'normal',
  webSearchEngine: 'bing_trans',
  copyToClipboard: false,
  ttsEnabled: true,
  ttsVoice: '',
  ttsRate: 1,
  ttsPitch: 1,
  ttsVolume: 1,
  keybindings: {
    library: { import: 'KeyI', settings: 'KeyS' },
    player: { playPause: 'Space', rewind: 'ArrowLeft', forward: 'ArrowRight', sidebar: 'KeyL', dict: 'KeyD' },
    dictionary: { close: 'Escape', addAnki: 'KeyA', replay: 'KeyR' }
  }
};

const loadConfig = <T,>(key: string, fallback: T): T => {
  try {
    const stored = localStorage.getItem('lf_settings_v5');
    return stored ? { ...fallback, ...JSON.parse(stored) } : fallback;
  } catch (e) { return fallback; }
};

const findSubtitleIndex = (subtitles: SubtitleLine[], time: number): number => {
  let low = 0, high = subtitles.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const line = subtitles[mid];
    if (time >= line.start && time < line.end) return mid;
    if (time < line.start) high = mid - 1;
    else low = mid + 1;
  }
  return -1;
};

const App: React.FC = () => {
  const [settings, setSettings] = useState<ReaderSettings>(() => loadConfig('lf_settings_v5', DEFAULT_SETTINGS));
  const [ankiSettings, setAnkiSettings] = useState<AnkiSettings>(() => loadConfig('lf_anki', {
    host: '127.0.0.1', port: 8765, deckName: 'Default', modelName: 'Basic',
    fieldMap: { word: 'Front', definition: 'Back', sentence: '', translation: '', audio: '' },
    tags: 'linguaflow'
  }));

  const [view, setView] = useState<'library' | 'player'>('library');
  const t = getTranslation(settings.language);

  const [showSettings, setShowSettings] = useState(false);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]); 
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<SubtitleLine[]>([]);
  const [secondarySubtitles, setSecondarySubtitles] = useState<SubtitleLine[]>([]);
  const [activeSubtitleType, setActiveSubtitleType] = useState<'primary' | 'secondary'>('primary');
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeSubtitleIndex, setActiveSubtitleIndex] = useState<number>(-1);
  const [showDictionaryModal, setShowDictionaryModal] = useState(false);
  const [dictionaryTargetWord, setDictionaryTargetWord] = useState('');
  const [dictionaryTargetIndex, setDictionaryTargetIndex] = useState(0);
  const [dictionaryContext, setDictionaryContext] = useState<SubtitleLine>({id:'', start:0, end:0, text:''});
  const [isOpeningTrack, setIsOpeningTrack] = useState(false);
  const [wasPlayingBeforeModal, setWasPlayingBeforeModal] = useState(false);

  const currentTrack = useMemo(() => audioTracks.find(t => t.id === currentTrackId), [audioTracks, currentTrackId]);
  const currentDisplaySubtitles = useMemo(() => activeSubtitleType === 'primary' ? subtitles : secondarySubtitles, [activeSubtitleType, subtitles, secondarySubtitles]);

  useEffect(() => { localStorage.setItem('lf_settings_v5', JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem('lf_anki', JSON.stringify(ankiSettings)); }, [ankiSettings]);
  useEffect(() => { getAllTracksFromDB().then(setAudioTracks); }, []);

  // Theme application effect
  useEffect(() => {
    // Force remove first to ensure clean state
    document.documentElement.classList.remove('dark');
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    }
  }, [settings.theme]);

  const safePause = useCallback(() => { if (audioRef.current) { audioRef.current.pause(); setIsPlaying(false); } }, []);
  const safePlay = useCallback(async () => { if (audioRef.current) { try { await audioRef.current.play(); setIsPlaying(true); } catch (err) {} } }, []);

  const handleForward = useCallback(() => {
    if (!audioRef.current) return;
    const currTime = audioRef.current.currentTime;

    // Logic: If before first subtitle, jump to start of first subtitle
    if (currentDisplaySubtitles.length > 0) {
        if (currTime < currentDisplaySubtitles[0].start) {
            audioRef.current.currentTime = currentDisplaySubtitles[0].start;
            return;
        }
    }

    // Standard next sentence logic
    if (activeSubtitleIndex < currentDisplaySubtitles.length - 1) {
        audioRef.current.currentTime = currentDisplaySubtitles[activeSubtitleIndex + 1].start;
    }
  }, [currentDisplaySubtitles, activeSubtitleIndex]);

  const handleRewind = useCallback(() => {
      if (!audioRef.current) return;
      if (activeSubtitleIndex > 0) {
          audioRef.current.currentTime = currentDisplaySubtitles[activeSubtitleIndex - 1].start;
      } else if (currentDisplaySubtitles.length > 0) {
          // If at first subtitle or before, reset to 0 or start of first
          audioRef.current.currentTime = currentDisplaySubtitles[0].start;
      }
  }, [currentDisplaySubtitles, activeSubtitleIndex]);

  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

    if (showDictionaryModal) {
      const kb = settings.keybindings.dictionary;
      if (e.code === kb.close) { e.preventDefault(); setShowDictionaryModal(false); if (wasPlayingBeforeModal) safePlay(); }
      return;
    }

    if (view === 'player') {
      const kb = settings.keybindings.player;
      if (e.code === kb.playPause) { e.preventDefault(); isPlaying ? safePause() : safePlay(); }
      if (e.code === kb.forward) { e.preventDefault(); handleForward(); }
      if (e.code === kb.rewind) { e.preventDefault(); handleRewind(); }
      if (e.code === kb.dict) { e.preventDefault(); if (activeSubtitleIndex !== -1) { 
        const line = currentDisplaySubtitles[activeSubtitleIndex];
        setDictionaryTargetWord(line.text.split(' ')[0] || '');
        setDictionaryTargetIndex(0);
        setWasPlayingBeforeModal(isPlaying);
        setDictionaryContext(line);
        safePause();
        setShowDictionaryModal(true);
      } }
    } else {
        const kb = settings.keybindings.library;
        if (e.code === kb.settings) { e.preventDefault(); setShowSettings(true); }
    }
  }, [view, showDictionaryModal, settings, isPlaying, safePlay, safePause, activeSubtitleIndex, currentDisplaySubtitles, wasPlayingBeforeModal, handleForward, handleRewind]);

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>, category: 'music' | 'audiobook') => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsOpeningTrack(true);
    try {
      const { chapters, coverBlob } = await parseChapters(file);
      const id = crypto.randomUUID();
      const newTrack: AudioTrack = {
        id,
        title: file.name.replace(/\.[^/.]+$/, ''),
        filename: file.name,
        url: URL.createObjectURL(file),
        category,
        file,
        chapters,
        coverBlob,
        cover: coverBlob ? URL.createObjectURL(coverBlob) : undefined
      };
      await saveTrackToDB(newTrack, file);
      setAudioTracks(prev => [...prev, newTrack]);
    } catch (err) { console.error(err); } 
    finally { setIsOpeningTrack(false); }
  };

  const handleImportSubtitle = async (trackId: string, file: File, isSecondary: boolean) => {
    const text = await file.text();
    let parsed: SubtitleLine[] = [];
    const ext = file.name.toLowerCase();
    if (ext.endsWith('.srt')) parsed = parseSRT(text);
    else if (ext.endsWith('.lrc')) parsed = parseLRC(text);
    else if (ext.endsWith('.vtt')) parsed = parseVTT(text);
    else if (ext.endsWith('.ass')) parsed = parseASS(text);

    setAudioTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        const updates = isSecondary ? { secondarySubtitles: parsed, secondarySubtitleFileName: file.name } : { subtitles: parsed, subtitleFileName: file.name };
        updateTrackMetadataInDB(trackId, updates);
        return { ...t, ...updates };
      }
      return t;
    }));
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const curr = audioRef.current.currentTime;
    setCurrentTime(curr);
    const newIdx = findSubtitleIndex(currentDisplaySubtitles, curr);
    if (newIdx !== -1 && newIdx !== activeSubtitleIndex) setActiveSubtitleIndex(newIdx);
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-gray-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-sans select-none overflow-hidden transition-colors duration-300">
      <audio ref={audioRef} src={audioSrc || undefined} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={(e) => {
        setDuration(e.currentTarget.duration);
        safePlay();
      }} className="hidden" />
      
      <header className="flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 h-16 shrink-0 z-50 transition-colors duration-300">
         <div className="flex items-center gap-4">
            <button onClick={() => { safePause(); setView('library'); }} className="w-8 h-8 bg-indigo-600 hover:bg-indigo-500 rounded-lg flex items-center justify-center transition-colors"><i className="fa-solid fa-chevron-left text-white text-sm"></i></button>
            <h1 className="font-bold text-sm truncate">{view === 'player' ? (currentTrack?.title || "Player") : t.appTitle}</h1>
         </div>
         <button onClick={() => setShowSettings(true)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors"><i className="fa-solid fa-cog text-lg"></i></button>
      </header>

      <div className="flex-1 overflow-hidden relative">
         {view === 'library' ? (
           <Library 
              tracks={audioTracks} 
              onTrackSelect={track => { setCurrentTrackId(track.id); setAudioSrc(track.url); setSubtitles(track.subtitles || []); setView('player'); }} 
              onTrackDelete={async id => { await deleteTrackFromDB(id); setAudioTracks(prev => prev.filter(t => t.id !== id)); }} 
              onTrackUpdate={(id, updates) => { setAudioTracks(prev => prev.map(t => t.id === id ? {...t, ...updates} : t)); updateTrackMetadataInDB(id, updates); }} 
              onImport={handleImport} 
              onReplaceFile={()=>{}} 
              onImportLink={()=>{}} 
              onImportSubtitle={handleImportSubtitle} 
              language={settings.language} 
           />
         ) : (
           <div className="flex-1 flex flex-col h-full">
              <SubtitleRenderer subtitles={currentDisplaySubtitles} activeSubtitleIndex={activeSubtitleIndex} onSeek={t => { if(audioRef.current) audioRef.current.currentTime=t; }} gameType="none" language={settings.language} learningLanguage={settings.learningLanguage} fontSize={settings.subtitleFontSize} onWordClick={(word, line, index) => { 
                setWasPlayingBeforeModal(isPlaying); 
                safePause(); 
                setDictionaryTargetWord(word); 
                setDictionaryTargetIndex(index); 
                setDictionaryContext(line); 
                setShowDictionaryModal(true); 
                if(settings.copyToClipboard) navigator.clipboard.writeText(word); 
              }} segmentationMode={settings.segmentationMode} onAutoSegment={()=>{}} isScanning={false} onShiftTimeline={()=>{}} subtitleMode={settings.subtitleMode} />
              
              <PlayerControls 
                isPlaying={isPlaying} 
                currentTime={currentTime} 
                duration={duration} 
                playbackRate={1} 
                onPlayPause={() => isPlaying ? safePause() : safePlay()} 
                onSeek={t => { if(audioRef.current) audioRef.current.currentTime=t; }} 
                onForward={handleForward} 
                onRewind={handleRewind} 
                onReplay={() => { if(activeSubtitleIndex !== -1 && audioRef.current) audioRef.current.currentTime = currentDisplaySubtitles[activeSubtitleIndex].start; }} 
                onRateChange={() => {}} 
                onABLoopToggle={()=>{}} 
                loopA={null} loopB={null} 
                isSentenceRepeat={false} 
                onSentenceRepeatToggle={()=>{}} 
                language={settings.language} 
                hasSecondarySubtitles={secondarySubtitles.length > 0} 
                onToggleSubtitleType={() => setActiveSubtitleType(p => p === 'primary' ? 'secondary' : 'primary')} 
                activeSubtitleType={activeSubtitleType} 
                onSaveBookmark={()=>{}} 
                ttsEnabled={settings.ttsEnabled}
                onTTSToggle={() => setSettings({...settings, ttsEnabled: !settings.ttsEnabled})}
              />
           </div>
         )}
      </div>

      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} language={settings.language} setLanguage={l => setSettings({...settings, language: l})} learningLanguage={settings.learningLanguage} setLearningLanguage={l => setSettings({...settings, learningLanguage: l})} readerSettings={settings} setReaderSettings={setSettings} ankiSettings={ankiSettings} setAnkiSettings={setAnkiSettings} subtitleMode={settings.subtitleMode} setSubtitleMode={m => setSettings({...settings, subtitleMode: m})} subtitleFontSize={settings.subtitleFontSize} setSubtitleFontSize={s => setSettings({...settings, subtitleFontSize: s})} segmentationMode={settings.segmentationMode} setSegmentationMode={m => setSettings({...settings, segmentationMode: m})} webSearchEngine={settings.webSearchEngine} setWebSearchEngine={e => setSettings({...settings, webSearchEngine: e})} />
      
      <DictionaryModal 
        isOpen={showDictionaryModal} 
        onClose={() => { setShowDictionaryModal(false); if (wasPlayingBeforeModal) safePlay(); }} 
        initialWord={dictionaryTargetWord} initialSegmentIndex={dictionaryTargetIndex} sentence={dictionaryContext.text} contextLine={dictionaryContext} 
        language={settings.language} learningLanguage={settings.learningLanguage} ankiSettings={ankiSettings} segmentationMode={settings.segmentationMode} webSearchEngine={settings.webSearchEngine} currentTrack={currentTrack} audioRef={audioRef} 
        ttsSettings={{ enabled: settings.ttsEnabled, rate: settings.ttsRate, pitch: settings.ttsPitch, volume: settings.ttsVolume, voice: settings.ttsVoice }}
        settings={settings}
        setSettings={setSettings}
      />
      {isOpeningTrack && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl"><div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div></div>}
    </div>
  );
};
export default App;
