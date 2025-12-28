
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { SUPPORTED_SUBTITLE_TYPES, DEFAULT_KEY_BINDINGS } from './constants';
import { SubtitleLine, Language, AudioTrack, Bookmark, SubtitleMode, KeyBindings, GameType, AnkiSettings, LearningLanguage, SegmentationMode, PlaybackMode, WebSearchEngine } from './types';
import { getTranslation } from './utils/i18n';
import { parseChapters } from './utils/chapterUtils';
import { parseSRT, parseLRC, parseVTT, parseASS } from './utils/parsers';
import { saveTrackToDB, getAllTracksFromDB, deleteTrackFromDB, updateTrackMetadataInDB } from './utils/storage';
import { detectAudioSegments } from './utils/audioSegmenter';
import * as AnkiService from './services/ankiService';
import { PlayerControls } from './components/PlayerControls';
import { SubtitleRenderer } from './components/SubtitleRenderer';
import { DictionaryModal } from './components/DictionaryModal';
import { Library } from './components/Library';
import { SidePanel } from './components/SidePanel';
import { SettingsPanel } from './components/SettingsPanel';
import { BookmarkModal } from './components/BookmarkModal';

// Simple Toast Component for notifications
const Toast = ({ message, onClose }: { message: string | null, onClose: () => void }) => {
  useEffect(() => {
    if (message) {
      const timer = setTimeout(onClose, 2000);
      return () => clearTimeout(timer);
    }
  }, [message, onClose]);

  if (!message) return null;

  return (
    <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[200] animate-bounce-in pointer-events-none">
      <div className="bg-slate-800/90 backdrop-blur-md border border-indigo-500/50 px-6 py-3 rounded-full shadow-2xl flex items-center gap-3">
        <i className="fa-solid fa-circle-check text-green-400 text-lg"></i>
        <span className="text-white font-bold text-sm">{message}</span>
      </div>
    </div>
  );
};

// Check for iOS
const isIOS = () => {
  return [
    'iPad Simulator',
    'iPhone Simulator',
    'iPod Simulator',
    'iPad',
    'iPhone',
    'iPod'
  ].includes(navigator.platform) || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
};

const loadConfig = <T,>(key: string, fallback: T): T => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch (e) { return fallback; }
};

