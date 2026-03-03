
import React, { useEffect, useRef, useMemo, useState } from 'react';
import { DictionaryResult, DictionaryEntry, LearningLanguage } from '../types';

export interface YomitanAnalysisResult {
    segment: string;
    length: number;
    foundWords: {
        result: DictionaryResult;
        source: 'direct' | 'deinflected' | 'reading';
        secondarySource?: 'reading';
        reason?: string;
    }[];
}

interface YomitanPopupProps {
  position: { x: number; y: number };
  results: YomitanAnalysisResult[];
  activeSegmentIndex: number;
  onSelectSegment: (index: number) => void;
  seenWords: Set<string>;
  onClose: () => void;
  onAddCard: (result: DictionaryResult, entry?: DictionaryEntry) => void;
  onAddAllCardsInTab: (results: DictionaryResult[]) => void;
  t: { [key: string]: string };
  learningLanguage: LearningLanguage;
  ttsSettings: { enabled: boolean; rate: number; pitch: number; volume: number; voice: string };
  loading?: boolean;
  scrollRef?: React.MutableRefObject<((direction: 'up' | 'down') => void) | null>;
}

// Structured content renderer for JSON definitions
const StructuredContent: React.FC<{ content: any }> = ({ content }) => {
  if (content === null || content === undefined) return null;

  if (Array.isArray(content)) {
    return <>{content.map((child, i) => <StructuredContent key={i} content={child} />)}</>;
  }

  if (typeof content === 'string') {
    return <>{content}</>;
  }

  if (typeof content === 'object') {
    if (content.type === 'structured-content' && content.content) {
        return <StructuredContent content={content.content} />;
    }

    const TagName = (content.tag as string) || 'span';
    const children = content.content;
    const style = content.style || {};
    
    const props: any = { style };
    
    if (content.href) {
        props.href = content.href;
        props.target = "_blank";
        props.rel = "noopener noreferrer";
        props.className = "text-indigo-600 dark:text-indigo-400 hover:underline";
    }

    if (TagName === 'a') {
         return <a {...props}><StructuredContent content={children} /></a>;
    }
    
    if (TagName === 'details') {
         return <details {...props} className="group"><StructuredContent content={children} /></details>;
    }

    return React.createElement(TagName, props, <StructuredContent content={children} />);
  }

  return null;
};

const renderDefinitionContent = (definition: string) => {
    try {
        if (definition.trim().startsWith('{')) {
            const parsed = JSON.parse(definition);
            if(parsed.type === 'structured-content') {
               return <StructuredContent content={parsed} />;
            }
        }
    } catch (e) { }
    
    // Fallback for plain text
    return <span>{definition}</span>;
};


const WordDefinition: React.FC<{ 
    wordMatch: YomitanAnalysisResult['foundWords'][0], 
    onAddCard: (result: DictionaryResult, entry: DictionaryEntry) => void,
    isFirstDefinition: boolean 
}> = ({ wordMatch, onAddCard, isFirstDefinition }) => {
    return (
        <div className="p-2 space-y-1 select-text cursor-text">
            {wordMatch.result.entries.map((entry, idx) => (
                <details key={idx} open={isFirstDefinition && idx === 0} className="group text-left bg-white dark:bg-slate-800/50 rounded">
                    <summary className="list-none cursor-pointer flex items-center justify-between gap-2 p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors">
                        <div className="flex items-center gap-2">
                            <span className="w-4 h-4 flex items-center justify-center text-slate-400 group-open:rotate-90 transition-transform"><i className="fa-solid fa-chevron-right text-[8px]"></i></span>
                            <span className="text-[9px] font-black text-indigo-500 dark:text-indigo-400 uppercase tracking-widest">{entry.partOfSpeech || 'Dictionary'}</span>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); onAddCard(wordMatch.result, entry); }} className="px-1.5 py-0.5 text-[9px] text-slate-400 hover:text-indigo-500 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                            <i className="fa-solid fa-plus"></i>
                        </button>
                    </summary>
                    <div className="pl-7 pr-2 pt-1 pb-2">
                        <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300 border-l border-slate-200 dark:border-slate-700 pl-2">
                            {entry.senses.map((sense, sIdx) => (
                                <div key={sIdx} className="leading-snug">
                                    <span className="text-slate-400 mr-1.5 font-mono text-xs">{sIdx + 1}.</span>
                                    {renderDefinitionContent(sense.definition)}
                                </div>
                            ))}
                        </div>
                    </div>
                </details>
            ))}
        </div>
    );
};

