
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
import { BookmarkModal } from './components/BookmarkModal'; // Import new BookmarkModal

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
  const [webSearchEngine, setWebSearchEngine] = useState<WebSearchEngine>(() => loadConfig('lf_webSearchEngine', 'google')); // New setting

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
  const [wasPlayingBeforeModal, setWasPlayingBeforeModal] = useState(false); // For modal audio control


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
    // Only update currentTime state if there's a significant difference to avoid excessive re-renders
    if (Math.abs(currentTime - curr) > 0.1) {
        setCurrentTime(curr);
    }
    
    if (loopA !== null && loopB !== null && curr >= loopB) {
      audioRef.current.currentTime = loopA;
      return;
    }

    const newIdx = findSubtitleIndex(currentDisplaySubtitles, curr);
    
    // Logic to prevent subtitle "flashback":
    // If a new subtitle is found and it's different, update to the new index.
    if (newIdx !== -1 && newIdx !== activeSubtitleIndex) {
      setActiveSubtitleIndex(newIdx);
    } 
    // If no subtitle is currently active (newIdx === -1) BUT there was an active subtitle before (activeSubtitleIndex !== -1),
    // and we are moving into a gap *between* subtitles, keep the previous activeSubtitleIndex.
    // This prevents the subtitle area from briefly becoming blank/unhighlighted.
    else if (newIdx === -1 && activeSubtitleIndex !== -1) {
      // Do nothing, keep activeSubtitleIndex as is (showing the last subtitle)
    }
    // If newIdx is -1 and activeSubtitleIndex is already -1 (e.g., at very beginning or end), no change needed.
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
      // Edit existing bookmark
      updatedBookmarks = (currentTrack.bookmarks || []).map(b => b.id === bookmark.id ? bookmark : b);
    } else {
      // Add new bookmark
      const newBookmark: Bookmark = {
        ...bookmark,
        id: `bm-${Date.now()}`,
        createdAt: Date.now(),
      };
      updatedBookmarks = [...(currentTrack.bookmarks || []), newBookmark];
    }
    
    await updateTrackMetadataInDB(currentTrack.id, { bookmarks: updatedBookmarks });
    setAudioTracks(prev => prev.map(t => t.id === currentTrack.id ? { ...t, bookmarks: updatedBookmarks } : t));
    
    // Close modal and resume playback if it was playing before
    setShowBookmarkModal(false); 
    setEditingBookmark(null); 
    if (wasPlayingBeforeModal) {
      safePlay();
    }
  };

  const handleOpenBookmarkModal = (bookmark?: Bookmark) => {
    setEditingBookmark(bookmark || null);
    setWasPlayingBeforeModal(isPlaying); // Store current play state
    safePause(); // Pause audio
    setShowBookmarkModal(true);
  };

  const handleCloseBookmarkModal = () => {
    setShowBookmarkModal(false);
    setEditingBookmark(null);
    if (wasPlayingBeforeModal) { // Resume playback if it was playing before modal opened
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
        sentence: sentence, // Use the sentence passed from DictionaryModal (which may include bold tags)
        translation: '',
        audioBase64: recordedAudioBase64
      });
      alert(t.ankiSuccess);
    } catch (err) { alert(t.ankiError); }
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

  // 恢复导入逻辑
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
        url: URL.createObjectURL(file), // Create a temporary URL for immediate playback
        category,
        file, // Store the File object for IndexedDB
        chapters,
        coverBlob,
        cover: coverBlob ? URL.createObjectURL(coverBlob) : undefined,
        bookmarks: [],
        subtitles: [],
        secondarySubtitles: []
      };
      await saveTrackToDB(newTrack, file); // Save File object
      setAudioTracks(prev => [...prev, newTrack]);
    } catch (err) {
      console.error("Failed to import audio:", err);
      alert(t.importError);
    } finally {
      e.target.value = ''; // Clear input to allow re-importing same file
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
      const newTrack: AudioTrack = {
        id: `track-${Date.now()}`,
        title: url.split('/').pop()?.split('?')[0] || "Remote Stream",
        filename: "Remote Stream", // No file object for remote streams
        url: url,
        category,
        bookmarks: [],
        subtitles: [],
        secondarySubtitles: []
      };
      await saveTrackToDB(newTrack, null as any); // Pass null for file as it's a remote stream
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
      // Release old URL object if it exists
      if (trackToUpdate.url && trackToUpdate.file) {
        URL.revokeObjectURL(trackToUpdate.url);
      }

      // Create new URL for the new file
      const newUrl = URL.createObjectURL(file);
      const { chapters, coverBlob } = await parseChapters(file);

      const updates: Partial<AudioTrack> = {
        file,
        url: newUrl,
        filename: file.name,
        title: file.name.replace(/\.[^/.]+$/, ''), // Update title based on new file name
        chapters,
        coverBlob,
        cover: coverBlob ? URL.createObjectURL(coverBlob) : undefined,
      };

      await updateTrackMetadataInDB(trackId, updates);
      setAudioTracks(prev => prev.map(t => t.id === trackId ? { ...t, ...updates } : t));
      
      // If currently playing, update audio source and re-play
      if (currentTrackId === trackId && audioRef.current) {
        audioRef.current.src = newUrl;
        audioRef.current.load(); // Reload the new audio
        safePlay(); // Attempt to play automatically
      }
    } catch (err) {
      console.error("Failed to replace audio file:", err);
      alert(t.importError);
    } finally {
      setIsOpeningTrack(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-200 font-sans select-none overflow-hidden">
      <audio ref={audioRef} src={audioSrc || undefined} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={(e) => {
        setDuration(e.currentTarget.duration);
        if (currentTrackId) updateTrackMetadataInDB(currentTrackId, {duration: e.currentTarget.duration});
        // Check for pending seek
        if (currentTrack?.lastPosition && audioRef.current && currentTrackId === currentTrack.id) {
          audioRef.current.currentTime = currentTrack.lastPosition;
        }
        safePlay();
      }} onEnded={() => {
        setIsPlaying(false);
        // Save last position for current track
        if (currentTrackId && currentTrack) {
          updateTrackMetadataInDB(currentTrackId, { lastPosition: 0 }); // Reset to 0 on end
        }
      }} className="hidden" />
      
      <header className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700 shadow-sm z-50 h-16 shrink-0">
         <div className="flex items-center gap-4 flex-1 min-w-0">
            <button onClick={() => { 
              if (currentTrackId && currentTrack && audioRef.current) {
                // Save last position before leaving player view
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
                {/* Changed 't.addBookmarkQuick' to 't.addBookmark' */}
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
           onEditBookmark={handleOpenBookmarkModal} // Pass the edit handler
           language={language} 
         />
         {view === 'library' ? (
           <Library 
             tracks={audioTracks} 
             onTrackSelect={handleTrackSelect} 
             onTrackDelete={async (id)=>{ 
               await deleteTrackFromDB(id); 
               setAudioTracks(prev=>prev.filter(t=>t.id!==id)); 
               if (currentTrackId === id) { // If deleting the currently playing track
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
               if (currentTrackId === id && up.title) setFileName(up.title); // Update file name if current track
             }} 
             onImport={handleImport} 
             onReplaceFile={handleReplaceFile} 
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
                  setWasPlayingBeforeModal(isPlaying); // Store play state before pausing for dictionary
                  safePause(); 
                  setDictionaryTargetWord(word); 
                  setDictionaryTargetIndex(index); 
                  setDictionaryContext(line); 
                  setShowDictionaryModal(true);
                }} 
                onShiftTimeline={handleShiftTimeline}
                subtitleMode={subtitleMode} // Pass subtitleMode to renderer
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
                    if (activeSubtitleIndex === -1 && currentDisplaySubtitles.length > 0) {
                      // If no subtitle is active but subtitles exist, jump to the first one
                      audioRef.current.currentTime = currentDisplaySubtitles[0].start;
                    } else if (activeSubtitleIndex !== -1 && activeSubtitleIndex < currentDisplaySubtitles.length - 1) {
                      const next = currentDisplaySubtitles[activeSubtitleIndex + 1];
                      audioRef.current.currentTime = next.start;
                    }
                  }
                }} 
                onRewind={() => {
                  if (activeSubtitleIndex !== -1 && activeSubtitleIndex > 0) {
                    const prev = currentDisplaySubtitles[activeSubtitleIndex - 1];
                    if (audioRef.current) audioRef.current.currentTime = prev.start;
                  } else if (audioRef.current) { // If at the first subtitle or no active, rewind a bit
                    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
                  }
                }} 
                onReplay={() => {
                  if (activeSubtitleIndex !== -1 && currentDisplaySubtitles[activeSubtitleIndex]) {
                    if (audioRef.current) audioRef.current.currentTime = currentDisplaySubtitles[activeSubtitleIndex].start;
                  } else if (audioRef.current) { // If no active subtitle, replay from current time
                    audioRef.current.currentTime -= 3; // Rewind a few seconds
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
          if (wasPlayingBeforeModal) safePlay(); // Resume playback if it was playing before opening dictionary
        }} 
        initialWord={dictionaryTargetWord} 
        initialSegmentIndex={dictionaryTargetIndex}
        sentence={dictionaryContext.text} 
        contextLine={dictionaryContext} 
        language={language} 
        learningLanguage={learningLanguage} 
        onAddToAnki={handleAddToAnki} // Note: This function signature was changed in App to accept sentence
        isAddingToAnki={isAddingToAnki} 
        variant="sidebar" 
        audioRef={audioRef} 
        hasAudioField={!!ankiSettings.fieldMap.audio} 
        segmentationMode={segmentationMode}
        webSearchEngine={webSearchEngine}
      />

      <BookmarkModal
        isOpen={showBookmarkModal}
        onClose={handleCloseBookmarkModal} // Use new handler
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
