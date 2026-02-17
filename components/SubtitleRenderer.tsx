
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
  onSentenceClick: (line: SubtitleLine) => void;
  onTextHover?: (event: React.MouseEvent, text: string, line: SubtitleLine, index: number) => void; 
  onTextClick?: (event: React.MouseEvent, text: string, line: SubtitleLine, index: number) => void; 
  segmentationMode: SegmentationMode;
  onAutoSegment: () => void;
  isScanning: boolean;
  onShiftTimeline: (seconds: number) => void;
  subtitleMode: SubtitleMode;
  dictMode: 'word' | 'sentence';
  yomitanMode: boolean; 
  yomitanHighlight?: { lineId: string; start: number; length: number; pinned?: boolean }; 
  showSubtitles?: boolean;
  onTranslateClick?: (event: React.MouseEvent, line: SubtitleLine) => void;
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
  onSentenceClick,
  onTextHover,
  onTextClick, 
  segmentationMode,
  dictMode,
  yomitanMode,
  yomitanHighlight,
  onTranslateClick,
  showSubtitles = true
}: any) => {
  const segments = useMemo(() => {
    if (!line.text.trim()) return [];
    if (yomitanMode) {
        return Array.from(line.text as string); 
    }
    return segmentText(line.text as string, learningLanguage as string, segmentationMode as SegmentationMode);
  }, [line.text, learningLanguage, segmentationMode, yomitanMode]);

  const renderContent = () => {
    if (!line.text.trim()) {
      const segmentIdMatch = line.id.match(/\d+/);
      return (
        <span className={`${isActive ? 'text-indigo-600 dark:text-indigo-200 font-bold' : 'text-slate-400 dark:text-slate-600'} italic text-[10px] uppercase tracking-widest`}>
          {t.segmentPrefix} {segmentIdMatch ? segmentIdMatch[0] : "0"}
        </span>
      );
    }

    if (!yomitanMode && dictMode === 'sentence') {
        return (
            <span
                className="cursor-pointer"
                onClick={(e) => {
                    e.stopPropagation();
                    if (showSubtitles) {
                        onSentenceClick(line);
                    }
                }}
            >
                {line.text}
            </span>
        );
    }

    let wordIndexCounter = 0;
    return segments.map((seg: string, idx: number) => {
      const isWordSegment = yomitanMode ? true : isWord(seg); 
      const currentWordIndex = isWordSegment ? wordIndexCounter++ : -1;
      const isHidden = gameType === 'cloze' && isActive && gameTargetLineId === line.id && gameHiddenWordIndex === currentWordIndex;
      
      if (isHidden) {
        return <span key={idx} className="inline-block mx-0.5 min-w-[2.5em] border-b-2 border-indigo-400 text-transparent bg-indigo-500/20 h-6 align-middle rounded-sm">{seg}</span>;
      }

      let spacing = '';
      if (!yomitanMode && segmentationMode !== 'none' && !isNonSpacedLang(learningLanguage)) {
        const prevSeg = segments[idx - 1];
        if (prevSeg && isWord(prevSeg) && isWordSegment) spacing = 'mr-1';
      }

      const isHighlighted = yomitanMode && yomitanHighlight && yomitanHighlight.lineId === line.id && idx >= yomitanHighlight.start && idx < yomitanHighlight.start + yomitanHighlight.length;
      const isPinned = isHighlighted && yomitanHighlight.pinned;

      let classes = `cursor-pointer transition-colors ${spacing} rounded-sm `;
      
      if (!showSubtitles) {
          classes += 'text-transparent bg-slate-200 dark:bg-slate-700/50 select-none ';
      } else if (isHighlighted) {
          if (isPinned) {
              classes += 'bg-indigo-300 dark:bg-indigo-600 text-slate-900 dark:text-white ';
          } else {
              classes += 'bg-indigo-100 dark:bg-indigo-500/30 ';
          }
      } else {
          if (!isWordSegment && !yomitanMode) classes += 'text-slate-400 dark:text-slate-500 ';
          classes += 'hover:bg-black/5 dark:hover:bg-white/10 ';
      }

      return (
        <span 
          key={idx} 
          onMouseEnter={(e) => {
              if (showSubtitles && yomitanMode && onTextHover) onTextHover(e, seg, line, idx);
          }}
          onClick={(e) => { 
              e.stopPropagation(); 
              if (showSubtitles) {
                  if (yomitanMode && onTextClick) onTextClick(e, seg, line, idx);
                  else if (!yomitanMode) onWordClick(seg, line, idx); 
              }
          }} 
          className={classes}
        >
          {seg}
        </span>
      );
    });
  };

  return (
    <div 
      // Disabled onClick seeking here as requested. Use SubtitleListPanel or prev/next controls for explicit seeking.
      className={`group relative flex items-center justify-center py-1 md:py-1.5 px-6 rounded-2xl text-center transition-all duration-300 ${
        isActive 
          ? 'bg-white dark:bg-slate-800/60 text-slate-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/20 shadow-xl scale-100 opacity-100' 
          : 'text-slate-400 dark:text-slate-500 opacity-40 scale-95'
      }`} 
      style={{ fontSize: isActive ? `${fontSize}px` : `${Math.max(12, fontSize * 0.85)}px`, willChange: 'transform, opacity' }}
    >
        <div className="inline-block leading-relaxed tracking-wide w-full overflow-hidden break-words flex-1 min-w-0">{renderContent()}</div>
        {isActive && yomitanMode && onTranslateClick && (
            <button
              onClick={(e) => { e.stopPropagation(); onTranslateClick(e, line); }}
              className="ml-2 p-2 text-slate-400 hover:text-indigo-500 shrink-0"
              title={t.sentenceTranslation}
            >
              <i className="fa-solid fa-language text-sm"></i>
            </button>
        )}
    </div>
  );
}, (prev, next) => {
  return (
      prev.isActive === next.isActive && 
      prev.line.id === next.line.id && 
      prev.fontSize === next.fontSize &&
      prev.yomitanMode === next.yomitanMode &&
      prev.yomitanHighlight === next.yomitanHighlight &&
      prev.dictMode === next.dictMode
  );
});

