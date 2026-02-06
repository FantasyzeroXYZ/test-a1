import React, { useState, useEffect, useRef, memo, useMemo, useCallback } from 'react';
import { DictionaryResponse, LearningLanguage, Language, SubtitleLine, SegmentationMode, WebSearchEngine, AnkiSettings, AudioTrack, ReaderSettings } from '../types';
import { getTranslation } from '../utils/i18n';
import { segmentText, isWord, isNonSpacedLang } from '../utils/textUtils';
import { lookupWord } from '../services/dictionaryService';
import { addNote } from '../services/ankiService';
import { extractAudioClip } from '../utils/audioUtils';
import { searchLocalDictionary, getLocalTagsForTerm } from '../utils/storage';
import { downloadFile } from '../utils/parsers';

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
  hasDictionaries: boolean; 
  onAnkiSuccess?: () => void;
}

type WebSearchCategory = 'search' | 'translate' | 'encyclopedia';

interface StructuredNode {
  tag?: string;
  content?: string | StructuredNode | StructuredNode[];
  data?: Record<string, any>;
  style?: Record<string, any>;
  href?: string;
  type?: string; 
}

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

// Helper to convert structured content object to HTML string for Anki
const structuredContentToHtml = (content: any): string => {
    if (content === null || content === undefined) return '';

    if (Array.isArray(content)) {
        return content.map(child => structuredContentToHtml(child)).join('');
    }

    if (typeof content === 'string') {
        return content;
    }

    if (typeof content === 'object') {
        if (content.type === 'structured-content' && content.content) {
            return structuredContentToHtml(content.content);
        }

        const TagName = (content.tag as string) || 'span';
        
        let attrs = '';
        if (content.href) {
            attrs += ` href="${content.href}"`;
        }
        if (content.style) {
            const styleStr = Object.entries(content.style).map(([k, v]) => `${k}:${v}`).join(';');
            attrs += ` style="${styleStr}"`;
        }

        const innerHtml = structuredContentToHtml(content.content);
        return `<${TagName}${attrs}>${innerHtml}</${TagName}>`;
    }

    return '';
};

