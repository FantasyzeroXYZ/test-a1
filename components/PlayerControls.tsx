
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
  onSaveBookmark: () => void; // New prop for saving bookmark
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
}) => {
  const t = getTranslation(language);
  
  // AB Loop Label logic
  let abLabel = "AB";
  if (loopA !== null && loopB === null) abLabel = "A-";
  else if (loopA !== null && loopB !== null) abLabel = "A-B";

  const controlBtnClass = "text-slate-300 hover:text-white p-2 rounded-full hover:bg-slate-700 transition-all active:scale-90 flex items-center justify-center";

  return (
    // Add pb-[calc(1.5rem+env(safe-area-inset-bottom))] to handle iPhone/iPad home bar and browser chrome overlap (like Kiwi)
    <div className="bg-slate-800/90 backdrop-blur-md border-t border-slate-700 p-4 sticky bottom-0 z-50 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      {/* Progress Bar */}
      <div className="flex items-center gap-3 mb-4 text-xs font-mono text-slate-400">
        <span className="w-10 text-right">{formatTime(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="flex-grow h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all"
        />
        <span className="w-10">{formatTime(duration)}</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        {/* Left Actions */}
        <div className="flex items-center gap-2 w-32 shrink-0">
          {hasSecondarySubtitles && (
            <button 
              onClick={onToggleSubtitleType} 
              className={`text-[10px] font-bold px-2 py-1 rounded border transition-colors ${activeSubtitleType === 'secondary' ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg' : 'border-slate-600 text-slate-400 hover:text-white'}`}
              title={activeSubtitleType === 'secondary' ? t.hasTrans : t.hasSubs}
            >
              {activeSubtitleType === 'secondary' ? 'TR' : 'SUB'}
            </button>
          )}
          <select 
            value={playbackRate} 
            onChange={(e) => onRateChange(Number(e.target.value))} 
            className="bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold py-1 px-1.5 rounded-lg border-none outline-none cursor-pointer transition-colors"
            title={t.playbackMode}
          >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate}x</option>)}
          </select>
        </div>

        {/* Center Playback Controls */}
        <div className="flex items-center gap-2 md:gap-5 justify-center flex-1">
          {/* Sentence Repeat Button (Cycle Button) */}
          <button 
            onClick={onSentenceRepeatToggle} 
            className={`w-10 h-10 relative flex items-center justify-center rounded-full transition-all active:scale-90 shrink-0 ${isSentenceRepeat ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
            title={t.replay}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {isSentenceRepeat && <span className="absolute text-[8px] font-bold bottom-1 right-1">1</span>}
          </button>

          {/* Prev Line */}
          <button onClick={onRewind} className={controlBtnClass} title={t.keyRewind}>
             <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M8.445 14.832A1 1 0 0010 14V6a1 1 0 00-1.555-.832l-6 4a1 1 0 000 1.664l6 4zM16.445 14.832A1 1 0 0018 14V6a1 1 0 00-1.555-.832l-6 4a1 1 0 000 1.664l6 4z" /></svg>
          </button>

          {/* Play/Pause */}
          <button onClick={onPlayPause} className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-full p-3 shadow-lg shadow-indigo-500/30 transition-all hover:scale-105 active:scale-95 shrink-0" title={t.keyPlayPause}>
            {isPlaying ? (
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path fillRule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clipRule="evenodd" /></svg>
            ) : (
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" /></svg>
            )}
          </button>

          {/* Next Line */}
          <button onClick={onForward} className={controlBtnClass} title={t.keyForward}>
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M4.555 5.168A1 1 0 003 6v8a1 1 0 001.555.832l6-4a1 1 0 000-1.664l-6-4zM11.555 5.168A1 1 0 0010 6v8a1 1 0 001.555.832l6-4a1 1 0 000-1.664l-6-4z" /></svg>
          </button>

          {/* AB Loop Button */}
          <button 
            onClick={onABLoopToggle} 
            className={`min-w-[44px] h-10 px-2 flex items-center justify-center text-xs font-bold rounded-full transition-all active:scale-90 shrink-0 ${loopA !== null ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
            title={t.loop}
          >
            {abLabel}
          </button>
        </div>

        {/* Right Space */}
        <div className="w-32 shrink-0"></div>
      </div>
    </div>
  );
};