export const SubtitleRenderer: React.FC<SubtitleRendererProps> = memo(({ 
  subtitles, activeSubtitleIndex, onSeek, gameType, language, learningLanguage, fontSize, onWordClick, onSentenceClick, onTextHover, onTextClick, onTranslateClick, segmentationMode, onAutoSegment, isScanning, onShiftTimeline, subtitleMode, dictMode, yomitanMode, yomitanHighlight, showSubtitles = true
}) => {
  const t = getTranslation(language);
  const containerRef = useRef<HTMLDivElement>(null);
  const isLargeDataset = subtitles.length >= LARGE_DATASET_THRESHOLD;

  useEffect(() => {
    if (activeSubtitleIndex === -1) return;
    const targetContainer = containerRef.current;
    if (!targetContainer) return;
    
    let targetElement: HTMLElement | null = null;
    if (subtitleMode === 'single') targetElement = targetContainer.firstElementChild as HTMLElement;
    else if (isLargeDataset) {
        const startIndex = Math.max(0, activeSubtitleIndex - SLICE_RANGE);
        const relativeIndex = activeSubtitleIndex - startIndex;
        targetElement = targetContainer.children[relativeIndex] as HTMLElement;
    } else {
        targetElement = targetContainer.children[activeSubtitleIndex] as HTMLElement;
    }

    if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeSubtitleIndex, isLargeDataset, subtitleMode]);

  const visibleLines = useMemo(() => {
    if (subtitleMode === 'single') return activeSubtitleIndex !== -1 ? [subtitles[activeSubtitleIndex]] : [];
    if (!isLargeDataset) return subtitles;
    const start = Math.max(0, activeSubtitleIndex - SLICE_RANGE);
    const end = Math.min(subtitles.length, activeSubtitleIndex + SLICE_RANGE + 1);
    return subtitles.slice(start, end);
  }, [subtitles, activeSubtitleIndex, isLargeDataset, subtitleMode]);

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
      <div 
        ref={containerRef}
        className={`flex-1 p-4 md:p-6 space-y-2 md:space-y-3 no-scrollbar hardware-accelerated ${isLargeDataset && subtitleMode === 'scroll' ? 'overflow-hidden' : 'overflow-y-auto'} ${subtitleMode === 'single' ? 'flex items-center justify-center' : ''}`}
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
            onSentenceClick={onSentenceClick}
            onTextHover={onTextHover}
            onTextClick={onTextClick}
            onTranslateClick={onTranslateClick}
            segmentationMode={segmentationMode}
            dictMode={dictMode}
            yomitanMode={yomitanMode}
            yomitanHighlight={yomitanHighlight}
            showSubtitles={showSubtitles}
          />
        ))}
        {/* Spacer to ensure last item can be centered */}
        <div className="h-[50vh] shrink-0" />
      </div>
    </div>
  );
});
