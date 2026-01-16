
import React, { useState } from 'react';
import { Chapter, Bookmark, Language, AudioTrack } from '../types';
import { getTranslation } from '../utils/i18n';
import { formatTime, exportTrackToMarkdown, downloadFile } from '../utils/parsers';

interface SidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  chapters: Chapter[];
  bookmarks: Bookmark[];
  onSeek: (time: number) => void;
  onDeleteBookmark: (id: string) => void;
  onEditBookmark: (bookmark: Bookmark) => void; 
  language: Language;
  currentTrack?: AudioTrack; 
}

export const SidePanel: React.FC<SidePanelProps> = ({
  isOpen, onClose, chapters, bookmarks, onSeek, onDeleteBookmark, onEditBookmark, language, currentTrack
}) => {
  const [activeTab, setActiveTab] = useState<'chapters' | 'bookmarks'>('chapters');
  const t = getTranslation(language);

  if (!isOpen) return null;

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/30 backdrop-blur-[1px] z-[55] transition-opacity duration-300" 
        onClick={onClose} 
      />
      <div className="absolute top-0 left-0 bottom-0 w-80 bg-white dark:bg-slate-900/95 backdrop-blur-md shadow-2xl border-r border-gray-200 dark:border-slate-700 z-[60] flex flex-col animate-slide-in-left transition-colors duration-300">
        <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex justify-between items-center bg-gray-50 dark:bg-slate-800 shrink-0 transition-colors">
          <div className="flex bg-gray-200 dark:bg-slate-700 rounded-lg p-1 transition-colors">
             <button onClick={() => setActiveTab('chapters')} className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${activeTab === 'chapters' ? 'bg-indigo-600 text-white' : 'text-slate-500 dark:text-slate-400'}`}>{t.chapters}</button>
             <button onClick={() => setActiveTab('bookmarks')} className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${activeTab === 'bookmarks' ? 'bg-indigo-600 text-white' : 'text-slate-500 dark:text-slate-400'}`}>{t.bookmarks}</button>
          </div>
          <button onClick={onClose} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 no-scrollbar">
           {activeTab === 'chapters' && (
             chapters.length === 0 ? <p className="text-center mt-10 text-slate-500">{t.noChapters}</p> :
             chapters.map((ch, idx) => (
               <div key={idx} onClick={() => onSeek(ch.startTime)} className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer border border-transparent transition-all">
                 <div className="w-8 h-8 rounded bg-gray-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center font-mono text-xs">{idx + 1}</div>
                 <div className="flex-1 truncate"><p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{ch.title}</p><p className="text-xs text-slate-500">{formatTime(ch.startTime)}</p></div>
               </div>
             ))
           )}

           {activeTab === 'bookmarks' && (
             <div className="space-y-4">
               {bookmarks.length === 0 ? <p className="text-center mt-10 text-slate-500">{t.noBookmarks}</p> :
               bookmarks.map((bm) => (
                 <div key={bm.id} className="bg-gray-100 dark:bg-slate-800 p-3 rounded-xl border border-gray-200 dark:border-slate-700 relative overflow-hidden group transition-colors">
                   <div className="absolute top-0 left-0 bottom-0 w-1" style={{ backgroundColor: bm.color || '#6366f1' }} />
                   <div className="flex justify-between items-start pl-2">
                     <div onClick={() => onSeek(bm.time)} className="cursor-pointer flex-1 min-w-0">
                       <div className="flex items-center gap-2">
                         <span className="text-indigo-600 dark:text-indigo-400 font-mono font-bold text-xs">{formatTime(bm.time)}</span>
                         <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{bm.label}</span>
                       </div>
                       {bm.notes && <p className="text-[10px] text-slate-500 mt-1 truncate italic">"{bm.notes}"</p>}
                     </div>
                     <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {onEditBookmark && (
                            <button onClick={(e) => { e.stopPropagation(); onEditBookmark(bm); }} className="text-slate-500 hover:text-amber-500 p-1">
                                <i className="fa-solid fa-pencil text-xs"></i>
                            </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); onDeleteBookmark(bm.id); }} className="text-slate-500 hover:text-red-500 p-1"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                     </div>
                   </div>
                 </div>
               ))}
             </div>
           )}
        </div>
      </div>
    </>
  );
};