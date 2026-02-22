
import React, { useState, useEffect, useRef } from 'react';
import { Language, WebSearchEngine } from '../types';

interface TranslationPopupProps {
  position: { x: number; y: number };
  sentence: string;
  onClose: () => void;
  t: { [key: string]: string };
  initialEngine: WebSearchEngine;
  language: Language;
  onEngineChange: (engine: WebSearchEngine) => void;
  onAddAnki?: () => void;
}

const getTargetLangCode = (appLang: Language) => {
    if (appLang === 'zh' || appLang === 'zh-TW') return 'zh-Hans';
    return 'en';
};

const constructWebSearchUrl = (engine: WebSearchEngine, term: string, targetLang: string) => {
    const encodedTerm = encodeURIComponent(term);
    switch (engine) {
        case 'bing_trans': return `https://www.bing.com/translator/?text=${encodedTerm}&to=${targetLang}`;
        case 'baidu_trans': return `https://fanyi.baidu.com/#en/zh/${encodedTerm}`;
        case 'sogou_trans': return `https://fanyi.sogou.com/text?keyword=${encodedTerm}`;
        default: return `https://www.bing.com/translator/?text=${encodedTerm}&to=${targetLang}`;
    }
};

const translationEngines: WebSearchEngine[] = ['bing_trans', 'baidu_trans', 'sogou_trans'];

export const TranslationPopup: React.FC<TranslationPopupProps> = ({ 
    position, sentence, onClose, t, initialEngine, language, onEngineChange, onAddAnki
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [currentEngine, setCurrentEngine] = useState<WebSearchEngine>(translationEngines.includes(initialEngine) ? initialEngine : 'bing_trans');
  
  const targetLangCode = getTargetLangCode(language);
  const url = constructWebSearchUrl(currentEngine, sentence, targetLangCode);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleEngineChange = (engine: WebSearchEngine) => {
      setCurrentEngine(engine);
      onEngineChange(engine);
  };

  const style: React.CSSProperties = {
    position: 'fixed',
    left: '50%',
    transform: 'translateX(-50%)',
    top: `${Math.min(window.innerHeight - 310, position.y + 25)}px`,
    height: '300px',
    zIndex: 1000,
    width: 'calc(100vw - 20px)',
    maxWidth: '400px',
  };
  
  return (
    <div ref={ref} style={style} className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-gray-200 dark:border-slate-700 flex flex-col overflow-hidden animate-fade-in text-sm font-sans">
        <div className="p-2 border-b dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <i className="fa-solid fa-language text-indigo-500 ml-1"></i>
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{t.sentenceTranslation}</span>
                <select 
                    value={currentEngine}
                    onChange={(e) => handleEngineChange(e.target.value as WebSearchEngine)}
                    className="ml-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded text-[10px] p-1 outline-none text-slate-800 dark:text-white"
                >
                    <option value="bing_trans">Bing</option>
                    <option value="baidu_trans">Baidu</option>
                    <option value="sogou_trans">Sogou</option>
                </select>
            </div>
            <div className="flex items-center gap-2">
                {onAddAnki && (
                    <button onClick={onAddAnki} className="text-slate-400 hover:text-indigo-500 p-1" title={t.saveToAnki}>
                        <i className="fa-solid fa-plus-circle text-xs"></i>
                    </button>
                )}
                <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><i className="fa-solid fa-times text-xs"></i></button>
            </div>
        </div>
        
        <div className="flex-1 bg-gray-100 dark:bg-black">
            <iframe 
                src={url} 
                className="w-full h-full border-none bg-white" 
                title={t.sentenceTranslation}
                sandbox="allow-same-origin allow-scripts allow-forms"
            />
        </div>
    </div>
  );
};
