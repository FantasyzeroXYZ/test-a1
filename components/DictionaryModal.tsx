
import React, { useState, useEffect, useRef, memo, useMemo, useCallback } from 'react';
import { DictionaryResponse, LearningLanguage, Language, SubtitleLine, SegmentationMode, WebSearchEngine, AnkiSettings, AudioTrack, ReaderSettings } from '../types';
import { getTranslation } from '../utils/i18n';
import { segmentText, isWord, isNonSpacedLang } from '../utils/textUtils';
import { lookupWord } from '../services/dictionaryService';
import { addNote } from '../services/ankiService';
import { extractAudioClip } from '../utils/audioUtils';
import { searchLocalDictionary } from '../utils/storage';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialWord: string;
  initialSegmentIndex: number;
  sentence: string;
  contextLine: SubtitleLine;
  language: Language;
  learningLanguage: LearningLanguage;
  ankiSettings: AnkiSettings;
  segmentationMode: SegmentationMode;
  webSearchEngine: WebSearchEngine;
  currentTrack?: AudioTrack;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  ttsSettings?: { enabled: boolean; rate: number; pitch: number; volume: number; voice: string };
  settings: ReaderSettings;
  setSettings: (s: ReaderSettings) => void;
}

type WebSearchCategory = 'search' | 'translate' | 'encyclopedia';