export const YomitanPopup: React.FC<YomitanPopupProps> = ({ 
    position, results, activeSegmentIndex, onSelectSegment, seenWords, onClose, onAddCard, onAddAllCardsInTab, t, learningLanguage, ttsSettings, loading, scrollRef
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
      if (scrollRef) {
          scrollRef.current = (direction: 'up' | 'down') => {
              if (scrollContainerRef.current) {
                  const amount = direction === 'up' ? -100 : 100;
                  scrollContainerRef.current.scrollBy({ top: amount, behavior: 'smooth' });
              }
          };
      }
  }, [scrollRef]);

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(window.innerWidth - 340, Math.max(10, position.x - 160)), 
    top: Math.min(window.innerHeight - 500, position.y + 25), 
    maxHeight: '480px',
    zIndex: 1000, 
  };
  
  if (loading) {
      return (
        <div ref={ref} style={style} className="w-[320px] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-gray-200 dark:border-slate-700 flex flex-col items-center justify-center p-8 animate-fade-in">
            <i className="fa-solid fa-circle-notch fa-spin text-2xl text-indigo-500"></i>
        </div>
      );
  }

  const activeResult = results[activeSegmentIndex];
  if (!activeResult) return null;

  const handlePlayAudio = (wordMatch: YomitanAnalysisResult['foundWords'][0]) => {
      if (!ttsSettings.enabled) return;
      
      let textToSpeak = wordMatch.result.word;
      const reading = wordMatch.result.entries?.[0]?.pronunciations?.[0]?.text;

      if (learningLanguage === 'ja' && reading && reading !== textToSpeak) {
          textToSpeak = reading;
      }
      
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.lang = learningLanguage;
      utterance.rate = ttsSettings.rate;
      utterance.pitch = ttsSettings.pitch;
      utterance.volume = ttsSettings.volume;
      if (ttsSettings.voice) {
          const voices = window.speechSynthesis.getVoices();
          const voice = voices.find(v => v.name === ttsSettings.voice);
          if (voice) utterance.voice = voice;
      }
      window.speechSynthesis.speak(utterance);
  };

  return (
    <div ref={ref} style={style} className="w-[320px] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-gray-200 dark:border-slate-700 flex flex-col overflow-hidden animate-fade-in text-sm font-sans">
        <div className="p-2 border-b dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 flex items-center justify-between">
            <div className="flex flex-wrap gap-1">
                {results.map((res, index) => (
                    <button 
                        key={index}
                        onClick={() => onSelectSegment(index)}
                        className={`px-2 py-0.5 text-[10px] rounded transition-colors ${activeSegmentIndex === index ? 'bg-indigo-600 text-white font-bold' : 'bg-gray-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-100'}`}
                    >
                        {res.segment}
                    </button>
                ))}
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><i className="fa-solid fa-times text-xs"></i></button>
        </div>
        
        <div ref={scrollContainerRef} className="overflow-y-auto flex-1 bg-slate-100 dark:bg-slate-800">
            {activeResult.foundWords.map((wordMatch, index) => {
                const allTags = new Set<string>();
                wordMatch.result.entries.forEach(e => e.tags?.forEach(t => allTags.add(t)));
                const tagsArray = Array.from(allTags);

                return (
                    <details key={index} open={index === 0}>
                        <summary className="list-none cursor-pointer p-2 bg-white dark:bg-slate-900 border-b dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <div className="flex justify-between items-start">
                               <div className="flex-1 min-w-0">
                                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                                        <h4 className="font-bold text-base text-slate-800 dark:text-white flex items-center gap-2">
                                            <span>{wordMatch.result.word}</span>
                                            <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(wordMatch.result.word); }} className="text-slate-400 hover:text-indigo-500 text-xs transition-colors" title="Copy">
                                                <i className="fa-solid fa-copy"></i>
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); handlePlayAudio(wordMatch); }} className="text-slate-400 hover:text-indigo-500 text-xs transition-colors">
                                                <i className="fa-solid fa-volume-high"></i>
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); onAddCard(wordMatch.result); }} className="text-slate-300 dark:text-slate-600 hover:text-indigo-500 dark:hover:text-indigo-400 text-xs transition-colors">
                                                <i className="fa-solid fa-plus-circle"></i>
                                            </button>
                                        </h4>
                                        
                                        {tagsArray.map(tag => (
                                            <span key={tag} className="inline-block px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 text-[9px] font-bold uppercase rounded border border-indigo-100 dark:border-indigo-800/50">
                                                {tag}
                                            </span>
                                        ))}

                                        <div className="text-[9px] text-slate-500 dark:text-slate-400 font-mono space-x-1">
                                            {wordMatch.source === 'direct' && <span>{t.sourceDirect}</span>}
                                            {wordMatch.source === 'deinflected' && <span>{t.sourceDeinflected}</span>}
                                            {wordMatch.source === 'reading' && <span>{t.sourceReading}</span>}
                                            {wordMatch.secondarySource === 'reading' && <span>{t.sourceReading}</span>}
                                        </div>
                                        {wordMatch.source === 'deinflected' && (
                                            <span className="text-xs text-slate-400 dark:text-slate-500 font-normal">(← {activeResult.segment})</span>
                                        )}
                                    </div>
                                    {wordMatch.result.entries?.[0]?.pronunciations?.[0]?.text && wordMatch.result.word !== wordMatch.result.entries[0].pronunciations[0].text && (
                                        <div className="text-xs text-slate-400 dark:text-slate-500 font-normal mt-0.5">[{wordMatch.result.entries[0].pronunciations[0].text}]</div>
                                    )}
                               </div>
                               {seenWords.has(wordMatch.result.word) && <span className="text-[9px] font-bold text-amber-500 bg-amber-100 dark:bg-amber-500/10 px-1.5 py-0.5 rounded-full self-center ml-2">{t.seen}</span>}
                            </div>
                        </summary>
                        <WordDefinition wordMatch={wordMatch} onAddCard={onAddCard} isFirstDefinition={index === 0} />
                    </details>
                );
            })}
        </div>

        <div className="p-2 border-t dark:border-slate-700 bg-white dark:bg-slate-900 flex gap-2">
            <button disabled={activeResult.foundWords.length === 0} onClick={() => onAddAllCardsInTab(activeResult.foundWords.map(fw => fw.result))} className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold shadow-md hover:bg-indigo-500 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
                <i className="fa-solid fa-layer-group"></i> {t.addAllInTab.replace('{count}', String(activeResult.foundWords.length))}
            </button>
        </div>
    </div>
  );
};
