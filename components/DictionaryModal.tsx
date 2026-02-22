
import React, { useState, useEffect, useRef, memo, useMemo, useCallback } from 'react';
import { DictionaryResponse, LearningLanguage, Language, SubtitleLine, SegmentationMode, WebSearchEngine, AnkiSettings, AudioTrack, ReaderSettings, TableEntry } from '../types';
import { getTranslation } from '../utils/i18n';
import { segmentText, isWord, isNonSpacedLang } from '../utils/textUtils';
import { lookupWord } from '../services/dictionaryService';
import { addNote } from '../services/ankiService';
import { extractAudioClip } from '../utils/audioUtils';
import { searchLocalDictionary, getLocalTagsForTerm } from '../utils/storage';
import { formatTime } from '../utils/parsers';
import { deinflector } from '../utils/deinflector';

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
  onTableSuccess?: () => void;
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

// Render component for Dictionary View (visual only)
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

// --- Plain Text Formatter for Export (Anki/Table) ---
const formatContentPlain = (content: any, depth: number = 0): string => {
    if (content === null || content === undefined) return '';

    if (Array.isArray(content)) {
        return content.map(child => formatContentPlain(child, depth)).join('');
    }

    if (typeof content === 'string') {
        return content;
    }

    if (typeof content === 'object') {
        if (content.type === 'structured-content' && content.content) {
            return formatContentPlain(content.content, depth);
        }

        const tag = content.tag;
        const inner = formatContentPlain(content.content, depth + 1);
        
        if (tag === 'li') return `\n${'  '.repeat(depth)}- ${inner}`;
        if (tag === 'div' || tag === 'p') return `\n${inner}`;
        if (tag === 'br') return '\n';
        
        return inner;
    }
    return '';
};

