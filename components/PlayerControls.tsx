
import React from 'react';
import { formatTime } from '../utils/parsers';
import { Language } from '../types';
import { getTranslation } from '../utils/i18n';

interface PlayerControlsProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  onForward: () => void;
  onRewind: () => void;
  onReplay: () => void;
  onRateChange: (rate: number) => void;
  onABLoopToggle: () => void;
  loopA: number | null;
  loopB: number | null;
  isSentenceRepeat: boolean;
  onSentenceRepeatToggle: () => void;
  language: Language;
  hasSecondarySubtitles: boolean;
  onToggleSubtitleType: () => void;
  activeSubtitleType: 'primary' | 'secondary';
  onSaveBookmark: () => void;
  ttsEnabled: boolean;
  onTTSToggle: () => void;
  onToggleSidePanel: () => void;
  showSubtitles?: boolean;
  onToggleShowSubtitles?: () => void;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  onPlayPause,
  onSeek,
  onForward,
  onRewind,
  onReplay,
  onRateChange,
  onABLoopToggle,
  loopA,
  loopB,
  isSentenceRepeat,
  onSentenceRepeatToggle,
  language,
  hasSecondarySubtitles,
  onToggleSubtitleType,
  activeSubtitleType,
  onSaveBookmark,
  ttsEnabled,
  onTTSToggle,
  onToggleSidePanel,
  showSubtitles,
  onToggleShowSubtitles
}) => {
  const t = getTranslation(language);
  
  let abLabel = "AB";
  if (loopA !== null && loopB === null) abLabel = "A-";
  else if (loopA !== null && loopB !== null) abLabel = "A-B";

  const controlBtnClass = "text-slate-500 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white p-2 rounded-full hover:bg-gray-200 dark:hover:bg-slate-700 transition-all active:scale-90 flex items-center justify-center";

  return (
    <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl border-t border-gray-200 dark:border-slate-700 w-full sticky bottom-0 z-50 pt-2 px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-2xl transition-colors duration-300">
      
      {/* Progress Bar Row */}
      <div className="flex items-center gap-3 mb-2 text-[10px] md:text-xs font-mono text-slate-500 dark:text-slate-400">
        <span className="w-8 md:w-10 text-right">{formatTime(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="flex-grow h-1.5 md:h-2 bg-gray-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600 hover:accent-indigo-500 transition-all"
        />
        <span className="w-8 md:w-10">{formatTime(duration)}</span>
      </div>

      {/* Controls Grid */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        
        {/* Left: Sidebar, Speed, Subs */}
        <div className="flex items-center gap-2 justify-start min-w-0 overflow-x-auto no-scrollbar">
          <button 
             onClick={onToggleSidePanel}
             className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-700/50 hover:bg-gray-200 dark:hover:bg-slate-600 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-indigo-500 transition-colors"
             title="Toggle Sidebar"
          >
             <i className="fa-solid fa-list-ul text-xs"></i>
          </button>
          
          <select 
            value={playbackRate} 
            onChange={(e) => onRateChange(Number(e.target.value))} 
            className="w-12 bg-gray-100 dark:bg-slate-700/50 hover:bg-gray-200 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-[10px] md:text-xs font-bold py-1.5 px-1 rounded-lg border border-gray-300 dark:border-slate-600 outline-none cursor-pointer transition-colors"
            title={t.playbackMode}
          >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate}x</option>)}
          </select>
          
          {hasSecondarySubtitles && (
            <button 
              onClick={onToggleSubtitleType} 
              className={`text-[10px] md:text-xs font-bold px-2 py-1.5 rounded-lg border transition-colors ${activeSubtitleType === 'secondary' ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm' : 'border-gray-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white bg-gray-100 dark:bg-slate-700/30'}`}
              title={activeSubtitleType === 'secondary' ? t.hasTrans : t.hasSubs}
            >
              {activeSubtitleType === 'secondary' ? 'TR' : 'SUB'}
            </button>
          )}
        </div>

        {/* Center: Playback Controls (Always Centered) */}
        <div className="flex items-center gap-1 md:gap-4 justify-center">
          {/* Sentence Repeat */}
          <button 
            onClick={onSentenceRepeatToggle} 
            className={`w-8 h-8 md:w-10 md:h-10 relative flex items-center justify-center rounded-full transition-all active:scale-90 ${isSentenceRepeat ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
            title={t.replay}
          >
            <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {isSentenceRepeat && <span className="absolute text-[8px] font-bold bottom-0 right-0 md:bottom-1 md:right-1 bg-white dark:bg-slate-900 text-indigo-600 dark:text-white rounded-full w-3 h-3 flex items-center justify-center shadow">1</span>}
          </button>

          {/* Prev */}
          <button onClick={onRewind} className={controlBtnClass} title={t.keyRewind}>
             <svg className="w-5 h-5 md:w-7 md:h-7" fill="currentColor" viewBox="0 0 20 20"><path d="M8.445 14.832A1 1 0 0010 14V6a1 1 0 00-1.555-.832l-6 4a1 1 0 000 1.664l6 4zM16.445 14.832A1 1 0 0018 14V6a1 1 0 00-1.555-.832l-6 4a1 1 0 000 1.664l6 4z" /></svg>
          </button>

          {/* Play/Pause Main Button */}
          <button onClick={onPlayPause} className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-full p-3 md:p-4 shadow-xl shadow-indigo-600/30 transition-all hover:scale-105 active:scale-95 mx-1" title={t.keyPlayPause}>
            {isPlaying ? (
              <svg className="w-6 h-6 md:w-8 md:h-8" fill="currentColor" viewBox="0 0 24 24"><path fillRule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clipRule="evenodd" /></svg>
            ) : (
              <svg className="w-6 h-6 md:w-8 md:h-8 ml-1" fill="currentColor" viewBox="0 0 24 24"><path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" /></svg>
            )}
          </button>

          {/* Next */}
          <button onClick={onForward} className={controlBtnClass} title={t.keyForward}>
            <svg className="w-5 h-5 md:w-7 md:h-7" fill="currentColor" viewBox="0 0 20 20"><path d="M4.555 5.168A1 1 0 003 6v8a1 1 0 001.555.832l6-4a1 1 0 000-1.664l-6-4zM11.555 5.168A1 1 0 0010 6v8a1 1 0 001.555.832l6-4a1 1 0 000-1.664l-6-4z" /></svg>
          </button>
        </div>

        {/* Right: Loop / Extras */}
        <div className="flex items-center gap-2 justify-end">
          <button 
            onClick={onABLoopToggle} 
            className={`h-8 md:h-9 px-3 rounded-lg text-[10px] md:text-xs font-bold transition-all border ${loopA !== null ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm' : 'border-gray-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white bg-gray-100 dark:bg-slate-700/30'}`}
            title={t.loop}
          >
            {abLabel}
          </button>
          
          {/* Subtitle Toggle Button */}
          {onToggleShowSubtitles && (
            <button 
              onClick={onToggleShowSubtitles} 
              className={`h-8 md:h-9 px-3 rounded-lg text-[10px] md:text-xs font-bold transition-all border flex items-center justify-center ${showSubtitles ? 'bg-white dark:bg-slate-700 border-gray-300 dark:border-slate-600 text-slate-600 dark:text-slate-300' : 'bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-slate-400 opacity-70'}`}
              title="Toggle Subtitles"
            >
              {showSubtitles ? <i className="fa-solid fa-closed-captioning text-sm"></i> : <i className="fa-regular fa-closed-captioning text-sm"></i>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
