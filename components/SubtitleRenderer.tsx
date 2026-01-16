
import React, { useEffect, useRef, useState, memo, useMemo, useCallback } from 'react';
import { SubtitleLine, Language, GameType, SegmentationMode, SubtitleMode } from '../types';
import { getTranslation } from '../utils/i18n';
import { segmentText, isWord, isNonSpacedLang } from '../utils/textUtils';

interface SubtitleRendererProps {
  subtitles: SubtitleLine[];
  activeSubtitleIndex: number;
  onSeek: (time: number) => void;
  gameType: GameType;
  gameTargetLineId?: string | null;
  gameHiddenWordIndex?: number | null;
  language: Language; 
  learningLanguage: string;
  fontSize: number;
  onWordClick: (word: string, line: SubtitleLine, index: number) => void;
  segmentationMode: SegmentationMode;
  onAutoSegment: () => void;
  isScanning: boolean;
  onShiftTimeline: (seconds: number) => void;
  subtitleMode: SubtitleMode;
}

const LARGE_DATASET_THRESHOLD = 100;
const SLICE_RANGE = 5;

const SubtitleItem = memo(({ 
  line, 
  isActive, 
  onSeek, 
  gameType, 
  gameTargetLineId, 
  gameHiddenWordIndex, 
  learningLanguage, 
  t, 
  fontSize, 
  onWordClick, 
  segmentationMode 
}: any) => {
  const segments = useMemo(() => {
    if (!line.text.trim()) return [];
    return segmentText(line.text, learningLanguage, segmentationMode);
  }, [line.text, learningLanguage, segmentationMode]);

  const renderContent = () => {
    if (!line.text.trim()) {
      const segmentIdMatch = line.id.match(/\d+/);
      return (
        <span className={`${isActive ? 'text-indigo-600 dark:text-indigo-200 font-bold' : 'text-slate-400 dark:text-slate-600'} italic text-[10px] uppercase tracking-widest`}>
          {t.segmentPrefix} {segmentIdMatch ? segmentIdMatch[0] : "0"}
        </span>
      );
    }

    let wordIndexCounter = 0;
    return segments.map((seg, idx) => {
      const isWordSegment = isWord(seg);
      const currentWordIndex = isWordSegment ? wordIndexCounter++ : -1;
      const isHidden = gameType === 'cloze' && isActive && gameTargetLineId === line.id && gameHiddenWordIndex === currentWordIndex;
      
      if (isHidden) {
        return <span key={idx} className="inline-block mx-0.5 min-w-[2.5em] border-b-2 border-indigo-400 text-transparent bg-indigo-500/20 h-6 align-middle rounded-sm">{seg}</span>;
      }

      let spacing = '';
      if (segmentationMode !== 'none' && !isNonSpacedLang(learningLanguage)) {
        const prevSeg = segments[idx - 1];
        if (prevSeg && isWord(prevSeg) && isWordSegment) {
          spacing = 'mr-1';
        }
      }

      return (
        <span 
          key={idx} 
          onClick={(e) => { e.stopPropagation(); onWordClick(seg, line, idx); }} 
          className={`cursor-pointer hover:text-indigo-500 dark:hover:text-indigo-400 active:text-indigo-400 dark:active:text-indigo-300 hover:underline transition-colors ${spacing} ${isWordSegment ? '' : 'text-slate-400 dark:text-slate-500'}`}
        >
          {seg}
        </span>
      );
    });
  };

  return (
    <div 
      onClick={() => onSeek(line.start)}
      className={`relative py-1 md:py-1.5 px-6 rounded-2xl text-center cursor-pointer transition-all duration-300 ${
        isActive 
          ? 'bg-white dark:bg-slate-800/60 text-slate-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/20 shadow-xl scale-100 opacity-100' 
          : 'text-slate-400 dark:text-slate-500 opacity-40 scale-95 hover:opacity-80'
      }`} 
      style={{ fontSize: isActive ? `${fontSize}px` : `${Math.max(12, fontSize * 0.85)}px`, willChange: 'transform, opacity' }}
    >
      <div className="inline-block leading-relaxed tracking-wide w-full overflow-hidden break-words">{renderContent()}</div>
    </div>
  );
}, (prev, next) => (
  prev.isActive === next.isActive && 
  prev.line.id === next.line.id && 
  prev.gameType === next.gameType && 
  prev.fontSize === next.fontSize &&
  prev.segmentationMode === next.segmentationMode && 
  prev.line.text === next.line.text
));

