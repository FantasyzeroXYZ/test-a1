
import React, { useState, useEffect, useRef } from 'react';
import { AudioTrack, Language, LearningLanguage } from '../types';
import { getTranslation } from '../utils/i18n';
import { SUPPORTED_AUDIO_TYPES, SUPPORTED_SUBTITLE_TYPES } from '../constants';
import { exportTrackToMarkdown, downloadFile } from '../utils/parsers';

interface LibraryProps {
  tracks: AudioTrack[];
  onTrackSelect: (track: AudioTrack) => void;
  onTrackDelete: (id: string) => void;
  onTrackUpdate: (id: string, updates: Partial<AudioTrack>) => void;
  onImport: (e: React.ChangeEvent<HTMLInputElement>, category: 'music' | 'audiobook') => void;
  onReplaceFile: (trackId: string, file: File) => void;
  onUpdateTrackUrl?: (trackId: string, newUrl: string) => void;
  onImportLink: (url: string, category: 'music' | 'audiobook') => Promise<AudioTrack | null>;
  onImportSubtitle: (trackId: string, file: File, isSecondary: boolean) => void;
  language: Language;
  isImporting?: boolean; // New prop for loading state
}

export const Library: React.FC<LibraryProps> = ({
  tracks,
  onTrackSelect,
  onTrackDelete,
  onTrackUpdate,
  onImport,
  onReplaceFile,
  onUpdateTrackUrl,
  onImportLink,
  onImportSubtitle,
  language,
  isImporting
}) => {
  const [activeTab, setActiveTab] = useState<'music' | 'audiobook'>('audiobook');
  const [viewType, setViewType] = useState<'grid' | 'list'>('grid');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  
  const [editingTrack, setEditingTrack] = useState<AudioTrack | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editLang, setEditLang] = useState<LearningLanguage | ''>('');

  const t = getTranslation(language);
  const filteredTracks = tracks.filter(t => t.category === activeTab);

  const prevTracksLen = useRef(tracks.length);

  useEffect(() => {
      // Only open edit modal if track count increased AND we are in an importing state
      // This prevents the modal from opening when tracks are loaded from IndexedDB on refresh
      if (isImporting && tracks.length > prevTracksLen.current) {
          const newTrack = tracks[tracks.length - 1];
          // Only open if it's a file import (optional, but good UX)
          if (newTrack.file) {
              setEditingTrack(newTrack);
          }
      }
      prevTracksLen.current = tracks.length;
  }, [tracks, isImporting]);

  useEffect(() => {
    if (editingTrack) {
        setEditTitle(editingTrack.title);
        setEditUrl(editingTrack.file ? '' : editingTrack.url);
        setEditLang(editingTrack.language || '');
    }
  }, [editingTrack]);

  const handleSubFileChange = (e: React.ChangeEvent<HTMLInputElement>, trackId: string, isSecondary: boolean) => {
    if (e.target.files?.[0]) {
      onImportSubtitle(trackId, e.target.files[0], isSecondary);
      e.target.value = ""; 
    }
  };

  const handleExport = () => {
    if (editingTrack) {
        const mdContent = exportTrackToMarkdown(editingTrack);
        downloadFile(mdContent, `${editingTrack.title.replace(/[/\\?%*:|"<>]/g, '-')}.md`, 'text/markdown');
    }
  };

  const submitLink = async () => {
    if (linkUrl.trim()) {
      const newTrack = await onImportLink(linkUrl.trim(), activeTab);
      setLinkUrl('');
      setShowLinkInput(false);
      if (newTrack) {
          setEditingTrack(newTrack);
      }
    }
  };

  const openEditModal = (track: AudioTrack) => {
    setEditingTrack(track);
  };

  const saveTrackEdit = () => {
    if (editingTrack) {
      const finalTitle = editTitle.trim() || editingTrack.filename?.replace(/\.[^/.]+$/, '') || editingTrack.title;
      const updates: Partial<AudioTrack> = { title: finalTitle };
      
      if (editLang) {
          updates.language = editLang;
      } else {
          updates.language = undefined; // Clear if empty
      }

      onTrackUpdate(editingTrack.id, updates);
      
      if (!editingTrack.file && editUrl.trim() && editUrl.trim() !== editingTrack.url && onUpdateTrackUrl) {
          onUpdateTrackUrl(editingTrack.id, editUrl.trim());
      }
      
      setEditingTrack(null);
    }
  };

  const handleFileReplace = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (editingTrack && e.target.files?.[0]) {
      onReplaceFile(editingTrack.id, e.target.files[0]);
      e.target.value = "";
    }
  };

  const handleCoverReplace = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (editingTrack && e.target.files?.[0]) {
      const file = e.target.files[0];
      const newCoverUrl = URL.createObjectURL(file);
      onTrackUpdate(editingTrack.id, { 
        cover: newCoverUrl,
        coverBlob: file 
      });
      setEditingTrack(prev => prev ? { ...prev, cover: newCoverUrl, coverBlob: file } : null);
      e.target.value = "";
    }
  };

  const handleDownloadCover = () => {
    if (editingTrack?.cover) {
        const link = document.createElement('a');
        link.href = editingTrack.cover;
        link.download = `${editingTrack.title}_cover.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
  };

  const handleImportWrapper = (e: React.ChangeEvent<HTMLInputElement>, category: 'music' | 'audiobook') => {
      const file = e.target.files?.[0];
      if (file) {
          onImport(e, category);
      }
  };

  const circleActionBtn = "w-7 h-7 rounded-full bg-white/80 dark:bg-slate-900/80 backdrop-blur-md flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-all border border-gray-200 dark:border-white/10 shadow-lg active:scale-90 hover:scale-105";

  const TrackTypeBadge = ({ isFile }: { isFile: boolean }) => (
    <div className={`absolute top-2 left-2 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider shadow-sm backdrop-blur-sm border ${isFile ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border-emerald-500/30' : 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border-cyan-500/30'}`}>
        {isFile ? <><i className="fa-solid fa-file-audio mr-1"></i>LOCAL</> : <><i className="fa-solid fa-globe mr-1"></i>NET</>}
    </div>
  );

  return (
    <div className="w-full h-full mx-auto p-4 md:p-6 animate-fade-in pb-32 overflow-y-auto no-scrollbar transition-colors duration-300 relative">
      
      {/* Loading Overlay */}
      {isImporting && (
          <div className="absolute inset-0 z-[200] bg-white/50 dark:bg-black/50 backdrop-blur-sm flex flex-col items-center justify-center">
              <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
              <p className="text-indigo-600 dark:text-indigo-300 font-bold animate-pulse">Importing...</p>
          </div>
      )}

      {/* Top Navigation */}
      <div className="flex items-center justify-between mb-8">
         <div className="flex bg-white/80 dark:bg-slate-800/80 p-1.5 rounded-xl border border-gray-200 dark:border-slate-700/50 backdrop-blur-md transition-colors">
           <button 
             onClick={() => setActiveTab('music')}
             className={`px-6 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${activeTab === 'music' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
           >
             {t.music}
           </button>
           <button 
             onClick={() => setActiveTab('audiobook')}
             className={`px-6 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${activeTab === 'audiobook' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
           >
             {t.audiobooks}
           </button>
         </div>
         
         <div className="flex items-center gap-2">
             <button 
               onClick={() => setViewType(viewType === 'grid' ? 'list' : 'grid')}
               className="bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 w-10 h-10 rounded-xl border border-gray-200 dark:border-slate-700 flex items-center justify-center transition-all active:scale-90"
               title={viewType === 'grid' ? t.listView : t.gridView}
             >
                <i className={`fa-solid ${viewType === 'grid' ? 'fa-list' : 'fa-grip-vertical'} text-xs`}></i>
             </button>
             <button 
               onClick={() => setShowLinkInput(true)}
               className="bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 w-10 h-10 rounded-xl border border-gray-200 dark:border-slate-700 flex items-center justify-center transition-all active:scale-90"
               title={t.importLink}
             >
                <i className="fa-solid fa-link text-xs"></i>
             </button>
             <label className="bg-indigo-600 hover:bg-indigo-500 text-white w-10 h-10 rounded-xl shadow-xl shadow-indigo-600/20 cursor-pointer flex items-center justify-center transition-all active:scale-90">
                <i className="fa-solid fa-plus text-xs"></i>
                <input type="file" accept=".mp3,.m4b,.m4a,audio/*" className="hidden" onChange={(e) => handleImportWrapper(e, activeTab)} />
             </label>
         </div>
      </div>

      {/* Media Grid / List */}
      {viewType === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4 md:gap-5">
          {filteredTracks.map(track => (
            <div key={track.id} className="group flex flex-col items-center animate-fade-in-up">
               <div 
                 className="relative w-full aspect-[1/1] bg-gray-100 dark:bg-slate-800 rounded-2xl overflow-hidden cursor-pointer border border-gray-200 dark:border-slate-700/50 group-hover:border-indigo-500/50 group-hover:shadow-[0_0_20px_rgba(99,102,241,0.2)] transition-all duration-300 shadow-md"
                 onClick={() => onTrackSelect(track)}
               >
                 <TrackTypeBadge isFile={!!track.file} />
                 
                 {track.cover ? (
                   <img src={track.cover} alt="" className="w-full h-full object-cover" />
                 ) : (
                   <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-200 to-gray-300 dark:from-slate-800 dark:to-slate-900 text-slate-400 dark:text-slate-600">
                      <i className={`fa-solid ${track.category === 'music' ? 'fa-music' : 'fa-book-open'} text-3xl opacity-20`}></i>
                   </div>
                 )}

                 <div className="absolute top-2 right-2 flex gap-1 z-10 pointer-events-none">
                    {track.subtitles && track.subtitles.length > 0 && <div className="w-2 h-2 bg-green-500 rounded-full ring-2 ring-white dark:ring-slate-900 shadow-sm" />}
                    {track.secondarySubtitles && track.secondarySubtitles.length > 0 && <div className="w-2 h-2 bg-blue-500 rounded-full ring-2 ring-white dark:ring-slate-900 shadow-sm" />}
                 </div>
                 
                 <div className="absolute inset-0 bg-white/20 dark:bg-slate-950/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="absolute bottom-2 right-2 flex flex-col gap-1.5 items-end">
                        <button onClick={(e) => { e.stopPropagation(); onTrackDelete(track.id); }} className={`${circleActionBtn} hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-400/10`} title={t.delete}>
                          <i className="fa-solid fa-trash-can text-[10px]"></i>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); openEditModal(track); }} className={`${circleActionBtn} hover:text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-400/10`} title={t.edit}>
                          <i className="fa-solid fa-pencil text-[10px]"></i>
                        </button>
                    </div>
                 </div>
               </div>
               <h3 className="mt-3 text-xs md:text-sm font-bold text-slate-700 dark:text-slate-200 text-center truncate w-full px-2">{track.title}</h3>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
           {filteredTracks.map(track => (
             <div key={track.id} onClick={() => onTrackSelect(track)} className="flex items-center gap-4 p-3 bg-white dark:bg-slate-800 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer border border-gray-200 dark:border-slate-700 shadow-sm group animate-fade-in-up">
                <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0">
                   {track.cover ? <img src={track.cover} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gray-200 dark:bg-slate-700 flex items-center justify-center"><i className="fa-solid fa-music text-slate-400"></i></div>}
                </div>
                <div className="flex-1 min-w-0">
                   <h3 className="font-bold text-sm text-slate-800 dark:text-white truncate">{track.title}</h3>
                   <div className="flex gap-2 text-[10px] text-slate-500 mt-1">
                      <span>{track.file ? 'Local' : 'Net'}</span>
                      {track.subtitles?.length ? <span className="text-green-500">SUB</span> : null}
                   </div>
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); openEditModal(track); }} className="p-2 text-slate-400 hover:text-amber-500"><i className="fa-solid fa-pencil"></i></button>
                    <button onClick={(e) => { e.stopPropagation(); onTrackDelete(track.id); }} className="p-2 text-slate-400 hover:text-red-500"><i className="fa-solid fa-trash"></i></button>
                </div>
             </div>
           ))}
        </div>
      )}

      {/* Link Input Modal */}
      {showLinkInput && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
           <div className="bg-white dark:bg-slate-900 w-full max-w-md p-6 rounded-2xl shadow-2xl animate-bounce-in">
              <h3 className="text-lg font-bold mb-4 text-slate-800 dark:text-white">{t.enterUrl}</h3>
              <input 
                value={linkUrl} 
                onChange={(e) => setLinkUrl(e.target.value)} 
                className="w-full p-3 rounded-xl border border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 outline-none focus:ring-2 ring-indigo-500 dark:text-white mb-4"
                placeholder={t.urlPlaceholder}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                 <button onClick={() => setShowLinkInput(false)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-white">{t.cancel}</button>
                 <button onClick={submitLink} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold shadow-lg">{t.confirm}</button>
              </div>
           </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingTrack && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
           <div className="bg-white dark:bg-slate-900 w-full max-w-lg p-6 rounded-2xl shadow-2xl animate-bounce-in flex flex-col gap-4">
              <div className="flex justify-between items-center border-b border-gray-200 dark:border-slate-700 pb-4">
                  <h3 className="text-lg font-bold text-slate-800 dark:text-white">{t.editTrackInfo}</h3>
                  <button onClick={() => setEditingTrack(null)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
              
              <div className="space-y-4">
                  <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">{t.displayName}</label>
                      <input 
                        value={editTitle} 
                        onChange={(e) => setEditTitle(e.target.value)} 
                        className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 outline-none focus:border-indigo-500 dark:text-white text-sm"
                        placeholder={t.enterTitle}
                      />
                  </div>

                  <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">{t.trackLanguage}</label>
                      <select 
                          value={editLang}
                          onChange={(e) => setEditLang(e.target.value as LearningLanguage)}
                          className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 outline-none focus:border-indigo-500 dark:text-white text-sm"
                      >
                          <option value="">{t.defaultLang}</option>
                          <option value="en">{t.langEn}</option>
                          <option value="zh">{t.langZh}</option>
                          <option value="ja">{t.langJa}</option>
                          <option value="es">{t.langEs}</option>
                          <option value="ru">{t.langRu}</option>
                          <option value="fr">{t.langFr}</option>
                      </select>
                  </div>

                  {!editingTrack.file && (
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">{t.networkLink}</label>
                          <input 
                            value={editUrl} 
                            onChange={(e) => setEditUrl(e.target.value)} 
                            className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 outline-none focus:border-indigo-500 dark:text-white text-sm"
                          />
                      </div>
                  )}

                  <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">{t.fileAssociation}</label>
                      <label className="flex items-center justify-center w-full p-3 border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-lg cursor-pointer hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-slate-800 transition-colors group">
                          <span className="text-sm text-slate-500 group-hover:text-indigo-500"><i className="fa-solid fa-rotate mr-2"></i>{t.reassociateFile}</span>
                          <input type="file" className="hidden" onChange={handleFileReplace} accept=".mp3,.m4b,.m4a,audio/*" />
                      </label>
                      <p className="text-[10px] text-slate-400 mt-1 truncate">{editingTrack.file ? editingTrack.file.name : t.unassociated}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">{t.uploadSubs} (.srt/.lrc)</label>
                          <label className="flex items-center justify-center w-full p-2 bg-gray-100 dark:bg-slate-800 rounded-lg cursor-pointer hover:bg-gray-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300">
                              {t.importSubs}
                              <input type="file" className="hidden" accept={SUPPORTED_SUBTITLE_TYPES} onChange={(e) => handleSubFileChange(e, editingTrack.id, false)} />
                          </label>
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">{t.importTrans} (.srt/.lrc)</label>
                          <label className="flex items-center justify-center w-full p-2 bg-gray-100 dark:bg-slate-800 rounded-lg cursor-pointer hover:bg-gray-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300">
                              {t.importTrans}
                              <input type="file" className="hidden" accept={SUPPORTED_SUBTITLE_TYPES} onChange={(e) => handleSubFileChange(e, editingTrack.id, true)} />
                          </label>
                      </div>
                  </div>

                  <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">{t.coverImage}</label>
                      <div className="flex gap-2">
                          <label className="flex-1 flex items-center justify-center p-2 bg-gray-100 dark:bg-slate-800 rounded-lg cursor-pointer hover:bg-gray-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300">
                              {t.uploadReplaceCover}
                              <input type="file" className="hidden" accept="image/*" onChange={handleCoverReplace} />
                          </label>
                          {editingTrack.cover && (
                              <button onClick={handleDownloadCover} className="px-3 bg-gray-100 dark:bg-slate-800 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300">
                                  <i className="fa-solid fa-download"></i>
                              </button>
                          )}
                      </div>
                  </div>
              </div>

              <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-200 dark:border-slate-700">
                 <button onClick={handleExport} className="mr-auto px-4 py-2 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg text-sm font-bold flex items-center gap-2">
                    <i className="fa-brands fa-markdown"></i> {t.exportNotes}
                 </button>
                 <button onClick={() => setEditingTrack(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-white">{t.cancel}</button>
                 <button onClick={saveTrackEdit} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold shadow-lg">{t.save}</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};