const DictionaryModal: React.FC<Props> = ({ 
  isOpen, onClose, initialWord, initialSegmentIndex, sentence, contextLine, 
  language, learningLanguage, ankiSettings, segmentationMode, webSearchEngine: defaultWebEngine, currentTrack, audioRef, ttsSettings,
  settings, setSettings, hasDictionaries, onAnkiSuccess, onTableSuccess
}) => {
  const t = getTranslation(language);
  const effectiveLearningLang = currentTrack?.language || learningLanguage;

  // Split state: inputText is what's in the box, activeSearchTerm is what's being looked up
  const [inputTerm, setInputTerm] = useState(initialWord);
  const [activeSearchTerm, setActiveSearchTerm] = useState(initialWord);
  
  // Independent caches for API and Local results
  const [apiData, setApiData] = useState<DictionaryResponse | null>(null);
  const [localData, setLocalData] = useState<DictionaryResponse | null>(null);
  const [apiError, setApiError] = useState('');
  const [localError, setLocalError] = useState('');
  const [apiLoading, setApiLoading] = useState(false);
  const [localLoading, setLocalLoading] = useState(false);

  // Preprocessing State
  const [enablePreprocessing, setEnablePreprocessing] = useState(false);
  const [preprocessedTerms, setPreprocessedTerms] = useState<string[]>([]);

  const [activeTab, setActiveTab] = useState<'dict' | 'script' | 'web' | 'custom'>(() => {
    const savedTab = localStorage.getItem('lf_dict_last_tab');
    if (savedTab === 'dict' || savedTab === 'script' || savedTab === 'web' || savedTab === 'custom') {
        return savedTab;
    }
    return 'dict';
  });

  useEffect(() => {
    localStorage.setItem('lf_dict_last_tab', activeTab);
  }, [activeTab]);
  
  // Persist Dict Source
  const [dictSource, setDictSource] = useState<'api' | 'local'>(() => {
      const stored = localStorage.getItem('lf_dict_source');
      return (stored === 'api' || stored === 'local') ? stored : (hasDictionaries ? 'local' : 'api');
  });

  // Custom Tab State
  const [customDef, setCustomDef] = useState('');
  const [customImage, setCustomImage] = useState<string>('');

  const [isPinned, setIsPinned] = useState(false);
  const [isAddingToAnki, setIsAddingToAnki] = useState(false);
  const [highlightRange, setHighlightRange] = useState<{start: number, end: number}>({start: initialSegmentIndex, end: initialSegmentIndex});
  
  // Web Tab State
  const [webCategory, setWebCategory] = useState<WebSearchCategory>('translate');
  const [currentWebEngine, setCurrentWebEngine] = useState<WebSearchEngine>(defaultWebEngine);
  const [webHistory, setWebHistory] = useState<string[]>([]);
  const [webHistoryIndex, setWebHistoryIndex] = useState(-1);
  const [isMobileView, setIsMobileView] = useState(false);
  const [showWebOverlay, setShowWebOverlay] = useState(false);
  const [webOverlayContent, setWebOverlayContent] = useState('');
  const [webOverlayImage, setWebOverlayImage] = useState<string>('');

  const iframeRef = useRef<HTMLIFrameElement>(null);

  const segments = useMemo(() => {
    if (settings.dictMode === 'sentence') {
        return [sentence];
    }
    return segmentText(sentence, effectiveLearningLang, segmentationMode);
  }, [sentence, effectiveLearningLang, segmentationMode, settings.dictMode]);

  // Persist source choice
  useEffect(() => {
      localStorage.setItem('lf_dict_source', dictSource);
  }, [dictSource]);

  useEffect(() => {
    if (['google', 'baidu', 'bing'].includes(defaultWebEngine)) setWebCategory('search');
    else if (['wikipedia', 'baidu_baike', 'moegirl'].includes(defaultWebEngine)) setWebCategory('encyclopedia');
    else setWebCategory('translate');
  }, [defaultWebEngine]);

  // Handle Preprocessing when inputText changes
  useEffect(() => {
      if (enablePreprocessing && inputTerm) {
          const results = deinflector.deinflect(inputTerm, effectiveLearningLang);
          const terms = results.map(r => r.term);
          // Deduplicate and filter empty
          setPreprocessedTerms([...new Set(terms)].filter(t => t));
      } else {
          setPreprocessedTerms([]);
      }
  }, [inputTerm, enablePreprocessing, effectiveLearningLang]);

  // Initial Load
  useEffect(() => {
    if (isOpen) {
      setInputTerm(initialWord);
      setActiveSearchTerm(initialWord);
      
      // Reset Web History
      setWebHistory([]);
      setWebHistoryIndex(-1);
      setCurrentWebEngine(defaultWebEngine);
      
      // Reset Caches for new word
      setApiData(null);
      setLocalData(null);
      setApiError('');
      setLocalError('');
      
      // Reset Custom/Web Overlay
      setCustomDef('');
      setCustomImage('');
      setWebOverlayContent('');
      setWebOverlayImage('');
      setShowWebOverlay(false);

      if (initialWord) {
          fetchDefinition(initialWord, dictSource);
      }
      
      if (settings.dictMode === 'sentence') {
          setHighlightRange({start: 0, end: 0});
      } else {
          setHighlightRange({start: initialSegmentIndex, end: initialSegmentIndex});
      }
    }
    // IMPORTANT: removed dictSource from dependencies to prevent reset on source switch
  }, [isOpen, initialWord, initialSegmentIndex, sentence, settings.dictMode]);

  const fetchDefinition = async (term: string, source: 'api' | 'local') => {
    if (!term) return;
    
    if (source === 'local') {
        setLocalLoading(true);
        setLocalError('');
        setLocalData(null); 
        try {
            const result = await searchLocalDictionary(term, effectiveLearningLang);
            if (result) setLocalData(result);
            else setLocalError(hasDictionaries ? t.dictNoResult : t.localDictEmpty);
        } catch (e) { setLocalError(t.dictNoResult); }
        finally { setLocalLoading(false); }
    } else {
        setApiLoading(true);
        setApiError('');
        setApiData(null); 
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
      let url = '';
      
      switch (engine) {
          case 'google': url = `https://www.google.com/search?q=${encodedTerm}&igu=1`; break;
          case 'baidu': url = `https://www.baidu.com/s?wd=${encodedTerm}`; break;
          case 'baidu_baike': url = `https://baike.baidu.com/item/${encodedTerm}`; break;
          case 'bing': url = `https://www.bing.com/search?q=${encodedTerm}`; break;
          case 'bing_trans': url = `https://www.bing.com/translator/?text=${encodedTerm}&to=${targetLang}`; break;
          case 'baidu_trans': url = `https://fanyi.baidu.com/#en/zh/${encodedTerm}`; break;
          case 'sogou_trans': url = `https://fanyi.sogou.com/text?keyword=${encodedTerm}`; break;
          case 'wikipedia': url = `https://wikipedia.org/wiki/${encodedTerm}`; break;
          case 'moegirl': url = `https://zh.moegirl.org.cn/${encodedTerm}`; break;
          default: url = `https://www.google.com/search?q=${encodedTerm}`;
      }

      if (isMobileView) {
          if (url.includes('wikipedia.org')) url = url.replace('wikipedia.org', 'm.wikipedia.org');
          // Add other mobile specific transformations if needed
      } else {
          if (url.includes('m.wikipedia.org')) url = url.replace('m.wikipedia.org', 'wikipedia.org');
      }
      return url;
  };

  const navigateToUrl = (url: string) => {
      if (settings.webLinkMode === 'external') {
          window.open(url, '_blank');
      } else {
        const newHistory = webHistory.slice(0, webHistoryIndex + 1);
        newHistory.push(url);
        setWebHistory(newHistory);
        setWebHistoryIndex(newHistory.length - 1);
      }
  };

  const handleSearch = (term?: string) => {
    const actualTerm = term || inputTerm;
    if (!actualTerm.trim()) return;
    
    // Update active term if we are searching manually
    if (!term) setActiveSearchTerm(inputTerm);
    else setActiveSearchTerm(actualTerm);

    // Always fetch for the current source when actively searching
    fetchDefinition(actualTerm, dictSource);

    const url = constructWebSearchUrl(currentWebEngine, actualTerm);
    if (settings.webLinkMode !== 'external') {
      setWebHistory([url]);
      setWebHistoryIndex(0);
    }
  };

  const handlePreprocessingSelect = (term: string) => {
      // Update active term for display/lookup, but KEEP input term as is
      setActiveSearchTerm(term);
      fetchDefinition(term, dictSource);
      
      const url = constructWebSearchUrl(currentWebEngine, term);
      if (settings.webLinkMode !== 'external') {
        setWebHistory([url]);
        setWebHistoryIndex(0);
      }
  };

  const handleSourceSwitch = (newSource: 'api' | 'local') => {
      setDictSource(newSource);
      // Use activeSearchTerm instead of inputTerm to maintain consistency with preprocessing
      if (newSource === 'api' && !apiData && !apiLoading) {
          fetchDefinition(activeSearchTerm, newSource);
      } else if (newSource === 'local' && !localData && !localLoading) {
          fetchDefinition(activeSearchTerm, newSource);
      }
  };

  const handleAppendSegment = useCallback(() => {
    if (highlightRange.end + 1 >= segments.length) return;
    const nextIdx = highlightRange.end + 1;
    const nextSeg = segments[nextIdx];
    let newTerm = inputTerm;
    if (!isNonSpacedLang(effectiveLearningLang) && newTerm && !newTerm.endsWith(' ')) {
      newTerm += ' ';
    }
    newTerm += nextSeg;
    setInputTerm(newTerm);
    setActiveSearchTerm(newTerm);
    setHighlightRange(prev => ({ ...prev, end: nextIdx }));
    handleSearch(newTerm);
  }, [inputTerm, segments, highlightRange, effectiveLearningLang, activeTab, currentWebEngine, settings.webLinkMode, dictSource]);

  const handleCopyFullSentence = () => {
      setInputTerm(sentence);
      setActiveSearchTerm(sentence);
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
    if (!activeSearchTerm) return;
    const utterance = new SpeechSynthesisUtterance(activeSearchTerm);
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
  
  const currentData = dictSource === 'api' ? apiData : localData;
  const currentLoading = dictSource === 'api' ? apiLoading : localLoading;
  const currentError = dictSource === 'api' ? apiError : localError;

  const allHeaderTags = useMemo(() => {
    if (!currentData) return [];
    const set = new Set<string>();
    currentData.entries.forEach(e => {
        if (e.tags) e.tags.forEach(t => set.add(t));
    });
    return Array.from(set);
  }, [currentData]);

  const formatDefinitionForExport = (dictData: DictionaryResponse): string => {
      if (!dictData.entries || dictData.entries.length === 0) return dictData.word;
      
      let text = "";
      
      dictData.entries.forEach((entry, idx) => {
          if (idx > 0) text += "\n\n";
          text += `[${entry.partOfSpeech}]\n`;
          
          entry.senses.forEach((s, sIdx) => {
              let defContent = s.definition;
              try {
                  if (typeof defContent === 'string' && defContent.trim().startsWith('{')) {
                      const parsed = JSON.parse(defContent);
                      if (parsed.type === 'structured-content') {
                         defContent = formatContentPlain(parsed);
                      }
                  }
              } catch (e) { }
              text += `${sIdx + 1}. ${defContent}\n`;
          });
      });
      return text.trim();
  };

  const saveToTable = (entry: Omit<TableEntry, 'id'>) => {
    const tableKey = 'lf_vocab_table';
    const raw = localStorage.getItem(tableKey);
    const table: TableEntry[] = raw ? JSON.parse(raw) : [];
    table.push({ ...entry, id: crypto.randomUUID() });
    localStorage.setItem(tableKey, JSON.stringify(table));
    if (onTableSuccess) onTableSuccess();
  };

  const handleAddToAnkiOrTable = async (contentOverride?: string) => {
    if (activeTab === 'custom' && !customDef.trim() && !customImage) {
        alert(language === 'zh' ? "请输入内容" : "Please enter content");
        return;
    }

    let definition = '';
    let imageBase64: string | undefined = undefined;

    // Determine content based on tab
    if (activeTab === 'custom') {
        definition = customDef;
        if (customImage) imageBase64 = customImage;
    } else if (activeTab === 'web' && showWebOverlay) {
        definition = webOverlayContent;
        if (webOverlayImage) imageBase64 = webOverlayImage;
    } else if (contentOverride) {
        definition = contentOverride;
        try {
            if (definition.trim().startsWith('{')) {
                const parsed = JSON.parse(definition);
                if(parsed.type === 'structured-content') {
                  definition = formatContentPlain(parsed);
                }
            }
        } catch(e) {}
    } else if (activeTab === 'dict' && currentData) {
        definition = formatDefinitionForExport(currentData);
    } else if (!customDef && activeTab === 'dict') {
        definition = activeSearchTerm;
    }

    const examVocabContent = allHeaderTags.length > 0 ? allHeaderTags.join(' ') : '';
    const word = activeSearchTerm;
    const sent = settings.ankiBoldWord ? sentence.replace(activeSearchTerm, `<b>${activeSearchTerm}</b>`) : sentence;

    if (settings.dictExportMode === 'table') {
        saveToTable({
            word,
            definition: definition || (imageBase64 ? '[Image]' : ''),
            sentence: sent,
            translation: '', 
            tags: examVocabContent,
            sourceTitle: currentTrack?.title || 'Unknown Source',
            timeRange: `${formatTime(contextLine.start)} - ${formatTime(contextLine.end)}`,
            addedAt: Date.now()
        });
        return;
    }

    setIsAddingToAnki(true);
    try {
      let audioBase64 = undefined;
      if (ankiSettings.fieldMap.audio && currentTrack?.file) {
        audioBase64 = await extractAudioClip(currentTrack.file, contextLine.start, contextLine.end);
      }

      const isSentenceMode = settings.dictMode === 'sentence';
      let effectiveFieldMap = ankiSettings.fieldMap;
      if (isSentenceMode && ankiSettings.sentenceFieldMap && Object.keys(ankiSettings.sentenceFieldMap).length > 0) {
          effectiveFieldMap = { ...ankiSettings.fieldMap, ...ankiSettings.sentenceFieldMap };
      }

      const tempSettings: AnkiSettings = { ...ankiSettings, fieldMap: effectiveFieldMap as any };

      await addNote(tempSettings, {
        word: word,
        definition: definition || word,
        sentence: sent,
        translation: '',
        audioBase64,
        imageBase64, // Pass the image
        examVocab: examVocabContent
      });
      
      if (onAnkiSuccess) onAnkiSuccess();
    } catch (e) { 
        console.error(e);
        alert(t.ankiError); 
    }
    finally { setIsAddingToAnki(false); }
  };

  const handleWebBack = () => { if (webHistoryIndex > 0) setWebHistoryIndex(webHistoryIndex - 1); };
  const handleWebForward = () => { if (webHistoryIndex < webHistory.length - 1) setWebHistoryIndex(webHistoryIndex + 1); };
  const handleWebRefresh = () => { if (iframeRef.current) iframeRef.current.src = iframeRef.current.src; };

  const switchWebEngine = (engine: WebSearchEngine) => {
      setCurrentWebEngine(engine);
      setSettings({ ...settings, webSearchEngine: engine });
      const url = constructWebSearchUrl(engine, activeSearchTerm);
      navigateToUrl(url); 
  };

  const toggleClipboard = () => setSettings({...settings, copyToClipboard: !settings.copyToClipboard});
  
  const toggleLinkMode = () => {
      const newMode = settings.webLinkMode === 'inline' ? 'external' : 'inline';
      setSettings({...settings, webLinkMode: newMode});
  };

  const toggleDictMode = () => {
      const newMode = settings.dictMode === 'word' ? 'sentence' : 'word';
      setSettings({...settings, dictMode: newMode});
      if (newMode === 'sentence') {
          setInputTerm(sentence);
          setActiveSearchTerm(sentence);
          setHighlightRange({start: 0, end: 0});
          fetchDefinition(sentence, dictSource);
          const url = constructWebSearchUrl(currentWebEngine, sentence);
          if (settings.webLinkMode !== 'external') {
            setWebHistory([url]);
            setWebHistoryIndex(0);
          }
      } else {
          setInputTerm('');
          setActiveSearchTerm('');
          setHighlightRange({start: -1, end: -1});
      }
  };
  
  const toggleExportMode = () => {
      const newMode = settings.dictExportMode === 'table' ? 'anki' : 'table';
      setSettings({...settings, dictExportMode: newMode});
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, target: 'custom' | 'web') => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onloadend = () => {
          const base64 = reader.result as string;
          if (target === 'custom') setCustomImage(base64);
          else setWebOverlayImage(base64);
      };
      reader.readAsDataURL(file);
      e.target.value = '';
  };

  const handleTextImport = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
          const text = ev.target?.result as string;
          setCustomDef(text);
      };
      reader.readAsText(file);
      e.target.value = '';
  };

  const renderWebOptions = () => {
      switch(webCategory) {
          case 'search': return <><option value="google">Google</option><option value="baidu">Baidu</option><option value="bing">Bing</option></>;
          case 'encyclopedia': return <><option value="wikipedia">Wikipedia</option><option value="baidu_baike">Baidu Baike</option><option value="moegirl">Moegirl</option></>;
          case 'translate': default: return <><option value="bing_trans">Bing Translator</option><option value="baidu_trans">Baidu</option><option value="sogou_trans">Sogou</option></>;
      }
  };

  const renderDefinitionContent = (definition: string) => {
      try {
          if (definition.trim().startsWith('{')) {
              const parsed = JSON.parse(definition);
              if (parsed.type === 'structured-content') {
                  return <StructuredContent content={parsed} />;
              }
          }
      } catch (e) { }
      
      if (/[①-⑳㋐-㋾▲△ᐅ〔]/.test(definition)) {
          const parts = definition.split(/(?=[①-⑳㋐-㋾▲△ᐅ〔])/);
          return (
            <div className="leading-snug text-sm">
                {parts.map((part, i) => {
                    const cleanPart = part.trim();
                    if (!cleanPart) return null;
                    if (part.match(/^[①-⑳]/)) return <div key={i} className="mt-1 mb-0.5 pl-1 border-l-2 border-indigo-200 dark:border-indigo-800"><span className="font-bold text-indigo-600 dark:text-indigo-400 mr-1">{part.charAt(0)}</span>{part.substring(1)}</div>;
                    if (part.match(/^[㋐-㋾]/)) return <div key={i} className="ml-4 mt-0.5"><span className="font-bold text-slate-600 dark:text-slate-400 mr-1">{part.charAt(0)}</span>{part.substring(1)}</div>;
                    return <div key={i} className="mb-0.5">{part}</div>;
                })}
            </div>
          );
      }
      return definition;
  };

  const currentWebUrl = webHistory.length > 0 ? webHistory[webHistoryIndex] : constructWebSearchUrl(currentWebEngine, activeSearchTerm);
  const isCJK = isNonSpacedLang(effectiveLearningLang);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[90]" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full md:w-[450px] bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-700 shadow-2xl z-[100] flex flex-col transition-all animate-slide-in">
        <div className="p-4 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 flex flex-col gap-3 shrink-0 transition-colors">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
                <button onClick={() => setEnablePreprocessing(!enablePreprocessing)} className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold border transition-colors ${enablePreprocessing ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-400 border-gray-300 dark:border-slate-600'}`} title="Preprocessing Toggle">[P]</button>
                <h3 className="font-bold flex items-center gap-2 text-slate-800 dark:text-white text-sm"><i className="fa-solid fa-book text-indigo-500 dark:text-indigo-400"></i> {t.dictClassic}</h3>
                
                <button onClick={toggleDictMode} className={`ml-2 p-1.5 rounded text-[10px] font-bold uppercase tracking-wide border transition-all ${settings.dictMode === 'sentence' ? 'bg-indigo-100 text-indigo-600 border-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30' : 'bg-gray-100 text-slate-500 border-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'}`} title={settings.dictMode === 'sentence' ? "Sentence Mode" : "Word Mode"}>
                    {settings.dictMode === 'sentence' ? (language === 'zh' ? '句子模式' : 'SENTENCE') : (language === 'zh' ? '单词模式' : 'WORD')}
                </button>

                <button onClick={toggleExportMode} className={`ml-1 p-1.5 rounded text-[10px] font-bold uppercase tracking-wide border transition-all ${settings.dictExportMode === 'table' ? 'bg-emerald-100 text-emerald-600 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30' : 'bg-blue-100 text-blue-600 border-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/30'}`} title={settings.dictExportMode === 'table' ? "Table Collection Mode" : "Anki Card Mode"}>
                    {settings.dictExportMode === 'table' ? (language === 'zh' ? '表格模式' : 'TABLE') : (language === 'zh' ? 'ANKI模式' : 'ANKI')}
                </button>
            </div>
            
            <div className="flex items-center gap-2">
              <button onClick={() => setIsPinned(!isPinned)} className={`p-2 rounded-full ${isPinned ? 'text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-400/10' : 'text-slate-400 hover:text-slate-600 dark:hover:text-white'}`}><i className="fa-solid fa-thumbtack"></i></button>
              <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white"><i className="fa-solid fa-xmark"></i></button>
            </div>
          </div>
          <div className="relative flex gap-1">
            <div className="relative flex-1">
                <input 
                  value={inputTerm} onChange={(e) => setInputTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl pl-4 pr-36 py-2 text-sm text-slate-800 dark:text-white focus:border-indigo-500 outline-none transition-colors"
                  placeholder={t.search}
                />
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button onClick={handleAppendSegment} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white" title={t.appendSegment}><i className="fa-solid fa-plus"></i></button>
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
            {enablePreprocessing && preprocessedTerms.length > 0 && (
                <select 
                    onChange={(e) => handlePreprocessingSelect(e.target.value)}
                    className="w-24 bg-indigo-50 dark:bg-slate-800 border border-indigo-200 dark:border-slate-600 rounded-xl text-xs px-2 text-indigo-700 dark:text-indigo-300 outline-none"
                    value=""
                >
                    <option value="" disabled>Prep...</option>
                    {preprocessedTerms.map((term, i) => <option key={i} value={term}>{term}</option>)}
                </select>
            )}
          </div>
        </div>

        {/* Word Bar - Only Visible in Word Mode */}
        {settings.dictMode === 'word' && (
            <div className="bg-gray-50 dark:bg-slate-800/30 border-b border-gray-200 dark:border-slate-700/50 p-3 flex gap-2 items-center shrink-0 transition-colors">
              <div className={`flex-1 flex flex-wrap text-sm text-slate-600 dark:text-slate-300 ${isCJK ? 'gap-0' : 'gap-1'}`}>
                {segments.map((seg, i) => {
                  const isHighlighted = i >= highlightRange.start && i <= highlightRange.end;
                  return (
                      <span key={i} onClick={() => { setInputTerm(seg); setActiveSearchTerm(seg); setHighlightRange({start: i, end: i}); handleSearch(seg); if(settings.copyToClipboard) navigator.clipboard.writeText(seg); }} 
                        className={`cursor-pointer hover:text-indigo-500 dark:hover:text-indigo-400 px-0 rounded ${isHighlighted ? 'text-indigo-600 dark:text-indigo-300 font-bold underline decoration-indigo-500/50' : ''}`}>
                        {seg}
                      </span>
                  );
                })}
              </div>
              <button onClick={handleReplaySentence} className="p-2 text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 shrink-0" title={t.replaySentence}><i className="fa-solid fa-rotate-right"></i></button>
            </div>
        )}

        {/* Sentence Bar - Only Visible in Sentence Mode */}
        {settings.dictMode === 'sentence' && (
            <div className="bg-gray-50 dark:bg-slate-800/30 border-b border-gray-200 dark:border-slate-700/50 p-3 flex gap-2 items-center shrink-0 transition-colors">
              <div className={`flex-1 flex flex-wrap text-sm text-slate-600 dark:text-slate-300 ${isCJK ? 'gap-0' : 'gap-1'}`}>
                {segmentText(sentence, effectiveLearningLang, segmentationMode).map((seg, i) => {
                  return (
                      <span key={i} onClick={() => { 
                          // When clicking a segment in sentence mode, we switch to word mode for that segment?
                          // Or just search that segment but stay in sentence mode?
                          // User said: "Remember displaying sentence and clickable segments is the Sentence Bar"
                          // And "Switching to sentence mode puts the whole sentence into search bar"
                          // So clicking here should probably search the segment.
                          setInputTerm(seg); 
                          setActiveSearchTerm(seg); 
                          // setHighlightRange({start: i, end: i}); // Highlight range might not match if segments are re-calculated
                          handleSearch(seg); 
                          if(settings.copyToClipboard) navigator.clipboard.writeText(seg); 
                      }} 
                        className={`cursor-pointer hover:text-indigo-500 dark:hover:text-indigo-400 px-0 rounded`}>
                        {seg}
                      </span>
                  );
                })}
              </div>
              <button onClick={handleReplaySentence} className="p-2 text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 shrink-0" title={t.replaySentence}><i className="fa-solid fa-rotate-right"></i></button>
            </div>
        )}

        {settings.dictMode === 'word' && (
        <div className="p-2 border-b border-gray-200 dark:border-slate-700 flex flex-col bg-gray-50 dark:bg-slate-800/30 transition-colors shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-slate-800 dark:text-white px-2 truncate max-w-[200px]">{activeSearchTerm}</span>
                <button onClick={handleTTS} className="text-slate-400 hover:text-slate-800 dark:hover:text-white"><i className="fa-solid fa-volume-high"></i></button>
                {allHeaderTags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                      {allHeaderTags.map((tag, idx) => (
                          <span key={idx} className="inline-block px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 text-[9px] font-bold uppercase rounded border border-indigo-100 dark:border-indigo-800/50">{tag}</span>
                      ))}
                  </div>
                )}
            </div>
            {activeTab === 'dict' && (
                <div className="flex bg-gray-200 dark:bg-slate-900 rounded p-0.5 border border-gray-300 dark:border-slate-700 shrink-0 ml-2">
                    <button onClick={() => handleSourceSwitch('api')} className={`px-2 py-0.5 text-[10px] rounded transition-all ${dictSource === 'api' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500'}`}>API</button>
                    <button onClick={() => handleSourceSwitch('local')} className={`px-2 py-0.5 text-[10px] rounded transition-all ${dictSource === 'local' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500'}`}>Local</button>
                </div>
            )}
          </div>
        </div>
        )}

        <div className="flex justify-around border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/20 shrink-0 transition-colors">
          {(['dict', 'script', 'web', 'custom'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-all ${activeTab === tab ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-white dark:bg-white/5' : 'border-transparent text-slate-500'}`}>
              {tab === 'dict' ? t.dictClassic : tab === 'script' ? t.dictScript : tab === 'web' ? t.dictWeb : t.dictDictionary}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-hidden relative bg-white dark:bg-slate-900 transition-colors">
          <div className={`h-full flex flex-col ${activeTab === 'dict' ? 'block' : 'hidden'}`}>
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
                      <button onClick={handleWebBack} disabled={webHistoryIndex <= 0} className="w-7 h-7 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-slate-700 rounded text-slate-500 dark:text-slate-400 disabled:opacity-30"><i className="fa-solid fa-arrow-left text-[10px]"></i></button>
                      <button onClick={handleWebForward} disabled={webHistoryIndex >= webHistory.length - 1} className="w-7 h-7 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-slate-700 rounded text-slate-500 dark:text-slate-400 disabled:opacity-30"><i className="fa-solid fa-arrow-right text-[10px]"></i></button>
                      <button onClick={handleWebRefresh} className="w-7 h-7 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-slate-700 rounded text-slate-500 dark:text-slate-400"><i className="fa-solid fa-rotate-right text-[10px]"></i></button>
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
                  <button onClick={() => setIsMobileView(!isMobileView)} className={`ml-auto w-7 h-7 flex items-center justify-center rounded shrink-0 ${isMobileView ? 'bg-indigo-100 text-indigo-600' : 'text-slate-500'}`} title="Mobile View"><i className="fa-solid fa-mobile-screen text-[10px]"></i></button>
                  <button onClick={toggleLinkMode} className={`w-7 h-7 flex items-center justify-center rounded shrink-0 ${settings.webLinkMode === 'inline' ? 'bg-indigo-100 text-indigo-600' : 'text-slate-500'}`}><i className={`fa-solid ${settings.webLinkMode === 'inline' ? 'fa-up-right-from-square' : 'fa-arrow-up-right-from-square'} text-[10px]`}></i></button>
                  <button onClick={() => setShowWebOverlay(!showWebOverlay)} className={`w-7 h-7 flex items-center justify-center rounded shrink-0 ${showWebOverlay ? 'bg-indigo-100 text-indigo-600' : 'text-slate-500'}`} title="Custom Notes"><i className="fa-solid fa-pen-to-square text-[10px]"></i></button>
              </div>

              <div className="flex-1 relative bg-gray-100 dark:bg-black overflow-hidden flex flex-col">
                   {settings.webLinkMode === 'inline' ? (
                       <iframe 
                           ref={iframeRef}
                           src={currentWebUrl} 
                           className="w-full flex-1 border-none bg-white" 
                           title="Web Search"
                           sandbox="allow-same-origin allow-scripts allow-forms"
                       />
                   ) : (
                       <div className="w-full flex-1 flex flex-col items-center justify-center text-slate-500 gap-4 p-8 text-center">
                           <i className="fa-solid fa-arrow-up-right-from-square text-4xl opacity-30"></i>
                           <p className="text-xs">Results opened in external browser.</p>
                           <button onClick={() => navigateToUrl(currentWebUrl)} className="px-4 py-2 bg-indigo-600 text-white rounded text-xs font-bold">Open Again</button>
                       </div>
                   )}
                   
                   {showWebOverlay && (
                       <div className="bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-700 p-2 shadow-xl shrink-0 h-32 flex flex-col gap-2 animate-slide-in-up">
                           <div className="flex justify-between items-center">
                               <span className="text-[10px] font-bold text-slate-500 uppercase">{t.webCustomNotes}</span>
                               <div className="flex gap-2">
                                   <label className="cursor-pointer text-slate-500 hover:text-indigo-500" title="Upload Image"><i className="fa-solid fa-image"></i><input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, 'web')} /></label>
                               </div>
                           </div>
                           <div className="flex gap-2 flex-1 min-h-0">
                               <textarea 
                                   value={webOverlayContent}
                                   onChange={(e) => setWebOverlayContent(e.target.value)}
                                   className="flex-1 bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded p-2 text-xs resize-none outline-none"
                                   placeholder="Quick notes..."
                               />
                               {webOverlayImage && (
                                   <div className="relative w-20 h-full bg-gray-100 dark:bg-slate-800 rounded border border-gray-200 dark:border-slate-700 shrink-0">
                                       <img src={webOverlayImage} alt="Custom" className="w-full h-full object-cover rounded" />
                                       <button onClick={() => setWebOverlayImage('')} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center text-[8px] shadow-sm">✕</button>
                                   </div>
                               )}
                           </div>
                       </div>
                   )}
              </div>
          </div>

          <div className={`h-full flex flex-col ${activeTab === 'custom' ? 'block' : 'hidden'}`}>
             <div className="flex-1 p-4 flex flex-col gap-3">
                 <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 p-3 rounded-lg text-xs text-amber-800 dark:text-amber-200 shrink-0">
                     <i className="fa-solid fa-lightbulb mr-2"></i> {t.dictOverride}
                 </div>
                 
                 <div className="flex justify-between items-center bg-gray-50 dark:bg-slate-800/50 p-2 rounded-lg border border-gray-200 dark:border-slate-700 shrink-0">
                     <div className="flex gap-2">
                         <label className="px-2 py-1 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded text-[10px] font-bold cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors flex items-center gap-1">
                             <i className="fa-solid fa-image text-indigo-500"></i> Image
                             <input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, 'custom')} />
                         </label>
                         <label className="px-2 py-1 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded text-[10px] font-bold cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors flex items-center gap-1">
                             <i className="fa-solid fa-file-lines text-indigo-500"></i> Text
                             <input type="file" className="hidden" accept=".txt,.md" onChange={handleTextImport} />
                         </label>
                     </div>
                     <div className="flex gap-2">
                         <button onClick={toggleClipboard} className={`px-2 py-1 rounded text-[10px] font-bold border ${settings.copyToClipboard ? 'bg-indigo-100 text-indigo-600 border-indigo-300' : 'bg-white dark:bg-slate-700 border-gray-300 dark:border-slate-600 text-slate-500 dark:text-slate-300'}`}>{t.clipboardMode}</button>
                         <button onClick={() => { setCustomDef(''); setCustomImage(''); }} className="px-2 py-1 rounded text-[10px] font-bold border border-red-200 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">Clear</button>
                     </div>
                 </div>

                 <div className="flex-1 flex flex-col gap-3 min-h-0">
                     <textarea 
                        value={customDef}
                        onChange={(e) => setCustomDef(e.target.value)}
                        className="flex-1 w-full bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl p-4 text-slate-800 dark:text-white focus:border-indigo-500 outline-none resize-none text-sm transition-colors"
                        placeholder={t.dictCustomPlaceholder}
                     />
                     
                     {customImage && (
                         <div className="relative h-32 w-full bg-gray-100 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shrink-0 overflow-hidden group">
                             <img src={customImage} alt="Custom Upload" className="w-full h-full object-contain" />
                             <div className="absolute top-2 right-2">
                                 <button onClick={() => setCustomImage('')} className="w-6 h-6 bg-red-500 text-white rounded-full shadow-md flex items-center justify-center hover:scale-110 transition-transform"><i className="fa-solid fa-xmark text-xs"></i></button>
                             </div>
                         </div>
                     )}
                 </div>
                 
                 <div className="text-center text-xs text-slate-400 italic pb-1">Use the save button in the header to add card.</div>
             </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default memo(DictionaryModal);
