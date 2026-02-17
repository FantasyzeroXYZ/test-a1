
import React, { useEffect, useRef } from 'react';
import { SubtitleLine, Language } from '../types';
import { getTranslation } from '../utils/i18n';
import { formatTime } from '../utils/parsers';

interface SubtitleListPanelProps {
  isOpen: boolean;
  onClose: () => void;
  subtitles: SubtitleLine[];
  activeSubtitleIndex: number;
  onSeek: (time: number) => void;
  language: Language;
}

export const SubtitleListPanel: React.FC<SubtitleListPanelProps> = ({
  isOpen, onClose, subtitles, activeSubtitleIndex, onSeek, language
}) => {
  const t = getTranslation(language);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
      if (isOpen && activeRef.current) {
          activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
  }, [isOpen, activeSubtitleIndex]);

  if (!isOpen) return null;

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/30 backdrop-blur-[1px] z-[55] transition-opacity duration-300" 
        onClick={onClose} 
      />
      <div className="absolute top-0 right-0 bottom-0 w-80 md:w-96 bg-white dark:bg-slate-900/95 backdrop-blur-md shadow-2xl border-l border-gray-200 dark:border-slate-700 z-[60] flex flex-col animate-slide-in transition-colors duration-300">
        <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex justify-between items-center bg-gray-50 dark:bg-slate-800 shrink-0 transition-colors">
          <h2 className="font-bold text-sm text-slate-700 dark:text-slate-300 uppercase tracking-wide">{t.hasSubs} List</h2>
          <button onClick={onClose} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1 no-scrollbar">
           {subtitles.length === 0 ? <p className="text-center mt-10 text-slate-500">{t.noSubtitles}</p> :
             subtitles.map((sub, idx) => {
               const isActive = idx === activeSubtitleIndex;
               return (
                 <div 
                    key={sub.id} 
                    ref={isActive ? activeRef : null}
                    onClick={() => onSeek(sub.start)} 
                    className={`p-2 rounded-lg cursor-pointer border border-transparent transition-all text-sm group ${isActive ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-500/30' : 'hover:bg-gray-100 dark:hover:bg-slate-800'}`}
                 >
                   <div className="flex gap-2 mb-1">
                       <span className={`font-mono text-xs ${isActive ? 'text-indigo-600 dark:text-indigo-400 font-bold' : 'text-slate-400'}`}>{formatTime(sub.start)}</span>
                   </div>
                   <p className={`${isActive ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-600 dark:text-slate-400'}`}>{sub.text || <span className="italic text-slate-400 opacity-50">Empty Segment</span>}</p>
                 </div>
               );
             })
           }
        </div>
      </div>
    </>
  );
};
