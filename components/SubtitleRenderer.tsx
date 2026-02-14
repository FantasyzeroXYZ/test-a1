
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
  onTextHover?: (event: React.MouseEvent, text: string, line: SubtitleLine, index: number) => void; // For Yomitan Mode Hover
  onTextClick?: (event: React.MouseEvent, text: string, line: SubtitleLine, index: number) => void; // For Yomitan Mode Click (Pin)
  segmentationMode: SegmentationMode;
  onAutoSegment: () => void;
  isScanning: boolean;
  onShiftTimeline: (seconds: number) => void;
  subtitleMode: SubtitleMode;
  yomitanMode: boolean; // Prop to enable character-based rendering
  yomitanHighlight?: { lineId: string; start: number; length: number; pinned?: boolean }; // Added pinned prop
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
  onTextHover,
  onTextClick, 
  segmentationMode,
  yomitanMode,
  yomitanHighlight
}: any) => {
  const segments = useMemo(() => {
    if (!line.text.trim()) return [];
    // If Yomitan mode is enabled, we treat every character as a "segment" for precise clicking/hovering
    if (yomitanMode) {
        return Array.from(line.text); // Unicode safe split
    }
    return segmentText(line.text, learningLanguage, segmentationMode);
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

    let wordIndexCounter = 0;
    return segments.map((seg: string, idx: number) => {
      // In Yomitan mode, we don't do word checks or spacing logic in the same way
      const isWordSegment = yomitanMode ? true : isWord(seg); 
      const currentWordIndex = isWordSegment ? wordIndexCounter++ : -1;
      const isHidden = gameType === 'cloze' && isActive && gameTargetLineId === line.id && gameHiddenWordIndex === currentWordIndex;
      
      if (isHidden) {
        return <span key={idx} className="inline-block mx-0.5 min-w-[2.5em] border-b-2 border-indigo-400 text-transparent bg-indigo-500/20 h-6 align-middle rounded-sm">{seg}</span>;
      }

      let spacing = '';
      if (!yomitanMode && segmentationMode !== 'none' && !isNonSpacedLang(learningLanguage)) {
        const prevSeg = segments[idx - 1];
        if (prevSeg && isWord(prevSeg) && isWordSegment) {
          spacing = 'mr-1';
        }
      }

      // Check for Yomitan Highlight - Using unicode character index logic
      const isHighlighted = yomitanMode && yomitanHighlight && yomitanHighlight.lineId === line.id && idx >= yomitanHighlight.start && idx < yomitanHighlight.start + yomitanHighlight.length;
      const isPinned = isHighlighted && yomitanHighlight.pinned;

      // Class Logic:
      // 1. Base cursor
      // 2. Hover underline ONLY if NOT in yomitan mode
      // 3. Highlight background if matched 
      // 4. Color logic
      
      let classes = `cursor-pointer transition-colors ${spacing} `;
      
      if (!yomitanMode) {
          classes += 'hover:underline hover:text-indigo-500 dark:hover:text-indigo-400 active:text-indigo-400 dark:active:text-indigo-300 ';
      }

      if (isHighlighted) {
          // Visual difference: Pinned (Clicked) is darker/stronger than Hover
          if (isPinned) {
              classes += 'bg-indigo-600 text-white rounded-sm shadow-sm ';
          } else {
              classes += 'bg-indigo-400 text-white rounded-sm ';
          }
      } else {
          // Normal text color logic
          if (!isWordSegment && !yomitanMode) {
              classes += 'text-slate-400 dark:text-slate-500 ';
          }
          // In yomitan mode, subtle hover effect on characters
          if (yomitanMode) {
             classes += 'hover:bg-indigo-100 dark:hover:bg-indigo-900/30 '; 
          }
      }

      return (
        <span 
          key={idx} 
          onMouseEnter={(e) => {
              if (yomitanMode && onTextHover) {
                  onTextHover(e, seg, line, idx);
              }
          }}
          onClick={(e) => { 
              e.stopPropagation(); 
              if (yomitanMode && onTextClick) {
                  onTextClick(e, seg, line, idx);
              } else if (!yomitanMode) {
                  onWordClick(seg, line, idx); 
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
}, (prev, next) => {
  // Optimization: Custom comparison to prevent re-render of unrelated lines during hover highlighting
  const basicPropsEqual = (
      prev.isActive === next.isActive && 
      prev.line.id === next.line.id && 
      prev.gameType === next.gameType && 
      prev.fontSize === next.fontSize &&
      prev.segmentationMode === next.segmentationMode && 
      prev.line.text === next.line.text &&
      prev.yomitanMode === next.yomitanMode
  );

  if (!basicPropsEqual) return false;

  // Check highlight equality
  if (prev.yomitanHighlight === next.yomitanHighlight) return true;

  // If highlight object changed, check if it affects *this* line
  const prevH = prev.yomitanHighlight;
  const nextH = next.yomitanHighlight;
  const lineId = prev.line.id;

  const prevAffected = prevH && prevH.lineId === lineId;
  const nextAffected = nextH && nextH.lineId === lineId;

  // If neither previous nor next highlight affects this line, it's equal (no re-render)
  if (!prevAffected && !nextAffected) return true;

  // If one affects and other doesn't, or both affect but differ => re-render
  if (prevAffected !== nextAffected) return false;
  
  // Both affect this line, check details including pinned status
  return (
      prevH.start === nextH.start && 
      prevH.length === nextH.length && 
      prevH.pinned === nextH.pinned
  );
});

export const SubtitleRenderer: React.FC<SubtitleRendererProps> = memo(({ 
  subtitles, activeSubtitleIndex, onSeek, gameType, language, learningLanguage, fontSize, onWordClick, onTextHover, onTextClick, segmentationMode, onAutoSegment, isScanning, onShiftTimeline, subtitleMode, yomitanMode, yomitanHighlight
}) => {
  const t = getTranslation(language);
  const containerRef = useRef<HTMLDivElement>(null);

  const isLargeDataset = subtitles.length >= LARGE_DATASET_THRESHOLD;

  useEffect(() => {
    if (activeSubtitleIndex === -1) return;

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
  }, [activeSubtitleIndex, isLargeDataset, subtitleMode]);

  const visibleLines = useMemo(() => {
    if (subtitleMode === 'single') {
      return activeSubtitleIndex !== -1 ? [subtitles[activeSubtitleIndex]] : [];
    }

    if (!isLargeDataset) {
      return subtitles;
    }
    
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
            onTextHover={onTextHover}
            onTextClick={onTextClick}
            segmentationMode={segmentationMode}
            yomitanMode={yomitanMode}
            yomitanHighlight={yomitanHighlight}
          />
        ))}
        <div className="h-64 shrink-0" />
      </div>
    </div>
  );
});