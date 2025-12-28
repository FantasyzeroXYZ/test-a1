
import React, { useState, useEffect, useRef, memo, useMemo, useCallback } from 'react';
import { DictionaryResponse, LearningLanguage, Language, SubtitleLine, SegmentationMode, DictionaryTab, WebSearchEngine, AudioTrack } from '../types';
import { getTranslation } from '../utils/i18n';
import { segmentText, isWord, isNonSpacedLang } from '../utils/textUtils';
import { lookupWord } from '../services/dictionaryService';
import { extractAudioClip } from '../utils/audioUtils';

// Define a common interface for icon props to allow className
interface IconProps {
  className?: string;
}

// Update memoized icon components to accept and apply className
const SearchIcon = memo(({ className }: IconProps) => <i className={`fa-solid fa-magnifying-glass ${className || ''}`}></i>);
const AnkiIcon = memo(({ className }: IconProps) => <i className={`fa-solid fa-graduation-cap ${className || ''}`}></i>);
const LoaderIcon = memo(({ className }: IconProps) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`animate-spin ${className || ''}`}><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>);
const XIcon = memo(({ className }: IconProps) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className || ''}><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>);
const AppendIcon = memo(({ className }: IconProps) => <i className={`fa-solid fa-plus ${className || ''}`}></i>); 

// Base URLs for different search engines
const WEB_SEARCH_URLS: Record<WebSearchEngine, string> = {
  google: 'https://www.google.com/search?q=',
  baidu: 'https://www.baidu.com/s?wd=',
  baidu_baike: 'https://baike.baidu.com/item/',
  bing: 'https://www.bing.com/search?q=',
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialWord: string;
  initialSegmentIndex: number;
  sentence: string;
  contextLine: SubtitleLine;
  language: Language;
  learningLanguage: LearningLanguage;
  onAddToAnki: (definition: string, sentence: string, audioBase64?: string) => Promise<void>;
  isAddingToAnki: boolean;
  variant?: 'bottom-sheet' | 'sidebar';
  audioRef?: React.RefObject<HTMLAudioElement>;
  hasAudioField: boolean;
  segmentationMode: SegmentationMode;
  webSearchEngine: WebSearchEngine; // 从设置传入
  currentTrack?: AudioTrack; // 需要当前轨道信息来获取源文件
}