export const SubtitleRenderer: React.FC<SubtitleRendererProps> = memo(({ 
  subtitles, activeSubtitleIndex, onSeek, gameType, language, learningLanguage, fontSize, onWordClick, segmentationMode, onAutoSegment, isScanning, onShiftTimeline, subtitleMode
}) => {
  const t = getTranslation(language);
  const containerRef = useRef<HTMLDivElement>(null);
  const fullListContainerRef = useRef<HTMLDivElement>(null);
  const [showFullList, setShowFullList] = useState(false);
  const [shiftValue, setShiftValue] = useState(0);

  const isLargeDataset = subtitles.length >= LARGE_DATASET_THRESHOLD;

  useEffect(() => {
    if (activeSubtitleIndex === -1 || showFullList) return;

    const targetContainer = containerRef.current;
    if (!targetContainer) return;

    let targetElement: HTMLElement | null = null;
    
    if (subtitleMode === 'single') {
        targetElement = targetContainer.firstElementChild as HTMLElement;
    } else if (isLargeDataset) {
        const startIndex = Math.max(0, activeSubtitleIndex - SLICE_RANGE);
        const relativeIndex = activeSubtitleIndex - startIndex;
        targetElement = targetContainer.children[relativeIndex] as HTMLElement;
    } else {
        targetElement = targetContainer.children[activeSubtitleIndex] as HTMLElement;
    }
    
    if (targetElement) {
        const containerRect = targetContainer.getBoundingClientRect();
        const elementRect = targetElement.getBoundingClientRect();
        
        const isCentered = (elementRect.top > containerRect.top + containerRect.height * 0.3) &&
                           (elementRect.bottom < containerRect.bottom - containerRect.height * 0.3);

        if (!isCentered) {
            requestAnimationFrame(() => {
                targetElement!.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        }
    }
  }, [activeSubtitleIndex, isLargeDataset, showFullList, subtitleMode]);

  useEffect(() => {
    if (showFullList && fullListContainerRef.current && activeSubtitleIndex !== -1) {
      const activeElementInFullList = fullListContainerRef.current.children[activeSubtitleIndex] as HTMLElement;
      if (activeElementInFullList) {
        activeElementInFullList.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    }
  }, [showFullList, activeSubtitleIndex]);


  const visibleLines = useMemo(() => {
    if (subtitleMode === 'single') {
      return activeSubtitleIndex !== -1 ? [subtitles[activeSubtitleIndex]] : [];
    }

    if (!isLargeDataset || showFullList) {
      return subtitles;
    }
    
    const start = Math.max(0, activeSubtitleIndex - SLICE_RANGE);
    const end = Math.min(subtitles.length, activeSubtitleIndex + SLICE_RANGE + 1);
    return subtitles.slice(start, end);
  }, [subtitles, activeSubtitleIndex, isLargeDataset, showFullList, subtitleMode]);

  if (subtitles.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 dark:text-slate-600">
        <i className="fa-solid fa-quote-left text-4xl mb-6 opacity-10"></i>
        <p className="text-lg font-bold mb-8 opacity-40">{t.noSubtitles}</p>
        <button onClick={onAutoSegment} disabled={isScanning} className="px-10 py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-black rounded-2xl shadow-indigo-600/20 transition-all disabled:opacity-50">
          {isScanning ? t.scanning : t.autoScan}
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 relative flex flex-col overflow-hidden transition-colors duration-300">
      {/* Toolbar */}
      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm p-1.5 flex items-center justify-center gap-3 border-b border-gray-200 dark:border-white/5 shrink-0 z-20 transition-colors">
        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{t.adjustTiming}</span>
        <div className="flex items-center gap-1">
          <input 
            type="number" step="0.1" value={shiftValue} 
            onChange={(e) => setShiftValue(parseFloat(e.target.value))}
            className="w-14 bg-gray-100 dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-800 dark:text-white"
          />
          <button onClick={() => onShiftTimeline(shiftValue)} className="px-2 py-0.5 bg-indigo-600 text-[9px] font-bold rounded hover:bg-indigo-500 text-white">{t.apply}</button>
        </div>
        {isLargeDataset && subtitleMode === 'scroll' && (
          <button onClick={() => setShowFullList(true)} className="ml-2 w-7 h-7 flex items-center justify-center bg-gray-200 dark:bg-slate-700/50 rounded-full text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-white transition-colors" title={t.chapters}>
            <i className="fa-solid fa-list-ul text-xs"></i>
          </button>
        )}
      </div>

      <div 
        ref={containerRef}
        className={`flex-1 p-4 md:p-6 space-y-2 md:space-y-3 no-scrollbar hardware-accelerated ${isLargeDataset && subtitleMode === 'scroll' && !showFullList ? 'overflow-hidden' : 'overflow-y-auto'} ${subtitleMode === 'single' ? 'flex items-center justify-center' : ''}`}
      >
        {visibleLines.map((line) => (
          <SubtitleItem 
            key={line.id} 
            line={line}
            isActive={subtitles.indexOf(line) === activeSubtitleIndex}
            onSeek={onSeek}
            gameType={gameType}
            learningLanguage={learningLanguage}
            t={t}
            fontSize={fontSize}
            onWordClick={onWordClick}
            segmentationMode={segmentationMode}
          />
        ))}
        <div className="h-64 shrink-0" />
      </div>

      {/* Full List Overlay */}
      {showFullList && (
        <div className="fixed inset-0 z-[150] bg-white/95 dark:bg-slate-950/95 backdrop-blur-2xl flex flex-col animate-fade-in transition-colors">
          <div className="p-4 border-b border-gray-200 dark:border-white/10 flex justify-between items-center bg-gray-50 dark:bg-slate-900">
            <h3 className="font-black text-xs uppercase tracking-widest text-indigo-500 dark:text-indigo-400">{t.chapters}</h3>
            <button onClick={() => setShowFullList(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors">✕</button>
          </div>
          <div ref={fullListContainerRef} className="flex-1 overflow-y-auto p-4 space-y-1 no-scrollbar">
            {subtitles.map((line, idx) => (
              <div 
                key={line.id} 
                onClick={() => { onSeek(line.start); setShowFullList(false); }}
                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${idx === activeSubtitleIndex ? 'bg-indigo-600 text-white shadow-lg' : 'hover:bg-gray-100 dark:hover:bg-white/5 text-slate-500 dark:text-slate-400'}`}
              >
                <span className="text-[9px] opacity-50 font-mono w-12 shrink-0">{(line.start).toFixed(1)}s</span>
                <span className="text-sm truncate">{line.text || `[${t.segmentPrefix} ${idx}]`}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});