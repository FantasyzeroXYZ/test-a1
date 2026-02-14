import React, { useEffect, useRef, useMemo } from 'react';
import { DictionaryResult, DictionaryEntry } from '../types';

interface YomitanPopupProps {
  position: { x: number; y: number };
  result: DictionaryResult;
  allResults?: DictionaryResult[]; // Candidates list
  onSelectResult?: (result: DictionaryResult) => void;
  onClose: () => void;
  onAddCard: (entry: any) => void;
  isLoading: boolean;
  originalText?: string;
  deinflectionReason?: string;
}

export const YomitanPopup: React.FC<YomitanPopupProps> = ({ 
    position, result, allResults, onSelectResult, onClose, onAddCard, isLoading, 
    originalText, deinflectionReason 
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Prevent off-screen rendering
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(window.innerWidth - 340, Math.max(10, position.x)), 
    top: Math.min(window.innerHeight - 350, position.y + 20),
    maxHeight: '400px',
    zIndex: 1000, 
  };

  if (isLoading) return null; 

  // Show all unique results, sort by length descending
  const sortedResults = useMemo(() => {
      if (!allResults) return [result];
      // Deduplicate by word
      const seen = new Set<string>();
      const unique = allResults.filter(r => {
          if (seen.has(r.word)) return false;
          seen.add(r.word);
          return true;
      });
      return unique.sort((a, b) => b.word.length - a.word.length);
  }, [allResults, result]);

  // Group entries by Dictionary Source
  const entriesByDict = useMemo(() => {
      const groups: Record<string, DictionaryEntry[]> = {};
      result.entries.forEach(entry => {
          const dictName = entry.partOfSpeech || 'Dictionary';
          if (!groups[dictName]) groups[dictName] = [];
          groups[dictName].push(entry);
      });
      return groups;
  }, [result]);

  const uniqueTags = useMemo(() => {
      const tags = new Set<string>();
      result.entries.forEach(e => e.tags?.forEach(t => tags.add(t)));
      return Array.from(tags);
  }, [result]);

  const primaryReading = result.entries[0]?.pronunciations?.[0]?.text;

  return (
    <div ref={ref} style={style} className="w-[320px] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-gray-200 dark:border-slate-700 flex flex-col overflow-hidden animate-fade-in text-sm font-sans">
        
        {/* Top Bar: Result Switcher (Tabs) */}
        {sortedResults.length > 1 && (
            <div className="bg-gray-50 dark:bg-slate-800/80 px-2 py-1.5 border-b border-gray-200 dark:border-slate-700 flex gap-1 overflow-x-auto no-scrollbar whitespace-nowrap">
                {sortedResults.map((r, idx) => (
                    <button 
                        key={`${r.word}-${idx}`} 
                        onClick={() => onSelectResult && onSelectResult(r)}
                        className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-colors ${
                            r.word === result.word 
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' 
                            : 'bg-white dark:bg-slate-700 border-gray-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:text-indigo-500'
                        }`}
                    >
                        {r.word}
                    </button>
                ))}
            </div>
        )}

        {/* Header Section */}
        <div className="bg-white dark:bg-slate-900 p-3 pb-2 flex flex-col gap-1 border-b border-gray-100 dark:border-slate-800">
            {/* Context Info (Reason) */}
            {(originalText || deinflectionReason) && (
                <div className="text-[10px] text-slate-400 flex items-center gap-1 mb-0.5">
                    {originalText && <span className="font-mono bg-gray-100 dark:bg-slate-800 px-1 rounded text-slate-600 dark:text-slate-400">{originalText}</span>}
                    {deinflectionReason && (
                        <>
                            <i className="fa-solid fa-arrow-right text-[8px] opacity-50"></i>
                            <span className="italic truncate max-w-[180px]">{deinflectionReason}</span>
                        </>
                    )}
                </div>
            )}

            <div className="flex justify-between items-start">
                <div className="flex flex-col">
                    <div className="flex items-baseline gap-2">
                        <span className="text-xl font-black text-slate-800 dark:text-white leading-none">{result.word}</span>
                        {primaryReading && primaryReading !== result.word && (
                            <span className="text-sm text-slate-500 dark:text-slate-400 font-normal">{primaryReading}</span>
                        )}
                    </div>
                </div>
                <button onClick={onClose} className="text-slate-300 hover:text-slate-500 dark:hover:text-slate-200 -mt-1 -mr-1 p-1">
                    <i className="fa-solid fa-times-circle"></i>
                </button>
            </div>

            {/* Tags Row */}
            {uniqueTags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                    {uniqueTags.map((tag, idx) => (
                        <span key={idx} className="px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 text-[9px] font-bold uppercase rounded border border-indigo-100 dark:border-indigo-800/50">
                            {tag}
                        </span>
                    ))}
                </div>
            )}
        </div>
        
        {/* Dictionary Content */}
        <div className="overflow-y-auto flex-1 p-0 bg-slate-50 dark:bg-slate-900/50">
            {Object.entries(entriesByDict).map(([dictName, entries], idx) => (
                <div key={idx} className="bg-white dark:bg-slate-900 mb-2 last:mb-0 p-3 shadow-sm border-b border-gray-100 dark:border-slate-800">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <i className="fa-solid fa-book-open"></i> {dictName}
                    </div>
                    <ul className="list-decimal pl-4 space-y-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                        {(entries as DictionaryEntry[]).reduce((acc: any[], e) => acc.concat(e.senses), []).slice(0, 5).map((sense: any, sIdx: number) => {
                            let defText = typeof sense.definition === 'string' ? sense.definition : 'Structured Content';
                            try {
                                if (defText.startsWith('{')) {
                                    const parsed = JSON.parse(defText);
                                    if (parsed.content) defText = Array.isArray(parsed.content) ? parsed.content.join(' ') : String(parsed.content);
                                }
                            } catch(e) {}
                            
                            return (
                                <li key={sIdx}>
                                    <span className="text-slate-800 dark:text-slate-200">{defText}</span>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>

        {/* Action Footer */}
        <div className="p-2 border-t border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex gap-2">
            <button 
                onClick={() => onAddCard(result)} 
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold shadow-md transition-colors flex items-center justify-center gap-2"
            >
                <i className="fa-solid fa-plus-circle"></i> Add Card
            </button>
            <button 
                onClick={() => navigator.clipboard.writeText(result.word)}
                className="px-3 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-bold transition-colors"
                title="Copy"
            >
                <i className="fa-solid fa-copy"></i>
            </button>
        </div>
    </div>
  );
};