const DictionaryModal: React.FC<Props> = ({ 
  isOpen, onClose, initialWord, initialSegmentIndex, sentence, contextLine, 
  language, learningLanguage, ankiSettings, segmentationMode, webSearchEngine: defaultWebEngine, currentTrack, audioRef, ttsSettings,
  settings, setSettings
}) => {
  const t = getTranslation(language);
  
  // Use track language if available, else global setting
  const effectiveLearningLang = currentTrack?.language || learningLanguage;

  const [searchTerm, setSearchTerm] = useState(initialWord);
  const [data, setData] = useState<DictionaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'dict' | 'script' | 'web' | 'custom'>('dict');
  const [dictSource, setDictSource] = useState<'api' | 'local'>('api');
  const [customDef, setCustomDef] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [isAddingToAnki, setIsAddingToAnki] = useState(false);
  const [showWebCustomDef, setShowWebCustomDef] = useState(false);
  
  // Highlighting State: Indices of segments that are currently selected/searched
  const [highlightRange, setHighlightRange] = useState<{start: number, end: number}>({start: initialSegmentIndex, end: initialSegmentIndex});
  
  // Web Tab State
  const [webCategory, setWebCategory] = useState<WebSearchCategory>('translate');
  const [currentWebEngine, setCurrentWebEngine] = useState<WebSearchEngine>(defaultWebEngine);
  const [webHistory, setWebHistory] = useState<string[]>([]);
  const [webHistoryIndex, setWebHistoryIndex] = useState(-1);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  const segments = useMemo(() => {
    return segmentText(sentence, effectiveLearningLang, segmentationMode);
  }, [sentence, effectiveLearningLang, segmentationMode]);

  useEffect(() => {
    // Sync local category with engine on open
    if (['google', 'baidu', 'bing'].includes(defaultWebEngine)) setWebCategory('search');
    else if (['wikipedia', 'baidu_baike', 'moegirl'].includes(defaultWebEngine)) setWebCategory('encyclopedia');
    else setWebCategory('translate');
  }, [defaultWebEngine]);

  useEffect(() => {
    if (isOpen) {
      setSearchTerm(initialWord);
      setHighlightRange({start: initialSegmentIndex, end: initialSegmentIndex});
      // Reset Web History
      setWebHistory([]);
      setWebHistoryIndex(-1);
      setCurrentWebEngine(defaultWebEngine);
      
      if (initialWord) fetchDefinition(initialWord);
    }
  }, [isOpen, initialWord, initialSegmentIndex, defaultWebEngine]);

  // Re-fetch if dictSource changes (fix for API->Local not updating)
  useEffect(() => {
      if (isOpen && searchTerm) {
          fetchDefinition(searchTerm);
      }
  }, [dictSource]);

  const fetchDefinition = async (term: string) => {
    if (!term) return;
    
    setLoading(true);
    setError('');
    setData(null);

    try {
      if (dictSource === 'local') {
          const res = await searchLocalDictionary(term, effectiveLearningLang);
          if (res) setData(res);
          else setError(t.dictNoResult);
      } else {
          const res = await lookupWord(term, effectiveLearningLang);
          if (res) setData(res);
          else setError(t.dictNoResult);
      }
    } catch (e) { setError(t.dictNoResult); }
    finally { setLoading(false); }
  };

  const getTargetLangCode = (appLang: Language) => {
      // Return target language code for translation services based on UI language
      if (appLang === 'zh' || appLang === 'zh-TW') return 'zh-Hans';
      return 'en';
  };

  const constructWebSearchUrl = (engine: WebSearchEngine, term: string) => {
      const targetLang = getTargetLangCode(language);
      const encodedTerm = encodeURIComponent(term);
      
      switch (engine) {
          case 'google': return `https://www.google.com/search?q=${encodedTerm}&igu=1`; // igu=1 helps google embedding sometimes
          case 'baidu': return `https://www.baidu.com/s?wd=${encodedTerm}`;
          case 'baidu_baike': return `https://baike.baidu.com/item/${encodedTerm}`;
          case 'bing': return `https://www.bing.com/search?q=${encodedTerm}`;
          case 'bing_trans': return `https://www.bing.com/translator/?text=${encodedTerm}&to=${targetLang}`;
          case 'deepl': return `https://www.deepl.com/translator#auto/${targetLang === 'zh-Hans' ? 'zh' : 'en'}/${encodedTerm}`;
          case 'youdao_trans': return `https://dict.youdao.com/search?q=${encodedTerm}`;
          case 'wikipedia': return `https://wikipedia.org/wiki/${encodedTerm}`;
          case 'moegirl': return `https://zh.moegirl.org.cn/${encodedTerm}`;
          default: return `https://www.google.com/search?q=${encodedTerm}`;
      }
  };

  // Push new URL to history stack
  const navigateToUrl = (url: string) => {
      if (settings.webLinkMode === 'external') {
          window.open(url, '_blank');
      } else {
        const newHistory = webHistory.slice(0, webHistoryIndex + 1);
        newHistory.push(url);
        setWebHistory(newHistory);
        setWebHistoryIndex(newHistory.length);
      }
  };

  const handleSearch = (term?: string) => {
    const actualTerm = term || searchTerm;
    if (!actualTerm.trim()) return;
    
    // Always fetch definition regardless of tab, so switching tabs works
    fetchDefinition(actualTerm);

    // Update Web Tab if needed or reset history for new term
    const url = constructWebSearchUrl(currentWebEngine, actualTerm);
    // Reset history for new word
    if (settings.webLinkMode !== 'external') {
      setWebHistory([url]);
      setWebHistoryIndex(0);
    }
  };

  const handleAppendSegment = useCallback(() => {
    if (highlightRange.end + 1 >= segments.length) return;
    const nextIdx = highlightRange.end + 1;
    const nextSeg = segments[nextIdx];
    let newTerm = searchTerm;
    if (!isNonSpacedLang(effectiveLearningLang) && newTerm && !newTerm.endsWith(' ')) {
      newTerm += ' ';
    }
    newTerm += nextSeg;
    setSearchTerm(newTerm);
    setHighlightRange(prev => ({ ...prev, end: nextIdx }));
    handleSearch(newTerm);
  }, [searchTerm, segments, highlightRange, effectiveLearningLang, activeTab, currentWebEngine, settings.webLinkMode]);

  const handleCopyFullSentence = () => {
      setSearchTerm(sentence);
      setHighlightRange({start: 0, end: segments.length - 1});
      handleSearch(sentence);
  };

  const handleReplaySentence = () => {
    if (audioRef?.current && contextLine) {
      const audio = audioRef.current;
      audio.currentTime = contextLine.start;
      audio.play();
      const checkEnd = () => {
          if (audio.currentTime >= contextLine.end) {
              audio.pause();
              audio.removeEventListener('timeupdate', checkEnd);
          }
      };
      audio.addEventListener('timeupdate', checkEnd);
    }
  };

  const handleTTS = () => {
    if (!searchTerm) return;
    const utterance = new SpeechSynthesisUtterance(searchTerm);
    utterance.lang = effectiveLearningLang;
    if (ttsSettings?.enabled) {
      utterance.rate = ttsSettings.rate;
      utterance.volume = ttsSettings.volume;
      utterance.pitch = ttsSettings.pitch;
      if (ttsSettings.voice) {
          const voices = window.speechSynthesis.getVoices();
          const voice = voices.find(v => v.name === ttsSettings.voice);
          if (voice) utterance.voice = voice;
      }
    }
    window.speechSynthesis.speak(utterance);
  };

  const handleAddToAnki = async (contentOverride?: string) => {
    if (activeTab === 'custom' && !customDef.trim()) {
        alert("请输入内容或导入图片/文件后再制卡");
        return;
    }
    setIsAddingToAnki(true);
    try {
      let definition = customDef;
      
      // If granular definition is passed, use it directly
      if (contentOverride) {
          definition = contentOverride;
      } else if (activeTab === 'dict' && data) {
          // Default: Add all entries found
          definition = data.entries.map(e => `<div><b>[${e.partOfSpeech}]</b><ul>${e.senses.map(s => `<li>${s.definition}</li>`).join('')}</ul></div>`).join('<hr/>');
      }
      
      let audioBase64 = undefined;
      if (ankiSettings.fieldMap.audio && currentTrack?.file) {
        audioBase64 = await extractAudioClip(currentTrack.file, contextLine.start, contextLine.end);
      }
      await addNote(ankiSettings, {
        word: searchTerm,
        definition: definition || searchTerm,
        sentence: sentence.replace(searchTerm, `<b>${searchTerm}</b>`),
        translation: '',
        audioBase64
      });
      alert(t.ankiSuccess);
    } catch (e) { alert(t.ankiError); }
    finally { setIsAddingToAnki(false); }
  };

  const handleWebBack = () => {
    if (webHistoryIndex > 0) {
        setWebHistoryIndex(webHistoryIndex - 1);
    }
  };

  const handleWebForward = () => {
    if (webHistoryIndex < webHistory.length - 1) {
        setWebHistoryIndex(webHistoryIndex + 1);
    }
  };

  const handleWebRefresh = () => {
     if (iframeRef.current) {
         iframeRef.current.src = iframeRef.current.src;
     }
  };

  const switchWebEngine = (engine: WebSearchEngine) => {
      setCurrentWebEngine(engine);
      const url = constructWebSearchUrl(engine, searchTerm);
      navigateToUrl(url);
  };

  const toggleClipboard = () => {
    setSettings({...settings, copyToClipboard: !settings.copyToClipboard});
  };
  
  const toggleLinkMode = () => {
      const newMode = settings.webLinkMode === 'inline' ? 'external' : 'inline';
      setSettings({...settings, webLinkMode: newMode});
  };

  const renderWebOptions = () => {
      switch(webCategory) {
          case 'search':
              return <><option value="google">Google</option><option value="baidu">Baidu</option><option value="bing">Bing</option></>;
          case 'encyclopedia':
              return <><option value="wikipedia">Wikipedia</option><option value="baidu_baike">Baidu Baike</option><option value="moegirl">Moegirl</option></>;
          case 'translate':
          default:
              return <><option value="bing_trans">Bing Translator</option><option value="deepl">DeepL</option><option value="youdao_trans">Youdao</option></>;
      }
  };

  const currentWebUrl = webHistory.length > 0 ? webHistory[webHistoryIndex] : constructWebSearchUrl(currentWebEngine, searchTerm);

  if (!isOpen) return null;
  const isCJK = isNonSpacedLang(effectiveLearningLang);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[90]" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full md:w-[450px] bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-700 shadow-2xl z-[100] flex flex-col transition-all animate-slide-in">
        {/* Header Search Bar */}
        <div className="p-4 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 flex flex-col gap-3 shrink-0 transition-colors">
          <div className="flex items-center justify-between">
            <h3 className="font-bold flex items-center gap-2 text-slate-800 dark:text-white text-sm"><i className="fa-solid fa-book text-indigo-500 dark:text-indigo-400"></i> {t.dictClassic}</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => setIsPinned(!isPinned)} className={`p-2 rounded-full ${isPinned ? 'text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-400/10' : 'text-slate-400 hover:text-slate-600 dark:hover:text-white'}`}><i className="fa-solid fa-thumbtack"></i></button>
              <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white"><i className="fa-solid fa-xmark"></i></button>
            </div>
          </div>
          <div className="relative">
            <input 
              value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl pl-4 pr-36 py-2 text-sm text-slate-800 dark:text-white focus:border-indigo-500 outline-none transition-colors"
              placeholder={t.search}
            />
            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <button onClick={handleAppendSegment} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white" title={t.appendSegment}><i className="fa-solid fa-plus"></i></button>
              <button onClick={handleCopyFullSentence} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white" title="全句查询"><i className="fa-solid fa-quote-right"></i></button>
              <button onClick={() => handleSearch()} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white"><i className="fa-solid fa-magnifying-glass"></i></button>
              <button onClick={() => handleAddToAnki()} disabled={isAddingToAnki} className="p-1.5 text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 disabled:opacity-50" title={t.saveToAnki}>
                {isAddingToAnki ? <i className="fa-solid fa-spinner animate-spin"></i> : <i className="fa-solid fa-floppy-disk"></i>}
              </button>
            </div>
          </div>
        </div>

        {/* Sentence Bar */}
        <div className="bg-gray-50 dark:bg-slate-800/30 border-b border-gray-200 dark:border-slate-700/50 p-3 flex gap-2 items-center shrink-0 transition-colors">
          <div className={`flex-1 flex flex-wrap text-sm text-slate-600 dark:text-slate-300 ${isCJK ? 'gap-0' : 'gap-1'}`}>
            {segments.map((seg, i) => {
              // Highlighting Logic: Check if index is within the selected range
              const isHighlighted = i >= highlightRange.start && i <= highlightRange.end;
              return (
                  <span key={i} onClick={() => { setSearchTerm(seg); setHighlightRange({start: i, end: i}); handleSearch(seg); if(settings.copyToClipboard) navigator.clipboard.writeText(seg); }} 
                    className={`cursor-pointer hover:text-indigo-500 dark:hover:text-indigo-400 px-0 rounded ${isHighlighted ? 'text-indigo-600 dark:text-indigo-300 font-bold underline decoration-indigo-500/50' : ''}`}>
                    {seg}
                  </span>
              );
            })}
          </div>
          <button onClick={handleReplaySentence} className="p-2 text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 shrink-0" title={t.replaySentence}><i className="fa-solid fa-rotate-right"></i></button>
        </div>

        {/* Tab Navigation */}
        <div className="flex justify-around border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/20 shrink-0 transition-colors">
          {(['dict', 'script', 'web', 'custom'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-all ${activeTab === tab ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-white dark:bg-white/5' : 'border-transparent text-slate-500'}`}>
              {tab === 'dict' ? t.dictClassic : tab === 'script' ? t.dictScript : tab === 'web' ? t.dictWeb : t.dictDictionary}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden relative bg-white dark:bg-slate-900 transition-colors">
          {activeTab === 'dict' && (
            <div className="h-full flex flex-col">
              <div className="p-2 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between bg-gray-50 dark:bg-slate-800/30 transition-colors">
                  <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-800 dark:text-white px-2 truncate max-w-[200px]">{searchTerm}</span>
                      <button onClick={handleTTS} className="text-slate-400 hover:text-slate-800 dark:hover:text-white"><i className="fa-solid fa-volume-high"></i></button>
                  </div>
                  <div className="flex bg-gray-200 dark:bg-slate-900 rounded p-0.5 border border-gray-300 dark:border-slate-700">
                      <button onClick={() => setDictSource('api')} className={`px-2 py-0.5 text-[10px] rounded transition-all ${dictSource === 'api' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500'}`}>API</button>
                      <button onClick={() => setDictSource('local')} className={`px-2 py-0.5 text-[10px] rounded transition-all ${dictSource === 'local' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500'}`}>Local</button>
                  </div>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                  {dictSource === 'local' && !data ? (
                     <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3 text-center p-4">
                        <i className="fa-solid fa-folder-open text-3xl opacity-30"></i>
                        <p className="text-xs">{loading ? t.dictQuerying : t.localDictEmpty}</p>
                     </div>
                  ) : loading ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3"><i className="fa-solid fa-spinner animate-spin text-2xl"></i><span>{t.dictQuerying}</span></div>
                  ) : error ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-500 py-10"><i className="fa-solid fa-triangle-exclamation text-3xl mb-3 opacity-20"></i><p>{error}</p></div>
                  ) : data ? (
                    <div className="animate-fade-in space-y-6">
                      {data.entries.map((entry, i) => (
                        <div key={i}>
                          <div className="flex flex-wrap gap-2 mb-3">
                              <span className="inline-block px-2 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase rounded">{entry.partOfSpeech}</span>
                              {entry.tags && entry.tags.map(tag => (
                                  <span key={tag} className="inline-block px-2 py-0.5 bg-gray-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-[10px] rounded">{tag}</span>
                              ))}
                          </div>
                          <div className="space-y-4">
                            {entry.senses.map((s, j) => (
                              <div key={j} className="pl-4 border-l-2 border-gray-200 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-300 group relative">
                                <p className="leading-relaxed pr-8">
                                    {s.definition}
                                </p>
                                {/* Granular Add Button - Always visible as requested */}
                                <button 
                                    onClick={() => handleAddToAnki(s.definition)} 
                                    className="absolute right-0 top-0 text-slate-400 hover:text-indigo-500 transition-colors"
                                    title="Add only this definition to Anki"
                                >
                                    <i className="fa-solid fa-plus-circle"></i>
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-20"><i className="fa-solid fa-book-open text-5xl"></i></div>
                  )}
              </div>
            </div>
          )}

          {activeTab === 'script' && (
             <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4 p-8 text-center">
                <i className="fa-solid fa-scroll text-4xl opacity-30"></i>
                <p className="text-xs">{t.dictWaitingExternal}</p>
             </div>
          )}

          {activeTab === 'web' && (
            <div className="h-full flex flex-col">
              {/* Refactored Header: Swapped positions of Nav and Search */}
              <div className="p-2 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/30 transition-colors flex items-center gap-2 overflow-x-auto no-scrollbar">
                  {/* Navigation Buttons Group - Now on Left */}
                  <div className="flex gap-0.5 shrink-0">
                      <button onClick={handleWebBack} disabled={webHistoryIndex <= 0} className="w-7 h-7 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-slate-700 rounded text-slate-500 dark:text-slate-400 disabled:opacity-30" title={t.webBack}><i className="fa-solid fa-arrow-left text-[10px]"></i></button>
                      <button onClick={handleWebForward} disabled={webHistoryIndex >= webHistory.length - 1} className="w-7 h-7 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-slate-700 rounded text-slate-500 dark:text-slate-400 disabled:opacity-30" title={t.webForward}><i className="fa-solid fa-arrow-right text-[10px]"></i></button>
                      <button onClick={handleWebRefresh} className="w-7 h-7 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-slate-700 rounded text-slate-500 dark:text-slate-400" title={t.webRefresh}><i className="fa-solid fa-rotate-right text-[10px]"></i></button>
                  </div>

                  {/* Divider */}
                  <div className="h-4 w-px bg-gray-300 dark:bg-slate-700 shrink-0"></div>

                  {/* Dropdowns Group */}
                  <div className="flex gap-1 shrink-0">
                    <select 
                       value={webCategory} 
                       onChange={(e) => {
                           const cat = e.target.value as WebSearchCategory;
                           setWebCategory(cat);
                           if(cat === 'search') switchWebEngine('google');
                           else if (cat === 'encyclopedia') switchWebEngine('wikipedia');
                           else switchWebEngine('bing_trans');
                       }}
                       className="w-20 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded text-[10px] p-1.5 outline-none text-slate-800 dark:text-white"
                    >
                        <option value="search">{t.catSearch}</option>
                        <option value="translate">{t.catTranslate}</option>
                        <option value="encyclopedia">{t.catEncyclopedia}</option>
                    </select>
                    <select 
                        value={currentWebEngine}
                        onChange={(e) => switchWebEngine(e.target.value as WebSearchEngine)}
                        className="w-24 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded text-[10px] p-1.5 outline-none text-slate-800 dark:text-white truncate"
                    >
                        {renderWebOptions()}
                    </select>
                  </div>
                  
                  {/* Link Mode Toggle */}
                  <button onClick={toggleLinkMode} className={`ml-auto w-7 h-7 flex items-center justify-center rounded shrink-0 ${settings.webLinkMode === 'external' ? 'text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10' : 'text-slate-400 hover:text-slate-600'}`} title={settings.webLinkMode === 'external' ? 'External Browser' : 'Embedded View'}>
                      <i className={`fa-solid ${settings.webLinkMode === 'external' ? 'fa-up-right-from-square' : 'fa-window-maximize'} text-[10px]`}></i>
                  </button>

                  {/* Edit Toggle */}
                  <button onClick={() => setShowWebCustomDef(!showWebCustomDef)} className={`w-7 h-7 flex items-center justify-center rounded shrink-0 ${showWebCustomDef ? 'text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10' : 'text-slate-400 hover:text-slate-600'}`}><i className="fa-solid fa-pen-to-square text-[10px]"></i></button>
              </div>
              
              {settings.webLinkMode === 'external' ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-4 bg-gray-50 dark:bg-slate-900">
                      <i className="fa-solid fa-up-right-from-square text-4xl opacity-30"></i>
                      <p className="text-xs">Opening in external browser...</p>
                  </div>
              ) : (
                  <iframe ref={iframeRef} src={currentWebUrl} className="flex-1 w-full border-0 bg-white" sandbox="allow-forms allow-scripts allow-same-origin allow-popups" />
              )}
              
              {showWebCustomDef && (
                <div className="p-3 border-t border-gray-200 dark:border-slate-700 bg-white/95 dark:bg-slate-800/95 absolute bottom-0 left-0 right-0 z-10 flex flex-col gap-2 shadow-[0_-5px_15px_rgba(0,0,0,0.1)]">
                   <div className="flex items-center justify-between">
                       <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t.webCustomNotes}</h4>
                       <div className="flex items-center gap-2">
                           <label className="text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-400 cursor-pointer text-sm" title="导入图片"><i className="fa-solid fa-image"></i><input type="file" accept="image/*" className="hidden" /></label>
                           <label className="text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-400 cursor-pointer text-sm" title="导入文本"><i className="fa-solid fa-file-lines"></i><input type="file" accept=".txt,.md" className="hidden" /></label>
                       </div>
                   </div>
                   <textarea value={customDef} onChange={(e) => setCustomDef(e.target.value)} className="w-full bg-gray-100 dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-800 dark:text-white outline-none h-20 resize-none" placeholder={t.dictCustomPlaceholder} />
                </div>
              )}
            </div>
          )}

          {activeTab === 'custom' && (
            <div className="h-full flex flex-col">
              <div className="p-2 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between bg-gray-50 dark:bg-slate-800/30 transition-colors">
                  <div className="flex items-center gap-3 px-2">
                      <button onClick={toggleClipboard} className={`text-sm ${settings.copyToClipboard ? 'text-indigo-500 dark:text-indigo-400' : 'text-slate-500'}`} title={t.clipboardMode}><i className="fa-solid fa-paste"></i></button>
                      <label className="text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-400 cursor-pointer text-sm" title="导入图片"><i className="fa-solid fa-image"></i><input type="file" accept="image/*" className="hidden" /></label>
                      <label className="text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-400 cursor-pointer text-sm" title="导入文本"><i className="fa-solid fa-file-lines"></i><input type="file" accept=".txt,.md" className="hidden" /></label>
                  </div>
                  <button onClick={() => setCustomDef('')} className="text-slate-500 hover:text-slate-800 dark:hover:text-white text-xs px-2"><i className="fa-solid fa-eraser"></i></button>
              </div>
              <textarea value={customDef} onChange={(e) => setCustomDef(e.target.value)} className="flex-1 w-full bg-white dark:bg-slate-800/20 border-0 p-4 text-slate-800 dark:text-white text-sm outline-none resize-none transition-colors" placeholder={t.dictCustomPlaceholder} />
            </div>
          )}
        </div>
      </div>
    </>
  );
};
export default DictionaryModal;