export const DictionaryModal: React.FC<Props> = ({ 
  isOpen, onClose, initialWord, initialSegmentIndex, sentence, contextLine, language, learningLanguage, onAddToAnki, isAddingToAnki, variant = 'sidebar', audioRef, hasAudioField, segmentationMode, webSearchEngine, currentTrack
}) => {
  const t = getTranslation(language);
  const [searchQuery, setSearchQuery] = useState('');
  const [data, setData] = useState<DictionaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<DictionaryTab>('dictionary'); // 默认标签页
  const [userscriptHtmlContent, setUserscriptHtmlContent] = useState<string>('');
  const [webCustomNotes, setWebCustomNotes] = useState(''); // Only for web tab
  const [currentAppendSegmentIndex, setCurrentAppendSegmentIndex] = useState<number>(-1); // 用于追加分词
  
  // Refs for content extraction
  const userscriptOutputRef = useRef<HTMLDivElement>(null); // 用于获取油猴脚本的 innerHTML
  const dictionaryContentRef = useRef<HTMLDivElement>(null); // 用于获取原生词典的 innerHTML

  const [isProcessing, setIsProcessing] = useState(false); // Controls button state during auto-record/send
  
  // Refs for recording logic
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // 分词后的句子，用于点击和追加
  const sentenceSegments = useMemo(() => {
    return segmentText(sentence, learningLanguage, segmentationMode);
  }, [sentence, learningLanguage, segmentationMode]);

  // 重置追加分词索引
  useEffect(() => {
    if (isOpen) {
      const initialWordSegments = segmentText(initialWord, learningLanguage, segmentationMode);
      if (initialWordSegments.length > 0) {
        let foundIndex = -1;
        for(let i=0; i < sentenceSegments.length; i++) {
          if (sentenceSegments[i] === initialWordSegments[0]) {
            foundIndex = i;
            break;
          }
        }
        setCurrentAppendSegmentIndex(foundIndex !== -1 ? foundIndex + 1 : 0);
      } else {
        setCurrentAppendSegmentIndex(0);
      }
      
      setWebCustomNotes(''); // Reset web custom notes
      setIsProcessing(false);
    }
  }, [initialWord, isOpen, sentenceSegments, learningLanguage, segmentationMode]);

  // 油猴脚本通信 - 接收消息 (VAM_SEARCH_RESPONSE)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && typeof event.data === 'object' && event.data.type === 'VAM_SEARCH_RESPONSE') {
        const payload = event.data.payload;
        if (payload && payload.html) {
            setUserscriptHtmlContent(payload.html);
        } else if (payload && payload.error) {
            setUserscriptHtmlContent(`<div class="text-red-400 p-4 text-center">${payload.error}</div>`);
        }
        
        if (activeTab === 'userscript') {
          setLoading(false); 
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [activeTab]);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery(initialWord);
      fetchData(initialWord, activeTab); 
    }
  }, [initialWord, isOpen]);

  const fetchData = async (term: string, targetTab: DictionaryTab = activeTab) => {
    if (!term.trim()) return;
    setLoading(true);
    setError('');

    if (targetTab === 'dictionary') {
      const result = await lookupWord(term, learningLanguage);
      if (result) {
        setData(result);
      } else {
        setError(t.dictNoResult);
        setData(null); 
      }
      setLoading(false);
    } else if (targetTab === 'userscript') {
      window.postMessage({
        type: 'VAM_SEARCH_REQUEST',
        payload: {
            word: term,
            lang: learningLanguage
        }
      }, '*');
    } else {
      setLoading(false); 
    }
  };

  const handleSearch = () => {
    fetchData(searchQuery); 
  };

  const handleSegmentClick = (segment: string, index: number) => {
    setSearchQuery(segment);
    let nextAppendIndex = index + 1;
    while(nextAppendIndex < sentenceSegments.length && !isWord(sentenceSegments[nextAppendIndex])) {
        nextAppendIndex++;
    }
    setCurrentAppendSegmentIndex(nextAppendIndex);
    fetchData(segment, activeTab);
  };

  const handleAppendSegment = useCallback(() => {
    if (sentenceSegments.length === 0) return;

    let nextWordIndex = -1;
    for (let i = currentAppendSegmentIndex; i < sentenceSegments.length; i++) {
      if (isWord(sentenceSegments[i])) {
        nextWordIndex = i;
        break;
      }
    }

    if (nextWordIndex === -1) {
      setCurrentAppendSegmentIndex(0); 
      return;
    }

    let newQuery = searchQuery;
    const nextSegmentToAppend = sentenceSegments[nextWordIndex];

    if (newQuery.length > 0) {
        let lastQueryPartIndexInSentence = -1;
        let tempQuery = newQuery;
        for (let i = nextWordIndex - 1; i >= 0; i--) {
            if (tempQuery.endsWith(sentenceSegments[i])) {
                tempQuery = tempQuery.slice(0, tempQuery.length - sentenceSegments[i].length);
                if (tempQuery.trim().length === 0) {
                    lastQueryPartIndexInSentence = i;
                    break;
                }
            }
        }

        if (lastQueryPartIndexInSentence !== -1 && lastQueryPartIndexInSentence < nextWordIndex) {
            let needsSpace = false;
            for (let i = lastQueryPartIndexInSentence + 1; i < nextWordIndex; i++) {
                if (sentenceSegments[i].match(/\s/)) { 
                    needsSpace = true;
                    break;
                }
            }
            if (needsSpace && !newQuery.endsWith(' ')) {
                newQuery += ' ';
            } else if (!needsSpace && newQuery.endsWith(' ')) {
                newQuery = newQuery.trimEnd(); 
            }
        } else {
            if (!isNonSpacedLang(learningLanguage) && !newQuery.endsWith(' ')) {
                newQuery += ' ';
            }
        }
    }
    newQuery += nextSegmentToAppend;
    setSearchQuery(newQuery.trim()); 
    setCurrentAppendSegmentIndex(nextWordIndex + 1); 
    fetchData(newQuery.trim(), activeTab);

  }, [searchQuery, sentenceSegments, currentAppendSegmentIndex, fetchData, learningLanguage, segmentationMode, activeTab]);

  const captureAudioSequence = (): Promise<string | undefined> => {
    return new Promise(async (resolve) => {
        const audioEl = audioRef?.current;
        if (!audioEl || !contextLine.text || contextLine.start >= contextLine.end) {
            resolve(undefined);
            return;
        }

        const ua = navigator.userAgent;
        
        // Comprehensive detection for generic Android WebViews (including Via)
        // Standard Android WebView UAs usually contain 'Version/X.X' followed by 'Chrome/...'
        // Via browser UA: "Mozilla/5.0 ... Android ... Via" or standard WebView signature.
        const isGenericAndroidWebView = /Version\/\d+\.\d+/i.test(ua) && /Chrome\/\d+/i.test(ua) && /Android/i.test(ua);
        const isExplicitVia = /Via/i.test(ua);
        const isIOS = /iPad|iPhone|iPod|Macintosh/i.test(ua) && 'ontouchend' in document;

        // Kiwi Browser check (to EXCLUDE it from slicing logic)
        const isKiwi = /Kiwi/i.test(ua);

        // Logic:
        // 1. If it's Kiwi, use recording (captureStream), so isSlicingRequired = false.
        // 2. If it's iOS, Via, or a Generic Android WebView, force slicing.
        // 3. Otherwise (Standard Chrome/Firefox), use recording.
        const isSlicingRequired = (isIOS || isExplicitVia || isGenericAndroidWebView) && !isKiwi;

        if (isSlicingRequired && currentTrack?.file) {
            try {
                // Slicing: Directly cut audio from source file
                const clipBase64 = await extractAudioClip(currentTrack.file, contextLine.start, contextLine.end);
                resolve(clipBase64);
                return;
            } catch (err) {
                console.error("Local slice failed", err);
                // Fallthrough to try recording as last resort
            }
        }

        // Recording logic (Default or Fallback)
        try {
            audioChunksRef.current = [];
            audioEl.currentTime = contextLine.start;

            const stream = (audioEl as any).captureStream ? (audioEl as any).captureStream() : 
                           (audioEl as any).mozCaptureStream ? (audioEl as any).mozCaptureStream() : null;

            if (!stream) {
                console.warn("captureStream not supported");
                // Last ditch attempt at slicing if failed earlier or wasn't tried
                if (currentTrack?.file) {
                     const clipBase64 = await extractAudioClip(currentTrack.file, contextLine.start, contextLine.end);
                     resolve(clipBase64);
                     return;
                }
                resolve(undefined);
                return;
            }

            const audioTrack = stream.getAudioTracks()[0];
            if (!audioTrack) {
                resolve(undefined);
                return;
            }
            const mediaStream = new MediaStream([audioTrack]);

            let mimeType = 'audio/webm;codecs=opus';
            if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';
            
            const recorder = new MediaRecorder(mediaStream, { mimeType });
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            recorder.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: mimeType });
                const reader = new FileReader();
                reader.onloadend = () => {
                    resolve(reader.result as string);
                };
                reader.readAsDataURL(blob);
            };

            await audioEl.play();
            recorder.start(10); 

            const checkTime = () => {
                if (audioEl.currentTime >= contextLine.end) {
                    if (recorder.state !== 'inactive') recorder.stop();
                    audioEl.pause();
                    audioEl.removeEventListener('timeupdate', checkTime);
                }
            };
            audioEl.addEventListener('timeupdate', checkTime);

        } catch (err) {
            console.error("Recording failed", err);
            resolve(undefined);
        }
    });
  };

  const handleAddClick = async () => {
    if (isProcessing || isAddingToAnki) return;
    
    setIsProcessing(true); // Show loading state

    let finalDefinition = '';

    // Get definition from tabs
    if (activeTab === 'dictionary' && dictionaryContentRef.current) {
      finalDefinition = dictionaryContentRef.current.innerHTML;
    } else if (activeTab === 'userscript' && userscriptOutputRef.current) {
      finalDefinition = userscriptOutputRef.current.innerHTML;
    } else if (activeTab === 'web' && webCustomNotes) {
      finalDefinition = webCustomNotes;
    } else if (activeTab === 'dictionary' && data?.entries?.[0]?.senses?.[0]) {
      finalDefinition = data.entries[0].senses[0].definition;
    }

    try {
        let recordedAudio = undefined;
        // If audio field is configured, auto-record
        if (hasAudioField) {
            recordedAudio = await captureAudioSequence();
        }

        // Bold the search query in the sentence
        let sentenceWithHighlight = contextLine.text;
        if (searchQuery) {
            try {
                const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(${escapedQuery})`, 'gi');
                sentenceWithHighlight = sentenceWithHighlight.replace(regex, '<b>$1</b>');
            } catch (e) {
                console.warn("Regex highlighting failed", e);
            }
        }
        
        await onAddToAnki(finalDefinition || searchQuery, sentenceWithHighlight, recordedAudio);
    } catch (e) {
        console.error(e);
    } finally {
        setIsProcessing(false);
    }
  };

  const isSidebar = variant === 'sidebar';
  const webIframeSrc = useMemo(() => {
    const baseUrl = WEB_SEARCH_URLS[webSearchEngine];
    return `${baseUrl}${encodeURIComponent(searchQuery)}`;
  }, [searchQuery, webSearchEngine]);


  return (
    <>
      {isOpen && !isSidebar && <div className="fixed inset-0 bg-black/40 z-[90]" onClick={onClose} />}
      <div id="dictionary-panel" className={`${isSidebar ? 'fixed top-0 right-0 h-full w-full md:w-[450px] border-l' : 'fixed bottom-0 left-0 right-0 h-[80dvh] rounded-t-2xl border-t'} bg-slate-900 border-white/10 shadow-2xl z-[100] transition-transform duration-300 transform ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex flex-col h-full overflow-hidden">
          {/* Header with Search and Actions */}
          <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2 flex-1 mr-4">
              <input 
                type="text" 
                className="w-full bg-slate-800 border border-slate-700 rounded-lg py-1.5 px-3 text-white text-sm focus:border-indigo-500 outline-none"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <button onClick={handleSearch} className="p-2 text-slate-400 hover:text-white" title={t.search}><SearchIcon /></button>
              {sentenceSegments.length > 0 && (
                <button onClick={handleAppendSegment} className="p-2 text-slate-400 hover:text-white" title={t.appendSegment}><AppendIcon /></button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={handleAddClick} 
                disabled={isProcessing || isAddingToAnki} 
                className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-50 min-w-[40px] flex items-center justify-center" 
                title={t.addBookmark} 
              >
                {isProcessing || isAddingToAnki ? <LoaderIcon /> : <AnkiIcon />}
              </button>
              <button onClick={onClose} className="p-2 text-slate-400 hover:text-white" title={t.cancel}><XIcon /></button>
            </div>
          </div>

          {/* Sentence for segmentation and word click */}
          {sentenceSegments.length > 0 && (
            <div className="bg-slate-800/50 p-3 text-center border-b border-white/10 overflow-x-auto whitespace-nowrap text-sm text-slate-400 select-text no-scrollbar shrink-0">
              {sentenceSegments.map((seg, idx) => {
                const regex = new RegExp(`\\b${searchQuery.trim()}\\b`, 'i');
                const isHighlighted = isWord(seg) && searchQuery.trim() !== '' && regex.test(seg);

                return (
                  <span 
                    key={idx} 
                    onClick={() => handleSegmentClick(seg, idx)} 
                    className={`
                      inline-block cursor-pointer hover:text-indigo-400 hover:underline transition-colors
                      ${idx === initialSegmentIndex ? 'text-indigo-300 font-bold' : ''}
                      ${currentAppendSegmentIndex > idx ? 'text-indigo-400' : ''}
                      ${isWord(seg) ? '' : 'text-slate-500'}
                      ${isHighlighted ? 'font-bold text-white' : ''}
                    `}
                  >
                    {seg}
                  </span>
                );
              })}
            </div>
          )}

          {/* Tab Navigation */}
          <div className="flex justify-around border-b border-white/10 bg-slate-800/50 shrink-0">
            <button 
              onClick={() => { setActiveTab('dictionary'); fetchData(searchQuery, 'dictionary'); }} 
              className={`flex-1 py-3 text-sm font-bold transition-colors ${activeTab === 'dictionary' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {t.dictClassic}
            </button>
            <button 
              onClick={() => setActiveTab('web')} 
              className={`flex-1 py-3 text-sm font-bold transition-colors ${activeTab === 'web' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {t.dictWeb}
            </button>
            <button 
              onClick={() => { setActiveTab('userscript'); fetchData(searchQuery, 'userscript'); }}
              className={`flex-1 py-3 text-sm font-bold transition-colors ${activeTab === 'userscript' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {t.dictScript}
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-hidden relative flex flex-col"> 
            {activeTab === 'dictionary' && (
              <div className="flex-1 overflow-y-auto p-6 space-y-6 relative" ref={dictionaryContentRef}>
                {loading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 z-10 text-slate-500 gap-4">
                    <LoaderIcon /> 
                    <span>{t.dictQuerying}</span>
                  </div>
                )}
                {error ? (
                  <p className="text-slate-400 text-center py-10">{error}</p>
                ) : data?.entries?.map((entry, idx) => (
                  <div key={idx} className="bg-white/5 rounded-xl p-4 border border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-widest text-pink-400 bg-pink-400/10 px-2 py-0.5 rounded border border-pink-500/20">{entry.partOfSpeech}</span>
                      {entry.pronunciations?.[0]?.text && <span className="text-xs text-slate-400" style={{ fontFamily: '"Lucida Sans Unicode", "Arial Unicode MS", sans-serif' }}>/{entry.pronunciations[0].text}/</span>}
                    </div>
                    {entry.senses?.map((sense, sIdx) => (
                      <div key={sIdx} className="space-y-2">
                        <p className="text-slate-200 text-sm leading-relaxed">{sIdx + 1}. {sense.definition}</p>
                        {sense.examples?.map((ex, exIdx) => (
                          <p key={exIdx} className="text-xs text-slate-500 italic pl-4 border-l border-white/10">{ex}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'web' && (
              <div className="flex-1 flex flex-col relative overflow-hidden h-full">
                <iframe 
                  src={webIframeSrc} 
                  className="flex-1 w-full border-0 bg-slate-900" 
                  title={`${webSearchEngine} search for ${searchQuery}`}
                ></iframe>
                {/* Custom Notes only for Web tab */}
                <div className="border-t border-white/5 p-4 shrink-0 bg-slate-900 z-10">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">{t.webCustomNotes}</label>
                  <textarea 
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white text-sm outline-none focus:border-indigo-500"
                    placeholder={t.dictCustomPlaceholder}
                    value={webCustomNotes}
                    onChange={e => setWebCustomNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
            )}

            {activeTab === 'userscript' && (
              <div className="flex-1 overflow-y-auto relative">
                {loading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 z-10 text-slate-500 gap-4">
                    <LoaderIcon /> 
                    <span>{t.dictWaitingExternal}</span>
                  </div>
                )}
                <div ref={userscriptOutputRef} className="p-6 text-slate-300 custom-userscript-output" dangerouslySetInnerHTML={{ __html: userscriptHtmlContent || `<p class="text-slate-500 text-center py-10">${t.dictWaitingExternal}</p>` }}>
                </div>
              </div>
            )}
            
            {/* Removed the shared "Custom Definition" textarea that was here previously */}
          </div>
        </div>
      </div>
    </>
  );
};