const DictionaryModal: React.FC<Props> = ({ 
  isOpen, onClose, initialWord, initialSegmentIndex, sentence, contextLine, 
  language, learningLanguage, ankiSettings, segmentationMode, webSearchEngine: defaultWebEngine, currentTrack, audioRef, ttsSettings,
  settings, setSettings, hasDictionaries, onAnkiSuccess
}) => {
  const t = getTranslation(language);
  const effectiveLearningLang = currentTrack?.language || learningLanguage;

  const [searchTerm, setSearchTerm] = useState(initialWord);
  
  // Independent caches for API and Local results to allow seamless switching
  const [apiData, setApiData] = useState<DictionaryResponse | null>(null);
  const [localData, setLocalData] = useState<DictionaryResponse | null>(null);
  const [apiError, setApiError] = useState('');
  const [localError, setLocalError] = useState('');
  const [apiLoading, setApiLoading] = useState(false);
  const [localLoading, setLocalLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<'dict' | 'script' | 'web' | 'custom'>('dict');
  
  // Persist Dict Source
  const [dictSource, setDictSource] = useState<'api' | 'local'>(() => {
      const stored = localStorage.getItem('lf_dict_source');
      return (stored === 'api' || stored === 'local') ? stored : (hasDictionaries ? 'local' : 'api');
  });

  const [customDef, setCustomDef] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [isAddingToAnki, setIsAddingToAnki] = useState(false);
  const [showWebCustomDef, setShowWebCustomDef] = useState(false);
  const [highlightRange, setHighlightRange] = useState<{start: number, end: number}>({start: initialSegmentIndex, end: initialSegmentIndex});
  const [webCategory, setWebCategory] = useState<WebSearchCategory>('translate');
  const [currentWebEngine, setCurrentWebEngine] = useState<WebSearchEngine>(defaultWebEngine);
  const [webHistory, setWebHistory] = useState<string[]>([]);
  const [webHistoryIndex, setWebHistoryIndex] = useState(-1);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  const segments = useMemo(() => {
    return segmentText(sentence, effectiveLearningLang, segmentationMode);
  }, [sentence, effectiveLearningLang, segmentationMode]);

  // Persist source choice
  useEffect(() => {
      localStorage.setItem('lf_dict_source', dictSource);
  }, [dictSource]);

  useEffect(() => {
    if (['google', 'baidu', 'bing'].includes(defaultWebEngine)) setWebCategory('search');
    else if (['wikipedia', 'baidu_baike', 'moegirl'].includes(defaultWebEngine)) setWebCategory('encyclopedia');
    else setWebCategory('translate');
  }, [defaultWebEngine]);

  // Initial Load
  useEffect(() => {
    if (isOpen) {
      setSearchTerm(initialWord);
      
      // Reset Web History
      setWebHistory([]);
      setWebHistoryIndex(-1);
      setCurrentWebEngine(defaultWebEngine);
      
      // Reset Caches for new word
      setApiData(null);
      setLocalData(null);
      setApiError('');
      setLocalError('');

      if (initialWord) {
          fetchDefinition(initialWord, dictSource);
      }
      
      if (settings.dictMode === 'sentence') {
          setHighlightRange({start: 0, end: segments.length - 1});
      } else {
          setHighlightRange({start: initialSegmentIndex, end: initialSegmentIndex});
      }
    }
  }, [isOpen, initialWord, initialSegmentIndex, defaultWebEngine]); // Rely on initialWord change to reset

  const fetchDefinition = async (term: string, source: 'api' | 'local') => {
    if (!term) return;
    
    if (source === 'local') {
        setLocalLoading(true);
        setLocalError('');
        setLocalData(null); // Clear previous local result to avoid confusion
        try {
            const result = await searchLocalDictionary(term, effectiveLearningLang);
            if (result) setLocalData(result);
            else setLocalError(hasDictionaries ? t.dictNoResult : t.localDictEmpty);
        } catch (e) { setLocalError(t.dictNoResult); }
        finally { setLocalLoading(false); }
    } else {
        setApiLoading(true);
        setApiError('');
        setApiData(null); // Clear previous api result
        try {
            const result = await lookupWord(term, effectiveLearningLang);
            
            // Try to enhance API result with Local Tags if possible
            const localTags = await getLocalTagsForTerm(term, effectiveLearningLang);
            if (localTags.length > 0) {
                if (result) {
                    result.entries.forEach(e => {
                        const existingTags = new Set(e.tags || []);
                        localTags.forEach(tag => existingTags.add(tag));
                        e.tags = Array.from(existingTags);
                    });
                } else {
                    // Create dummy result for tags
                     const tagResult: DictionaryResponse = {
                         word: term,
                         entries: [{
                             partOfSpeech: 'Tags',
                             pronunciations: [],
                             senses: [{ definition: 'No definition found, only tags available.', examples: [], subsenses: [] }],
                             tags: localTags
                         }]
                     };
                     setApiData(tagResult);
                     setApiLoading(false);
                     return;
                }
            }

            if (result) setApiData(result);
            else setApiError(t.dictNoResult);
        } catch (e) { setApiError(t.dictNoResult); }
        finally { setApiLoading(false); }
    }
  };

  const getTargetLangCode = (appLang: Language) => {
      if (appLang === 'zh' || appLang === 'zh-TW') return 'zh-Hans';
      return 'en';
  };

  const constructWebSearchUrl = (engine: WebSearchEngine, term: string) => {
      const targetLang = getTargetLangCode(language);
      const encodedTerm = encodeURIComponent(term);
      
      switch (engine) {
          case 'google': return `https://www.google.com/search?q=${encodedTerm}&igu=1`; 
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
    
    // Always fetch for the current source when actively searching
    fetchDefinition(actualTerm, dictSource);

    const url = constructWebSearchUrl(currentWebEngine, actualTerm);
    if (settings.webLinkMode !== 'external') {
      setWebHistory([url]);
      setWebHistoryIndex(0);
    }
  };

  // Helper to handle manual source switching without auto-fetching if cached
  const handleSourceSwitch = (newSource: 'api' | 'local') => {
      setDictSource(newSource);
      if (newSource === 'api' && !apiData && !apiLoading) {
          fetchDefinition(searchTerm, newSource);
      } else if (newSource === 'local' && !localData && !localLoading) {
          fetchDefinition(searchTerm, newSource);
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
  }, [searchTerm, segments, highlightRange, effectiveLearningLang, activeTab, currentWebEngine, settings.webLinkMode, dictSource]);

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
  
  // Use current data source
  const currentData = dictSource === 'api' ? apiData : localData;
  const currentLoading = dictSource === 'api' ? apiLoading : localLoading;
  const currentError = dictSource === 'api' ? apiError : localError;

  // Aggregate tags for header display
  const allHeaderTags = useMemo(() => {
    if (!currentData) return [];
    const set = new Set<string>();
    currentData.entries.forEach(e => {
        if (e.tags) e.tags.forEach(t => set.add(t));
    });
    return Array.from(set);
  }, [currentData]);

  // Construct structured HTML for Anki based on current data
  const formatAnkiDefinition = (dictData: DictionaryResponse): string => {
      if (!dictData.entries || dictData.entries.length === 0) return dictData.word;
      
      return dictData.entries.map(entry => {
          const sensesHtml = entry.senses.map(s => {
              let defContent = s.definition;
              // Check if definition is a JSON string of structured content
              try {
                  if (typeof defContent === 'string' && defContent.trim().startsWith('{') && defContent.includes('"type":"structured-content"')) {
                      const parsed = JSON.parse(defContent);
                      defContent = structuredContentToHtml(parsed);
                  }
              } catch (e) {
                  // Fallback to original string if parse fails
              }
              
              return `<li>${defContent}</li>`;
          }).join('');
          
          return `<div class="entry">
              <div class="pos-header"><b>[${entry.partOfSpeech}]</b></div>
              <ul>${sensesHtml}</ul>
          </div>`;
      }).join('<hr/>');
  };

  // --- Table Mode Logic ---

  const saveToTable = (entry: any) => {
    const tableKey = 'lf_vocab_table';
    const raw = localStorage.getItem(tableKey);
    const table = raw ? JSON.parse(raw) : [];
    table.push(entry);
    localStorage.setItem(tableKey, JSON.stringify(table));
    alert(language === 'zh' ? "已添加到生词表" : "Added to Vocabulary List");
  };

  const exportTable = () => {
     const tableKey = 'lf_vocab_table';
     const raw = localStorage.getItem(tableKey);
     const table = raw ? JSON.parse(raw) : [];
     
     if (table.length === 0) {
         alert(language === 'zh' ? "生词表为空" : "List is empty");
         return;
     }

     // Convert to CSV
     // Fields: Word, Definition, Sentence, Translation, Tags, Date
     const header = ["Word", "Definition", "Sentence", "Translation", "Tags", "Date"];
     const csvRows = [header.join(',')];
     
     table.forEach((row: any) => {
         const cols = [
             `"${(row.word || '').replace(/"/g, '""')}"`,
             `"${(row.definition || '').replace(/"/g, '""')}"`,
             `"${(row.sentence || '').replace(/"/g, '""')}"`,
             `"${(row.translation || '').replace(/"/g, '""')}"`,
             `"${(row.tags || '').replace(/"/g, '""')}"`,
             `"${new Date(row.date).toLocaleDateString()}"`
         ];
         csvRows.push(cols.join(','));
     });
     
     const csvContent = csvRows.join('\n');
     downloadFile(csvContent, `vocab_list_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
  };

  // --- Main Add Action ---

  const handleAddToAnkiOrTable = async (contentOverride?: string) => {
    if (activeTab === 'custom' && !customDef.trim()) {
        alert(language === 'zh' ? "请输入内容" : "Please enter content");
        return;
    }

    let definition = customDef;
      
    if (contentOverride) {
        definition = contentOverride;
        // Check if override itself is structured JSON
        try {
            if (definition.trim().startsWith('{') && definition.includes('"type":"structured-content"')) {
                const parsed = JSON.parse(definition);
                definition = structuredContentToHtml(parsed);
            }
        } catch(e) {}
    } else if (activeTab === 'dict' && currentData) {
        // Use formatter
        definition = formatAnkiDefinition(currentData);
    } else if (!customDef && activeTab === 'dict') {
        // Fallback if no definition found
        definition = searchTerm;
    }

    // Common Data
    const examVocabContent = allHeaderTags.length > 0 ? allHeaderTags.join(' ') : '';
    const word = searchTerm;
    const sent = sentence.replace(searchTerm, `<b>${searchTerm}</b>`);

    if (settings.dictExportMode === 'table') {
        // Table Mode
        saveToTable({
            word,
            definition,
            sentence: sentence,
            translation: '', // User usually needs to input this manually or extract from dict if possible, simplified here
            tags: examVocabContent,
            date: Date.now()
        });
        return;
    }

    // Anki Mode
    setIsAddingToAnki(true);
    try {
      let audioBase64 = undefined;
      // Use recording replay method instead of cropping
      if (ankiSettings.fieldMap.audio && currentTrack?.file) {
        audioBase64 = await extractAudioClip(currentTrack.file, contextLine.start, contextLine.end);
      }

      // Fallback logic for sentence mode
      const isSentenceMode = settings.dictMode === 'sentence';
      let effectiveFieldMap = ankiSettings.fieldMap;
      if (isSentenceMode && ankiSettings.sentenceFieldMap && Object.keys(ankiSettings.sentenceFieldMap).length > 0) {
          effectiveFieldMap = { ...ankiSettings.fieldMap, ...ankiSettings.sentenceFieldMap };
      }

      const tempSettings: AnkiSettings = {
          ...ankiSettings,
          fieldMap: effectiveFieldMap as any
      };

      await addNote(tempSettings, {
        word: word,
        definition: definition || word,
        sentence: sent,
        translation: '',
        audioBase64,
        examVocab: examVocabContent
      });
      
      if (onAnkiSuccess) onAnkiSuccess();
    } catch (e) { 
        console.error(e);
        alert(t.ankiError); 
    }
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

  const toggleDictMode = () => {
      const newMode = settings.dictMode === 'word' ? 'sentence' : 'word';
      setSettings({...settings, dictMode: newMode});
      
      // Auto-populate logic based on new mode
      if (newMode === 'sentence') {
          setSearchTerm(sentence);
          setHighlightRange({start: 0, end: segments.length - 1});
          fetchDefinition(sentence, dictSource);
          
          const url = constructWebSearchUrl(currentWebEngine, sentence);
          if (settings.webLinkMode !== 'external') {
            setWebHistory([url]);
            setWebHistoryIndex(0);
          }
      } else {
          setSearchTerm('');
          setHighlightRange({start: -1, end: -1});
      }
  };
  
  const toggleExportMode = () => {
      const newMode = settings.dictExportMode === 'table' ? 'anki' : 'table';
      setSettings({...settings, dictExportMode: newMode});
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

  const renderDefinitionContent = (definition: string) => {
      try {
          if (definition.trim().startsWith('{"type":"structured-content"')) {
              const parsed = JSON.parse(definition);
              return <StructuredContent content={parsed} />;
          }
      } catch (e) { }
      
      if (/[①-⑳㋐-㋾▲△ᐅ〔]/.test(definition)) {
          const parts = definition.split(/(?=[①-⑳㋐-㋾▲△ᐅ〔])/);
          return (
            <div className="leading-snug text-sm">
                {parts.map((part, i) => {
                    const cleanPart = part.trim();
                    if (!cleanPart) return null;
                    
                    if (part.match(/^[①-⑳]/)) {
                         return <div key={i} className="mt-1 mb-0.5 pl-1 border-l-2 border-indigo-200 dark:border-indigo-800"><span className="font-bold text-indigo-600 dark:text-indigo-400 mr-1">{part.charAt(0)}</span>{part.substring(1)}</div>;
                    }
                    if (part.match(/^[㋐-㋾]/)) {
                         return <div key={i} className="ml-4 mt-0.5"><span className="font-bold text-slate-600 dark:text-slate-400 mr-1">{part.charAt(0)}</span>{part.substring(1)}</div>;
                    }
                    if (part.match(/^[▲△]/)) {
                         return <div key={i} className="ml-8 mt-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono flex items-start"><span className="mr-1 opacity-70">▲</span><span>{part.substring(1)}</span></div>;
                    }
                    if (part.match(/^[ᐅ]/)) {
                         return <div key={i} className="ml-2 mt-0.5 text-xs text-slate-500 font-bold">ᐅ {part.substring(1)}</div>;
                    }
                    if (part.match(/^[〔]/)) {
                         return <div key={i} className="mt-1 text-xs text-slate-400 block">{part}</div>;
                    }
                    
                    return <div key={i} className="mb-0.5">{part}</div>;
                })}
            </div>
          );
      }
      
      return definition;
  };

  const currentWebUrl = webHistory.length > 0 ? webHistory[webHistoryIndex] : constructWebSearchUrl(currentWebEngine, searchTerm);
  const isCJK = isNonSpacedLang(effectiveLearningLang);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[90]" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full md:w-[450px] bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-700 shadow-2xl z-[100] flex flex-col transition-all animate-slide-in">
        <div className="p-4 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 flex flex-col gap-3 shrink-0 transition-colors">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
                <h3 className="font-bold flex items-center gap-2 text-slate-800 dark:text-white text-sm"><i className="fa-solid fa-book text-indigo-500 dark:text-indigo-400"></i> {t.dictClassic}</h3>
                
                {/* Dict Mode Toggle */}
                <button 
                    onClick={toggleDictMode} 
                    className={`ml-2 p-1.5 rounded text-[10px] font-bold uppercase tracking-wide border transition-all ${settings.dictMode === 'sentence' ? 'bg-indigo-100 text-indigo-600 border-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30' : 'bg-gray-100 text-slate-500 border-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'}`}
                    title={settings.dictMode === 'sentence' ? "Sentence Mode" : "Word Mode"}
                >
                    {settings.dictMode === 'sentence' ? (language === 'zh' ? '句子模式' : 'SENTENCE') : (language === 'zh' ? '单词模式' : 'WORD')}
                </button>

                {/* Export Mode Toggle */}
                <button 
                    onClick={toggleExportMode} 
                    className={`ml-1 p-1.5 rounded text-[10px] font-bold uppercase tracking-wide border transition-all ${settings.dictExportMode === 'table' ? 'bg-emerald-100 text-emerald-600 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30' : 'bg-blue-100 text-blue-600 border-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/30'}`}
                    title={settings.dictExportMode === 'table' ? "Table Collection Mode" : "Anki Card Mode"}
                >
                    {settings.dictExportMode === 'table' ? (language === 'zh' ? '表格模式' : 'TABLE') : (language === 'zh' ? 'ANKI模式' : 'ANKI')}
                </button>
            </div>
            
            <div className="flex items-center gap-2">
              {settings.dictExportMode === 'table' && (
                  <button onClick={exportTable} className="p-2 text-emerald-500 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300" title="Export Table">
                      <i className="fa-solid fa-file-csv"></i>
                  </button>
              )}
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
              <button 
                  onClick={() => handleAddToAnkiOrTable()} 
                  disabled={isAddingToAnki} 
                  className={`p-1.5 transition-colors disabled:opacity-50 ${settings.dictExportMode === 'table' ? 'text-emerald-500 dark:text-emerald-400 hover:text-emerald-600' : 'text-blue-500 dark:text-blue-400 hover:text-blue-600'}`} 
                  title={settings.dictExportMode === 'table' ? "Add to Table" : t.saveToAnki}
              >
                {isAddingToAnki ? <i className="fa-solid fa-spinner animate-spin"></i> : <i className={`fa-solid ${settings.dictExportMode === 'table' ? 'fa-plus' : 'fa-floppy-disk'}`}></i>}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 dark:bg-slate-800/30 border-b border-gray-200 dark:border-slate-700/50 p-3 flex gap-2 items-center shrink-0 transition-colors">
          <div className={`flex-1 flex flex-wrap text-sm text-slate-600 dark:text-slate-300 ${isCJK ? 'gap-0' : 'gap-1'}`}>
            {segments.map((seg, i) => {
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

        {/* Persistent Word Bar - Now visible on all tabs */}
        <div className="p-2 border-b border-gray-200 dark:border-slate-700 flex flex-col bg-gray-50 dark:bg-slate-800/30 transition-colors shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-slate-800 dark:text-white px-2 truncate max-w-[200px]">{searchTerm}</span>
                <button onClick={handleTTS} className="text-slate-400 hover:text-slate-800 dark:hover:text-white"><i className="fa-solid fa-volume-high"></i></button>
                {/* Inline Tags Display */}
                {allHeaderTags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                      {allHeaderTags.map((tag, idx) => (
                          <span key={idx} className="inline-block px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 text-[9px] font-bold uppercase rounded border border-indigo-100 dark:border-indigo-800/50">
                              {tag}
                          </span>
                      ))}
                  </div>
                )}
            </div>
            {/* API/Local Toggle only visible in Dict tab */}
            {activeTab === 'dict' && (
                <div className="flex bg-gray-200 dark:bg-slate-900 rounded p-0.5 border border-gray-300 dark:border-slate-700 shrink-0 ml-2">
                    <button onClick={() => handleSourceSwitch('api')} className={`px-2 py-0.5 text-[10px] rounded transition-all ${dictSource === 'api' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500'}`}>API</button>
                    <button onClick={() => handleSourceSwitch('local')} className={`px-2 py-0.5 text-[10px] rounded transition-all ${dictSource === 'local' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500'}`}>Local</button>
                </div>
            )}
          </div>
        </div>

        <div className="flex justify-around border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/20 shrink-0 transition-colors">
          {(['dict', 'script', 'web', 'custom'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-all ${activeTab === tab ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-white dark:bg-white/5' : 'border-transparent text-slate-500'}`}>
              {tab === 'dict' ? t.dictClassic : tab === 'script' ? t.dictScript : tab === 'web' ? t.dictWeb : t.dictDictionary}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-hidden relative bg-white dark:bg-slate-900 transition-colors">
          <div className={`h-full flex flex-col ${activeTab === 'dict' ? 'block' : 'hidden'}`}>
              {/* Added select-text to allow copying */}
              <div className="flex-1 overflow-y-auto p-4 yomitan-content select-text cursor-text">
                  <style>{`
                    .yomitan-content p { margin: 0 0 2px 0; }
                    .yomitan-content ul, .yomitan-content ol { padding-left: 1.2em; margin: 0 0 2px 0; }
                    .yomitan-content li { margin-bottom: 1px; }
                    .yomitan-content .group { margin-bottom: 4px; }
                    .yomitan-content div { line-height: 1.4; }
                  `}</style>
                  {currentLoading ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3"><i className="fa-solid fa-spinner animate-spin text-2xl"></i><span>{t.dictQuerying}</span></div>
                  ) : currentError ? (
                     <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3 text-center p-4">
                        <i className={`fa-solid ${dictSource === 'local' ? 'fa-folder-open' : 'fa-triangle-exclamation'} text-3xl opacity-30`}></i>
                        <p className="text-xs">{currentError}</p>
                     </div>
                  ) : currentData ? (
                    <div className="animate-fade-in space-y-3">
                      {currentData.entries.map((entry, i) => (
                        <details key={i} open className="group mb-2 bg-white dark:bg-slate-800/40 rounded-xl overflow-hidden border border-gray-100 dark:border-slate-700/50 shadow-sm">
                          <summary className="flex items-center gap-2 p-2 bg-gray-50/50 dark:bg-slate-800/80 cursor-pointer list-none select-none hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
                              <span className="w-5 h-5 flex items-center justify-center bg-white dark:bg-slate-900 rounded text-slate-400 group-open:rotate-90 transition-transform"><i className="fa-solid fa-chevron-right text-[10px]"></i></span>
                              <span className="inline-block px-2 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-black uppercase rounded">{entry.partOfSpeech}</span>
                              <div className="flex-1"></div>
                          </summary>
                          <div className="p-3 space-y-3">
                            {entry.senses.map((s, j) => (
                              <div key={j} className="text-sm text-slate-700 dark:text-slate-300 group/sense relative">
                                <div className="leading-relaxed pr-8">
                                    {renderDefinitionContent(s.definition)}
                                </div>
                                <button 
                                    onClick={() => handleAddToAnkiOrTable(s.definition)} 
                                    className={`absolute right-0 top-0 transition-colors opacity-0 group-hover/sense:opacity-100 ${settings.dictExportMode === 'table' ? 'text-emerald-300 hover:text-emerald-500' : 'text-slate-300 hover:text-indigo-500'}`}
                                    title={settings.dictExportMode === 'table' ? "Add to Table" : "Add to Anki"}
                                >
                                    <i className="fa-solid fa-plus-circle"></i>
                                </button>
                              </div>
                            ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-20"><i className="fa-solid fa-book-open text-5xl"></i></div>
                  )}
              </div>
          </div>

          <div className={`h-full flex flex-col ${activeTab === 'script' ? 'block' : 'hidden'}`}>
             <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4 p-8 text-center">
                <i className="fa-solid fa-scroll text-4xl opacity-30"></i>
                <p className="text-xs">{t.dictWaitingExternal}</p>
             </div>
          </div>

          <div className={`h-full flex flex-col ${activeTab === 'web' ? 'block' : 'hidden'}`}>
              <div className="p-2 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/30 transition-colors flex items-center gap-2 overflow-x-auto no-scrollbar">
                  <div className="flex gap-0.5 shrink-0">
                      <button onClick={handleWebBack} disabled={webHistoryIndex <= 0} className="w-7 h-7 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-slate-700 rounded text-slate-500 dark:text-slate-400 disabled:opacity-30" title={t.webBack}><i className="fa-solid fa-arrow-left text-[10px]"></i></button>
                      <button onClick={handleWebForward} disabled={webHistoryIndex >= webHistory.length - 1} className="w-7 h-7 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-slate-700 rounded text-slate-500 dark:text-slate-400 disabled:opacity-30" title={t.webForward}><i className="fa-solid fa-arrow-right text-[10px]"></i></button>
                      <button onClick={handleWebRefresh} className="w-7 h-7 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-slate-700 rounded text-slate-500 dark:text-slate-400" title={t.webRefresh}><i className="fa-solid fa-rotate-right text-[10px]"></i></button>
                  </div>

                  <div className="h-4 w-px bg-gray-300 dark:bg-slate-700 shrink-0"></div>

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
                  
                  <button onClick={toggleLinkMode} className={`ml-auto w-7 h-7 flex items-center justify-center rounded shrink-0 ${settings.webLinkMode === 'inline' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}`} title={settings.webLinkMode === 'inline' ? "Inline" : "External"}>
                      <i className={`fa-solid ${settings.webLinkMode === 'inline' ? 'fa-up-right-from-square' : 'fa-arrow-up-right-from-square'} text-[10px]`}></i>
                  </button>
              </div>

              <div className="flex-1 relative bg-gray-100 dark:bg-black">
                   {/* Iframe or Placeholder */}
                   {settings.webLinkMode === 'inline' ? (
                       <iframe 
                           ref={iframeRef}
                           src={currentWebUrl} 
                           className="w-full h-full border-none bg-white" 
                           title="Web Search"
                           sandbox="allow-same-origin allow-scripts allow-forms"
                       />
                   ) : (
                       <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-4 p-8 text-center">
                           <i className="fa-solid fa-arrow-up-right-from-square text-4xl opacity-30"></i>
                           <p className="text-xs">Results opened in external browser.</p>
                           <button onClick={() => navigateToUrl(currentWebUrl)} className="px-4 py-2 bg-indigo-600 text-white rounded text-xs font-bold">Open Again</button>
                       </div>
                   )}
              </div>
          </div>

          <div className={`h-full flex flex-col ${activeTab === 'custom' ? 'block' : 'hidden'}`}>
             <div className="flex-1 p-4 flex flex-col gap-4">
                 <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 p-3 rounded-lg text-xs text-amber-800 dark:text-amber-200">
                     <i className="fa-solid fa-lightbulb mr-2"></i>
                     {t.dictOverride}
                 </div>
                 <textarea 
                    value={customDef}
                    onChange={(e) => setCustomDef(e.target.value)}
                    className="flex-1 w-full bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl p-4 text-slate-800 dark:text-white focus:border-indigo-500 outline-none resize-none text-sm transition-colors"
                    placeholder={t.dictCustomPlaceholder}
                 />
                 <button 
                    onClick={() => handleAddToAnkiOrTable()}
                    disabled={isAddingToAnki || !customDef.trim()}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50 active:scale-95"
                 >
                    {isAddingToAnki ? <i className="fa-solid fa-spinner animate-spin"></i> : t.saveToAnki}
                 </button>
             </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default memo(DictionaryModal);