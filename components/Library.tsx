
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
  onImportLink: (url: string, category: 'music' | 'audiobook') => void;
  onImportSubtitle: (trackId: string, file: File, isSecondary: boolean) => void;
  language: Language;
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
  language
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

  // Track initial load state to prevent modal from opening on refresh/data load
  const isInitialLoad = useRef(true);
  const prevTracksLen = useRef(tracks.length);

  useEffect(() => {
      // If we have tracks, it's either an initial load or an update
      if (tracks.length > 0) {
          if (isInitialLoad.current) {
              // This is the first time we see data (e.g. from DB load), do not open modal
              isInitialLoad.current = false;
          } else if (tracks.length > prevTracksLen.current) {
              // Real user addition: track length increased after initial load
              const newTrack = tracks[tracks.length - 1];
              if (newTrack.file) {
                  setEditingTrack(newTrack);
              }
          }
      }
      prevTracksLen.current = tracks.length;
  }, [tracks]);

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

  const submitLink = () => {
    if (linkUrl.trim()) {
      onImportLink(linkUrl.trim(), activeTab);
      setLinkUrl('');
      setShowLinkInput(false);
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

  // Improved Import Handler for iOS compatibility
  const handleImportWrapper = (e: React.ChangeEvent<HTMLInputElement>, category: 'music' | 'audiobook') => {
      // iOS sometimes returns empty type or generic type for audio files
      // We rely on extension checking if type fails
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
    <div className="w-full h-full mx-auto p-4 md:p-6 animate-fade-in pb-32 overflow-y-auto no-scrollbar transition-colors duration-300">
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
                {/* Removed strict accept attribute for broader compatibility on mobile, validation happens in logic */}
                <input type="file" className="hidden" onChange={(e) => handleImportWrapper(e, activeTab)} />
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
                        <button onClick={(e) => { e.stopPropagation(); openEditModal(track); }} className={`${circleActionBtn} hover:text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-400/10`} title="Edit">
                          <i className="fa-solid fa-pencil text-[10px]"></i>
                        </button>
                        {/* Remove accept attribute here too */}
                        <label onClick={e => e.stopPropagation()} className={`${circleActionBtn} hover:text-indigo-500 hover:bg-indigo-100 dark:hover:bg-indigo-400/10 cursor-pointer`} title={t.importSubs}>
                          <span className="text-[7px] font-black">SUB</span>
                          <input type="file" className="hidden" onChange={(e) => handleSubFileChange(e, track.id, false)} />
                        </label>
                        <label onClick={e => e.stopPropagation()} className={`${circleActionBtn} hover:text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-400/10 cursor-pointer`} title={t.importTrans}>
                          <span className="text-[7px] font-black">TR</span>
                          <input type="file" className="hidden" onChange={(e) => handleSubFileChange(e, track.id, true)} />
                        </label>
                    </div>
                 </div>
               </div>
               <div className="w-full mt-3 text-center px-1">
                 <h3 className="text-[11px] md:text-xs text-slate-500 dark:text-slate-400 font-bold leading-tight line-clamp-2 group-hover:text-slate-900 dark:group-hover:text-white transition-colors" title={track.title}>
                   {track.title}
                 </h3>
               </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2 max-w-4xl mx-auto">
          {filteredTracks.map(track => (
            <div 
              key={track.id} 
              className="flex items-center gap-4 bg-white dark:bg-slate-800/40 hover:bg-gray-50 dark:hover:bg-slate-800/80 border border-gray-200 dark:border-slate-700/50 p-3 rounded-2xl transition-all cursor-pointer group relative shadow-sm"
              onClick={() => onTrackSelect(track)}
            >
               <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-slate-900 overflow-hidden shrink-0 border border-gray-200 dark:border-slate-700 relative">
                  {track.cover ? (
                    <img src={track.cover} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 dark:text-slate-600">
                       <i className={`fa-solid ${track.category === 'music' ? 'fa-music' : 'fa-book-open'} text-lg opacity-40`}></i>
                    </div>
                  )}
                  <div className="absolute top-0 left-0">
                      {!!track.file ? (
                          <div className="w-3 h-3 bg-emerald-500 rounded-br flex items-center justify-center"><i className="fa-solid fa-file text-[6px] text-white"></i></div>
                      ) : (
                          <div className="w-3 h-3 bg-cyan-500 rounded-br flex items-center justify-center"><i className="fa-solid fa-globe text-[6px] text-white"></i></div>
                      )}
                  </div>
               </div>
               <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 truncate group-hover:text-slate-900 dark:group-hover:text-white">{track.title}</h3>
                  <div className="flex items-center gap-3 mt-1">
                     <span className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
                        <i className="fa-solid fa-file-audio"></i>
                        {track.filename || "Stream"}
                     </span>
                     {track.subtitles && track.subtitles.length > 0 && <span className="text-[9px] font-black text-green-600 dark:text-green-500/80 uppercase tracking-tighter bg-green-100 dark:bg-green-500/10 px-1 rounded">SUB</span>}
                     {track.secondarySubtitles && track.secondarySubtitles.length > 0 && <span className="text-[9px] font-black text-blue-600 dark:text-blue-500/80 uppercase tracking-tighter bg-blue-100 dark:bg-blue-500/10 px-1 rounded">TR</span>}
                  </div>
               </div>
               <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={(e) => { e.stopPropagation(); onTrackDelete(track.id); }} className={`${circleActionBtn} hover:text-red-500`} title={t.delete}>
                    <i className="fa-solid fa-trash-can text-[10px]"></i>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); openEditModal(track); }} className={`${circleActionBtn} hover:text-amber-500`} title="Edit">
                    <i className="fa-solid fa-pencil text-[10px]"></i>
                  </button>
               </div>
            </div>
          ))}
        </div>
      )}

      {filteredTracks.length === 0 && (
         <div className="flex flex-col items-center justify-center py-32 text-slate-400 dark:text-slate-700 opacity-30">
            <i className="fa-solid fa-layer-group text-6xl mb-6"></i>
            <p className="text-sm font-black tracking-[0.2em] uppercase">{t.emptyLibrary}</p>
         </div>
      )}

      {/* URL Import Modal */}
      {showLinkInput && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-xl p-4 transition-all animate-fade-in">
           <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700/50 p-6 rounded-3xl shadow-2xl max-w-sm w-full animate-bounce-in transition-colors">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-600/20 flex items-center justify-center text-indigo-500 dark:text-indigo-400">
                  <i className="fa-solid fa-globe"></i>
                </div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">{t.enterUrl}</h3>
              </div>
              <input 
                type="text" 
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://..."
                className="w-full bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-2xl p-4 text-slate-800 dark:text-white focus:border-indigo-500 outline-none mb-6 text-sm transition-all shadow-inner"
              />
              <div className="flex gap-3">
                <button onClick={() => setShowLinkInput(false)} className="flex-1 py-4 text-sm font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 transition-colors">{t.cancel}</button>
                <button onClick={submitLink} className="flex-1 py-4 bg-indigo-600 rounded-2xl text-sm font-black text-white shadow-xl shadow-indigo-600/30 hover:bg-indigo-500 transition-all active:scale-95">{t.save}</button>
              </div>
           </div>
        </div>
      )}

      {/* Edit Item Modal */}
      {editingTrack && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-xl p-4 transition-all animate-fade-in">
           <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700/50 p-6 rounded-3xl shadow-2xl max-w-sm w-full animate-bounce-in max-h-[90vh] overflow-y-auto no-scrollbar transition-colors">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-600/20 flex items-center justify-center text-amber-500 dark:text-amber-400">
                  <i className="fa-solid fa-pencil"></i>
                </div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">编辑条目信息</h3>
              </div>
              
              <div className="space-y-6">
                <div>
                   <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5 px-1">封面图片</label>
                   <div className="flex gap-4 items-start">
                      <div className="w-24 h-24 rounded-2xl bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 overflow-hidden shrink-0 flex items-center justify-center">
                         {editingTrack.cover ? (
                            <img src={editingTrack.cover} alt="Cover" className="w-full h-full object-cover" />
                         ) : (
                            <i className="fa-solid fa-image text-slate-400 dark:text-slate-600 text-2xl"></i>
                         )}
                      </div>
                      <div className="flex-1 flex flex-col gap-2">
                          <label className="flex-1 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 border border-gray-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors active:scale-95">
                              <i className="fa-solid fa-upload"></i>
                              上传/替换封面
                              <input type="file" accept="image/*" className="hidden" onChange={handleCoverReplace} />
                          </label>
                          <button 
                             onClick={handleDownloadCover} 
                             disabled={!editingTrack.cover}
                             className="flex-1 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 border border-gray-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                              <i className="fa-solid fa-download"></i>
                              下载封面
                          </button>
                      </div>
                   </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5 px-1">显示名称</label>
                  <input 
                    type="text" 
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder={editingTrack.filename?.replace(/\.[^/.]+$/, '') || "输入标题..."}
                    className="w-full bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-2xl p-4 text-slate-800 dark:text-white focus:border-amber-500 outline-none text-sm transition-all shadow-inner"
                  />
                </div>

                <div>
                   <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5 px-1">{t.trackLanguage}</label>
                   <select 
                      value={editLang} 
                      onChange={(e) => setEditLang(e.target.value as LearningLanguage | '')}
                      className="w-full bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-2xl p-3 text-slate-800 dark:text-white focus:border-amber-500 outline-none text-sm transition-all shadow-inner"
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

                <div className="pt-4 border-t border-gray-200 dark:border-slate-800">
                   <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-3 px-1">音频源</label>
                   
                   {!!editingTrack.file ? (
                       <div className="bg-gray-50 dark:bg-slate-800/50 rounded-2xl p-4 border border-gray-200 dark:border-slate-700/50">
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-3 break-all flex items-center gap-2">
                            <i className="fa-solid fa-file-audio text-amber-500/50"></i>
                            {editingTrack.filename || "本地文件"}
                          </p>
                          <label className="w-full py-2.5 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors active:scale-95">
                             <i className="fa-solid fa-rotate"></i>
                             重新关联音频文件
                             <input type="file" className="hidden" onChange={handleFileReplace} />
                          </label>
                       </div>
                   ) : (
                        <div className="bg-gray-50 dark:bg-slate-800/50 rounded-2xl p-4 border border-gray-200 dark:border-slate-700/50">
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-3 break-all flex items-center gap-2">
                            <i className="fa-solid fa-globe text-cyan-500/50"></i>
                            网络链接
                          </p>
                          <input 
                            type="text" 
                            value={editUrl}
                            onChange={(e) => setEditUrl(e.target.value)}
                            placeholder="https://..."
                            className="w-full bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-xl p-3 text-slate-800 dark:text-white focus:border-cyan-500 outline-none text-xs transition-all shadow-inner mb-2"
                          />
                        </div>
                   )}
                </div>

                <div className="pt-2">
                    <button 
                       onClick={handleExport}
                       className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-xs font-black shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2"
                    >
                       <i className="fa-solid fa-file-export"></i>
                       {t.exportNotes}
                    </button>
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button onClick={() => setEditingTrack(null)} className="flex-1 py-4 text-sm font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 transition-colors">{t.cancel}</button>
                <button onClick={saveTrackEdit} className="flex-1 py-4 bg-amber-600 rounded-2xl text-sm font-black text-white shadow-xl shadow-amber-600/30 hover:bg-amber-500 transition-all active:scale-95">{t.save}</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};