const findSubtitleIndex = (subtitles: SubtitleLine[], time: number): number => {
  let low = 0;
  let high = subtitles.length - 1;
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
  const [language, setLanguage] = useState<Language>(() => loadConfig('lf_lang', 'zh'));
  const [learningLanguage, setLearningLanguage] = useState<LearningLanguage>(() => loadConfig('lf_learningLang', 'en'));
  const [view, setView] = useState<'library' | 'player'>('library');
  const t = getTranslation(language);

  const [showSettings, setShowSettings] = useState(false);
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>(() => loadConfig('lf_subMode', 'scroll'));
  const [subtitleFontSize, setSubtitleFontSize] = useState<number>(() => loadConfig('lf_fontSize', 20));
  const [keyBindings, setKeyBindings] = useState<KeyBindings>(() => loadConfig('lf_keyBindings', DEFAULT_KEY_BINDINGS));
  const [ankiSettings, setAnkiSettings] = useState<AnkiSettings>(() => loadConfig('lf_anki', {
    host: '127.0.0.1', port: 8765, deckName: 'Default', modelName: 'Basic',
    fieldMap: { word: 'Front', definition: 'Back', sentence: '', translation: '', audio: '' },
    tags: 'linguaflow'
  }));
  const [gameType, setGameType] = useState<GameType>(() => loadConfig('lf_gameType', 'none'));
  const [segmentationMode, setSegmentationMode] = useState<SegmentationMode>(() => loadConfig('lf_segMode', 'browser'));
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(() => loadConfig('lf_playMode', 'normal'));
  const [webSearchEngine, setWebSearchEngine] = useState<WebSearchEngine>(() => loadConfig('lf_webSearchEngine', 'google'));

  // Persistence Effects
  useEffect(() => { localStorage.setItem('lf_lang', JSON.stringify(language)); }, [language]);
  useEffect(() => { localStorage.setItem('lf_learningLang', JSON.stringify(learningLanguage)); }, [learningLanguage]);
  useEffect(() => { localStorage.setItem('lf_subMode', JSON.stringify(subtitleMode)); }, [subtitleMode]);
  useEffect(() => { localStorage.setItem('lf_fontSize', JSON.stringify(subtitleFontSize)); }, [subtitleFontSize]);
  useEffect(() => { localStorage.setItem('lf_keyBindings', JSON.stringify(keyBindings)); }, [keyBindings]);
  useEffect(() => { localStorage.setItem('lf_anki', JSON.stringify(ankiSettings)); }, [ankiSettings]);
  useEffect(() => { localStorage.setItem('lf_gameType', JSON.stringify(gameType)); }, [gameType]);
  useEffect(() => { localStorage.setItem('lf_segMode', JSON.stringify(segmentationMode)); }, [segmentationMode]);
  useEffect(() => { localStorage.setItem('lf_playMode', JSON.stringify(playbackMode)); }, [playbackMode]);
  useEffect(() => { localStorage.setItem('lf_webSearchEngine', JSON.stringify(webSearchEngine)); }, [webSearchEngine]);

  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]); 
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<SubtitleLine[]>([]);
  const [secondarySubtitles, setSecondarySubtitles] = useState<SubtitleLine[]>([]);
  const [activeSubtitleType, setActiveSubtitleType] = useState<'primary' | 'secondary'>('primary');
  const audioRef = useRef<HTMLAudioElement>(null);
  const [fileName, setFileName] = useState<string>("No file loaded");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [activeSubtitleIndex, setActiveSubtitleIndex] = useState<number>(-1);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [isSentenceRepeat, setIsSentenceRepeat] = useState(false);
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [showDictionaryModal, setShowDictionaryModal] = useState(false);
  const [dictionaryTargetWord, setDictionaryTargetWord] = useState('');
  const [dictionaryTargetIndex, setDictionaryTargetIndex] = useState(0);
  const [dictionaryContext, setDictionaryContext] = useState<SubtitleLine>({id:'', start:0, end:0, text:''});
  const [isAddingToAnki, setIsAddingToAnki] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isOpeningTrack, setIsOpeningTrack] = useState(false);

  const [showBookmarkModal, setShowBookmarkModal] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [wasPlayingBeforeModal, setWasPlayingBeforeModal] = useState(false); 

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const currentTrack = useMemo(() => audioTracks.find(t => t.id === currentTrackId), [audioTracks, currentTrackId]);
  const currentDisplaySubtitles = useMemo(() => activeSubtitleType === 'primary' ? subtitles : secondarySubtitles, [activeSubtitleType, subtitles, secondarySubtitles]);

  useEffect(() => {
    getAllTracksFromDB().then(setAudioTracks);
  }, []);

  const safePause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const safePlay = useCallback(async () => {
    if (audioRef.current) {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (err) { /* Catch DOMException (e.g., user hasn't interacted yet) */ }
    }
  }, []);

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const curr = audioRef.current.currentTime;
    if (Math.abs(currentTime - curr) > 0.1) {
        setCurrentTime(curr);
    }
    
    // AB Loop logic
    if (loopA !== null && loopB !== null && curr >= loopB) {
      audioRef.current.currentTime = loopA;
      return;
    }

    const newIdx = findSubtitleIndex(currentDisplaySubtitles, curr);

    // Single Sentence Repeat logic
    // Check if we passed the end of the current sentence
    if (isSentenceRepeat && activeSubtitleIndex !== -1 && currentDisplaySubtitles.length > 0) {
      const currentSub = currentDisplaySubtitles[activeSubtitleIndex];
      // If we are strictly after the end of the subtitle, AND the index calculator says we should be elsewhere
      if (curr > currentSub.end && newIdx !== activeSubtitleIndex) {
         audioRef.current.currentTime = currentSub.start;
         return; 
      }
    }

    if (newIdx !== -1 && newIdx !== activeSubtitleIndex) {
      setActiveSubtitleIndex(newIdx);
    } else if (newIdx === -1 && activeSubtitleIndex !== -1) {
      // Keep previous active
    }
  };

  const handleShiftTimeline = async (seconds: number) => {
    if (!currentTrack) return;
    const updated = subtitles.map(s => ({ ...s, start: s.start + seconds, end: s.end + seconds }));
    setSubtitles(updated);
    await updateTrackMetadataInDB(currentTrack.id, { subtitles: updated });
  };

  const handleSaveBookmark = async (bookmark: Bookmark) => {
    if (!currentTrack) return;
    let updatedBookmarks: Bookmark[];
    if (bookmark.id) {
      updatedBookmarks = (currentTrack.bookmarks || []).map(b => b.id === bookmark.id ? bookmark : b);
    } else {
      const newBookmark: Bookmark = {
        ...bookmark,
        id: `bm-${Date.now()}`,
        createdAt: Date.now(),
      };
      updatedBookmarks = [...(currentTrack.bookmarks || []), newBookmark];
    }
    await updateTrackMetadataInDB(currentTrack.id, { bookmarks: updatedBookmarks });
    setAudioTracks(prev => prev.map(t => t.id === currentTrack.id ? { ...t, bookmarks: updatedBookmarks } : t));
    setShowBookmarkModal(false); 
    setEditingBookmark(null); 
    if (wasPlayingBeforeModal) {
      safePlay();
    }
  };

  const handleOpenBookmarkModal = (bookmark?: Bookmark) => {
    setEditingBookmark(bookmark || null);
    setWasPlayingBeforeModal(isPlaying); 
    safePause(); 
    setShowBookmarkModal(true);
  };

  const handleCloseBookmarkModal = () => {
    setShowBookmarkModal(false);
    setEditingBookmark(null);
    if (wasPlayingBeforeModal) { 
      safePlay();
    }
  }

  const handleAddToAnki = async (definition: string, sentence: string, recordedAudioBase64?: string) => {
    if (!currentTrack) return;
    setIsAddingToAnki(true);
    try {
      await AnkiService.addNote(ankiSettings, {
        word: dictionaryTargetWord,
        definition,
        sentence: sentence,
        translation: '',
        audioBase64: recordedAudioBase64
      });
      // Show toast instead of alert
      setToastMessage(t.ankiSuccess);
    } catch (err) { 
        alert(t.ankiError); 
    }
    finally { setIsAddingToAnki(false); }
  };

  const handleTrackSelect = (track: AudioTrack) => {
    setIsOpeningTrack(true);
    setTimeout(() => {
      setFileName(track.title);
      setCurrentTrackId(track.id);
      setSubtitles(track.subtitles || []); 
      setSecondarySubtitles(track.secondarySubtitles || []);
      setAudioSrc(track.url);
      setView('player');
      setIsOpeningTrack(false);
    }, 150);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>, category: 'music' | 'audiobook') => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsOpeningTrack(true);
    try {
      const { chapters, coverBlob } = await parseChapters(file);
      const newTrack: AudioTrack = {
        id: `track-${Date.now()}`,
        title: file.name.replace(/\.[^/.]+$/, ''),
        filename: file.name,
        url: URL.createObjectURL(file),
        category,
        file,
        chapters,
        coverBlob,
        cover: coverBlob ? URL.createObjectURL(coverBlob) : undefined,
        bookmarks: [],
        subtitles: [],
        secondarySubtitles: []
      };
      await saveTrackToDB(newTrack, file);
      setAudioTracks(prev => [...prev, newTrack]);
    } catch (err) {
      console.error("Failed to import audio:", err);
      alert(t.importError);
    } finally {
      e.target.value = '';
      setIsOpeningTrack(false);
    }
  };

  const handleImportSubtitle = async (trackId: string, file: File, isSecondary: boolean) => {
    try {
      const content = await file.text();
      const ext = file.name.split('.').pop()?.toLowerCase();
      let lines: SubtitleLine[] = [];
      if (ext === 'srt') lines = parseSRT(content);
      else if (ext === 'lrc') lines = parseLRC(content);
      else if (ext === 'vtt') lines = parseVTT(content);
      else if (ext === 'ass') lines = parseASS(content);
      
      const updates: Partial<AudioTrack> = isSecondary 
        ? { secondarySubtitles: lines, secondarySubtitleFileName: file.name }
        : { subtitles: lines, subtitleFileName: file.name };
      await updateTrackMetadataInDB(trackId, updates);
      
      if (currentTrackId === trackId) {
        if (isSecondary) setSecondarySubtitles(lines);
        else setSubtitles(lines);
      }
      setAudioTracks(prev => prev.map(t => t.id === trackId ? { ...t, ...updates } : t));
    } catch (err) {
      console.error("Failed to import subtitle:", err);
      alert(t.importError);
    }
  };

  const handleImportLink = async (url: string, category: 'music' | 'audiobook') => {
    setIsOpeningTrack(true);
    try {
      // Remove extension from title (e.g., .mp3, .m4b)
      const cleanTitle = url.split('/').pop()?.split('?')[0].replace(/\.[^/.]+$/, "") || "Remote Stream";

      const newTrack: AudioTrack = {
        id: `track-${Date.now()}`,
        title: cleanTitle,
        filename: "Remote Stream",
        url: url,
        category,
        bookmarks: [],
        subtitles: [],
        secondarySubtitles: []
      };
      
      await saveTrackToDB(newTrack, null as any);
      setAudioTracks(prev => [...prev, newTrack]);
    } catch (err) {
      console.error("Failed to import link:", err);
      alert(t.importError);
    } finally {
      setIsOpeningTrack(false);
    }
  };

  const handleReplaceFile = async (trackId: string, file: File) => {
    const trackToUpdate = audioTracks.find(t => t.id === trackId);
    if (!trackToUpdate) return;
    
    setIsOpeningTrack(true);
    try {
      if (trackToUpdate.url && trackToUpdate.file) {
        URL.revokeObjectURL(trackToUpdate.url);
      }

      const newUrl = URL.createObjectURL(file);
      const { chapters, coverBlob } = await parseChapters(file);

      const updates: Partial<AudioTrack> = {
        file,
        url: newUrl,
        filename: file.name,
        title: file.name.replace(/\.[^/.]+$/, ''),
        chapters,
        coverBlob,
        cover: coverBlob ? URL.createObjectURL(coverBlob) : undefined,
      };

      await updateTrackMetadataInDB(trackId, updates);
      setAudioTracks(prev => prev.map(t => t.id === trackId ? { ...t, ...updates } : t));
      
      if (currentTrackId === trackId && audioRef.current) {
        audioRef.current.src = newUrl;
        audioRef.current.load();
        safePlay();
      }
    } catch (err) {
      console.error("Failed to replace audio file:", err);
      alert(t.importError);
    } finally {
      setIsOpeningTrack(false);
    }
  };

  // New function to update URL for network tracks
  const handleUpdateTrackUrl = async (trackId: string, newUrl: string) => {
      const updates: Partial<AudioTrack> = {
          url: newUrl,
          title: newUrl.split('/').pop()?.split('?')[0].replace(/\.[^/.]+$/, "") || "Remote Stream", // Optional: update title if URL changes
      };
      await updateTrackMetadataInDB(trackId, updates);
      setAudioTracks(prev => prev.map(t => t.id === trackId ? { ...t, ...updates } : t));
      
      if (currentTrackId === trackId && audioRef.current) {
        audioRef.current.src = newUrl;
        audioRef.current.load();
        safePlay();
      }
  };

  return (
    // Use h-[100dvh] for mobile browsers to handle dynamic address bars correctly
    <div className="flex flex-col h-[100dvh] bg-slate-900 text-slate-200 font-sans select-none overflow-hidden">
      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      
      {/* Audio Element with iOS specific attributes */}
      <audio 
        ref={audioRef} 
        src={audioSrc || undefined} 
        onTimeUpdate={handleTimeUpdate} 
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          if (currentTrackId) updateTrackMetadataInDB(currentTrackId, {duration: e.currentTarget.duration});
          if (currentTrack?.lastPosition && audioRef.current && currentTrackId === currentTrack.id) {
            audioRef.current.currentTime = currentTrack.lastPosition;
          }
          safePlay();
        }} 
        onEnded={() => {
          setIsPlaying(false);
          if (currentTrackId && currentTrack) {
            updateTrackMetadataInDB(currentTrackId, { lastPosition: 0 });
          }
        }} 
        className="hidden" 
        playsInline={true} // Important for iOS
        crossOrigin={isIOS() ? undefined : "anonymous"} // iOS direct streams might fail with anonymous if not CORS enabled, undefined usually works better for simple playback
      />
      
      <header className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700 shadow-sm z-50 h-16 shrink-0">
         <div className="flex items-center gap-4 flex-1 min-w-0">
            <button onClick={() => { 
              if (currentTrackId && currentTrack && audioRef.current) {
                updateTrackMetadataInDB(currentTrackId, { lastPosition: audioRef.current.currentTime });
              }
              safePause(); 
              setView('library'); 
            }} className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center hover:bg-indigo-500 transition-colors active:scale-90"><i className="fa-solid fa-chevron-left text-white text-sm"></i></button>
            <h1 className="font-bold text-sm text-slate-200 truncate">{view === 'player' ? fileName : t.appTitle}</h1>
         </div>
         <div className="flex items-center gap-1">
            {view === 'player' && (
              <>
                <button onClick={() => handleOpenBookmarkModal()} className="p-2 text-slate-400 hover:text-white" title={t.addBookmark}>
                    <i className="fa-solid fa-bookmark text-lg"></i>
                </button>
                <button onClick={() => setShowSidePanel(!showSidePanel)} className="p-2 text-slate-400 hover:text-white"><i className="fa-solid fa-list-ul text-lg"></i></button>
              </>
            )}
            <button onClick={() => setShowSettings(true)} className="p-2 text-slate-400 hover:text-white"><i className="fa-solid fa-cog text-lg"></i></button>
         </div>
      </header>

      <div className="flex-1 overflow-hidden relative flex">
         <SettingsPanel 
           isOpen={showSettings} 
           onClose={() => setShowSettings(false)} 
           {...{
             language, setLanguage, learningLanguage, setLearningLanguage, gameType, setGameType, 
             playbackMode, setPlaybackMode, subtitleMode, setSubtitleMode, subtitleFontSize, setSubtitleFontSize, 
             keyBindings, setKeyBindings, ankiSettings, setAnkiSettings, speechEnabled: false, setSpeechEnabled: ()=>{}, 
             speechLang: 'en', setSpeechLang: ()=>{}, segmentationMode, setSegmentationMode, webSearchEngine, setWebSearchEngine
           }} 
         />
         <SidePanel 
           isOpen={showSidePanel} 
           onClose={() => setShowSidePanel(false)} 
           currentTrack={currentTrack} 
           chapters={currentTrack?.chapters || []} 
           bookmarks={currentTrack?.bookmarks || []} 
           onSeek={(t) => { if (audioRef.current) audioRef.current.currentTime = t; }} 
           onDeleteBookmark={async (id) => {
             if (!currentTrack) return;
             const updatedBookmarks = (currentTrack.bookmarks || []).filter(bm => bm.id !== id);
             await updateTrackMetadataInDB(currentTrack.id, { bookmarks: updatedBookmarks });
             setAudioTracks(prev => prev.map(t => t.id === currentTrack.id ? { ...t, bookmarks: updatedBookmarks } : t));
           }} 
           onEditBookmark={handleOpenBookmarkModal}
           language={language} 
         />
         {view === 'library' ? (
           <Library 
             tracks={audioTracks} 
             onTrackSelect={handleTrackSelect} 
             onTrackDelete={async (id)=>{ 
               await deleteTrackFromDB(id); 
               setAudioTracks(prev=>prev.filter(t=>t.id!==id)); 
               if (currentTrackId === id) {
                  setAudioSrc(null);
                  setCurrentTrackId(null);
                  setFileName("No file loaded");
                  setSubtitles([]);
                  setSecondarySubtitles([]);
               }
             }} 
             onTrackUpdate={async (id, up) => { 
               await updateTrackMetadataInDB(id, up);
               setAudioTracks(prev => prev.map(t => t.id === id ? { ...t, ...up } : t));
               if (currentTrackId === id && up.title) setFileName(up.title);
             }} 
             onImport={handleImport} 
             onReplaceFile={handleReplaceFile} 
             onUpdateTrackUrl={handleUpdateTrackUrl} // Pass new handler
             onImportLink={handleImportLink} 
             onImportSubtitle={handleImportSubtitle} 
             language={language} 
           />
         ) : (
           <div className="flex-1 flex flex-col relative w-full overflow-hidden">
              <SubtitleRenderer 
                subtitles={currentDisplaySubtitles} 
                activeSubtitleIndex={activeSubtitleIndex} 
                onSeek={(t) => { if (audioRef.current) audioRef.current.currentTime = t; }} 
                onAutoSegment={async () => {
                  if (!currentTrack || !currentTrack.file) return;
                  setIsScanning(true);
                  try {
                    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                    const arrayBuffer = await currentTrack.file.arrayBuffer();
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                    const newSubtitles = detectAudioSegments(audioBuffer);
                    await updateTrackMetadataInDB(currentTrack.id, { subtitles: newSubtitles });
                    setSubtitles(newSubtitles);
                  } catch (err) { alert(t.ankiError); }
                  finally { setIsScanning(false); }
                }} 
                isScanning={isScanning} 
                onWordClick={(word, line, index) => {
                  setWasPlayingBeforeModal(isPlaying); 
                  safePause(); 
                  setDictionaryTargetWord(word); 
                  setDictionaryTargetIndex(index); 
                  setDictionaryContext(line); 
                  setShowDictionaryModal(true);
                }} 
                onShiftTimeline={handleShiftTimeline}
                subtitleMode={subtitleMode}
                {...{gameType, language, learningLanguage, fontSize: subtitleFontSize, segmentationMode}} 
              />
              <PlayerControls 
                isPlaying={isPlaying} 
                currentTime={currentTime} 
                duration={duration} 
                playbackRate={playbackRate} 
                onPlayPause={() => isPlaying ? safePause() : safePlay()} 
                onSeek={(t) => { if (audioRef.current) audioRef.current.currentTime = t; }} 
                onForward={() => {
                  if (audioRef.current) {
                    // Check if we are before the first subtitle and have subtitles
                    if (currentDisplaySubtitles.length > 0 && currentTime < currentDisplaySubtitles[0].start) {
                        audioRef.current.currentTime = currentDisplaySubtitles[0].start;
                        return;
                    }

                    if (activeSubtitleIndex === -1 && currentDisplaySubtitles.length > 0) {
                      audioRef.current.currentTime = currentDisplaySubtitles[0].start;
                      setActiveSubtitleIndex(0); // Update index explicitly
                    } else if (activeSubtitleIndex !== -1 && activeSubtitleIndex < currentDisplaySubtitles.length - 1) {
                      const next = currentDisplaySubtitles[activeSubtitleIndex + 1];
                      audioRef.current.currentTime = next.start;
                      setActiveSubtitleIndex(activeSubtitleIndex + 1); // Update index explicitly to avoid loop trap
                    }
                  }
                }} 
                onRewind={() => {
                  if (activeSubtitleIndex !== -1 && activeSubtitleIndex > 0) {
                    const prev = currentDisplaySubtitles[activeSubtitleIndex - 1];
                    if (audioRef.current) audioRef.current.currentTime = prev.start;
                    setActiveSubtitleIndex(activeSubtitleIndex - 1); // Update index explicitly
                  } else if (audioRef.current) { 
                    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
                  }
                }} 
                onReplay={() => {
                  if (activeSubtitleIndex !== -1 && currentDisplaySubtitles[activeSubtitleIndex]) {
                    if (audioRef.current) audioRef.current.currentTime = currentDisplaySubtitles[activeSubtitleIndex].start;
                  } else if (audioRef.current) { 
                    audioRef.current.currentTime -= 3; 
                  }
                }} 
                onRateChange={(r) => {
                  if (audioRef.current) audioRef.current.playbackRate = r;
                  setPlaybackRate(r);
                }} 
                onABLoopToggle={() => {
                  if (loopA === null) setLoopA(currentTime);
                  else if (loopB === null) setLoopB(currentTime);
                  else { setLoopA(null); setLoopB(null); }
                }} 
                loopA={loopA} 
                loopB={loopB} 
                isSentenceRepeat={isSentenceRepeat} 
                onSentenceRepeatToggle={() => setIsSentenceRepeat(!isSentenceRepeat)} 
                language={language} 
                hasSecondarySubtitles={secondarySubtitles.length > 0} 
                onToggleSubtitleType={() => setActiveSubtitleType(p => p === 'primary' ? 'secondary' : 'primary')} 
                activeSubtitleType={activeSubtitleType} 
                onSaveBookmark={() => handleOpenBookmarkModal()}
              />
           </div>
         )}
      </div>

      <DictionaryModal 
        isOpen={showDictionaryModal} 
        onClose={() => { 
          setShowDictionaryModal(false); 
          if (wasPlayingBeforeModal) safePlay(); 
        }} 
        initialWord={dictionaryTargetWord} 
        initialSegmentIndex={dictionaryTargetIndex}
        sentence={dictionaryContext.text} 
        contextLine={dictionaryContext} 
        language={language} 
        learningLanguage={learningLanguage} 
        onAddToAnki={handleAddToAnki} 
        isAddingToAnki={isAddingToAnki} 
        variant="sidebar" 
        audioRef={audioRef} 
        hasAudioField={!!ankiSettings.fieldMap.audio} 
        segmentationMode={segmentationMode}
        webSearchEngine={webSearchEngine}
        currentTrack={currentTrack} // Pass currentTrack for file slicing
      />

      <BookmarkModal
        isOpen={showBookmarkModal}
        onClose={handleCloseBookmarkModal} 
        currentTime={audioRef.current?.currentTime || 0}
        currentTrackTitle={currentTrack?.title || "Unknown Track"}
        onSave={handleSaveBookmark}
        language={language}
        initialBookmark={editingBookmark}
      />

      {isOpeningTrack && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 backdrop-blur-xl">
           <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-sm font-bold text-indigo-400">{t.initializingMedia}</p>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
