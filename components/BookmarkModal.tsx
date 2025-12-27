
import React, { useState, useEffect, useCallback, memo } from 'react';
import { Bookmark, Language } from '../types';
import { getTranslation } from '../utils/i18n';
import { formatTime } from '../utils/parsers';

const ColorPalette = memo(() => (
  <div className="flex gap-2">
    {['#6366f1', '#f97316', '#ef4444', '#22c55e', '#0ea5e9', '#a855f7', '#f43f5e', '#eab308', '#ec4899'].map(color => (
      <div 
        key={color} 
        className="w-6 h-6 rounded-full cursor-pointer border border-white/20 hover:scale-110 transition-transform" 
        style={{ backgroundColor: color }} 
      />
    ))}
  </div>
));

interface BookmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTime: number;
  currentTrackTitle: string;
  onSave: (bookmark: Bookmark) => void;
  language: Language;
  initialBookmark?: Bookmark | null;
}

export const BookmarkModal: React.FC<BookmarkModalProps> = ({
  isOpen, onClose, currentTime, currentTrackTitle, onSave, language, initialBookmark
}) => {
  const t = getTranslation(language);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [color, setColor] = useState<string>('#6366f1'); // Default indigo

  useEffect(() => {
    if (isOpen) {
      if (initialBookmark) {
        setTitle(initialBookmark.label);
        setNotes(initialBookmark.notes || '');
        setColor(initialBookmark.color || '#6366f1');
      } else {
        setTitle(`${currentTrackTitle} @ ${formatTime(currentTime)}`);
        setNotes('');
        setColor('#6366f1');
      }
    }
  }, [isOpen, initialBookmark, currentTime, currentTrackTitle]);

  const handleSave = () => {
    const bookmarkToSave: Bookmark = {
      id: initialBookmark?.id || '', // Use existing ID if editing
      time: initialBookmark?.time || currentTime,
      label: title.trim() || `${currentTrackTitle} @ ${formatTime(currentTime)}`,
      notes: notes.trim(),
      color,
      createdAt: initialBookmark?.createdAt || Date.now(),
    };
    onSave(bookmarkToSave);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/40 z-[90]" onClick={onClose} />
      
      {/* Centering Container (using Flexbox instead of transform to avoid animation conflict) */}
      <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none p-4">
        {/* Modal Content */}
        <div className="pointer-events-auto w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-6 animate-bounce-in">
          <h2 className="text-xl font-bold text-white mb-6">
            {initialBookmark ? t.editBookmark : t.saveBookmark}
          </h2>

          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">{t.bookmarkTitle}</label>
              <input
                type="text"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg py-2.5 px-3 text-white text-sm focus:border-indigo-500 outline-none"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`${currentTrackTitle} @ ${formatTime(currentTime)}`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">{t.bookmarkNotes}</label>
              <textarea
                className="w-full bg-slate-800 border border-slate-700 rounded-lg py-2.5 px-3 text-white text-sm focus:border-indigo-500 outline-none"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t.bookmarkNotes}
                rows={3}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">{t.bookmarkColor}</label>
              <div className="flex flex-wrap gap-2">
                {['#6366f1', '#f97316', '#ef4444', '#22c55e', '#0ea5e9', '#a855f7', '#f43f5e', '#eab308', '#ec4899', '#94a3b8'].map(c => (
                  <div 
                    key={c} 
                    className={`w-8 h-8 rounded-full cursor-pointer flex items-center justify-center transition-all ${color === c ? 'ring-2 ring-offset-2 ring-indigo-500' : 'hover:scale-110'}`} 
                    style={{ backgroundColor: c }}
                    onClick={() => setColor(c)}
                    title={c}
                  >
                    {color === c && <i className="fa-solid fa-check text-white text-xs" style={{textShadow: '0 0 5px black'}}></i>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-slate-400 hover:text-white rounded-lg transition-colors">
              {t.cancel}
            </button>
            <button onClick={handleSave} className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow-lg shadow-indigo-600/30 transition-colors">
              {t.save}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
