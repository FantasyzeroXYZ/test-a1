
import React, { useState, useEffect, useRef } from 'react';
import { Language, SubtitleMode, SceneKeybindings, GameType, LearningLanguage, AnkiSettings, SegmentationMode, PlaybackMode, WebSearchEngine, ReaderSettings, Theme, InputSource, YomitanModeType } from '../types';
import { getTranslation } from '../utils/i18n';
import * as AnkiService from '../services/ankiService';
import { clearAllDataFromDB, saveDictionaryBatch, LocalDictEntry, DictionaryMeta, saveDictionaryMeta, getDictionaries, deleteDictionary, updateDictionary } from '../utils/storage';
import { DEFAULT_KEY_BINDINGS } from '../constants';
import { downloadFile } from '../utils/parsers';
import { deinflector, parseTransforms } from '../utils/deinflector';
import { useGamepad } from '../hooks/useGamepad';

// Add declaration for external JSZip library
declare const JSZip: any;

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  learningLanguage: LearningLanguage;
  setLearningLanguage: (lang: LearningLanguage) => void;
  subtitleMode: SubtitleMode;
  setSubtitleMode: (mode: SubtitleMode) => void;
  subtitleFontSize: number;
  setSubtitleFontSize: (size: number) => void;
  ankiSettings: AnkiSettings;
  setAnkiSettings: (settings: AnkiSettings) => void;
  readerSettings: ReaderSettings;
  setReaderSettings: (settings: ReaderSettings) => void;
  segmentationMode: SegmentationMode;
  setSegmentationMode: (mode: SegmentationMode) => void;
  webSearchEngine: WebSearchEngine;
  setWebSearchEngine: (engine: WebSearchEngine) => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

type WebSearchCategory = 'search' | 'translate' | 'encyclopedia';
type DictImportType = 'definition' | 'tag';

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen, onClose, language, setLanguage, learningLanguage, setLearningLanguage, subtitleMode, setSubtitleMode, subtitleFontSize, setSubtitleFontSize, readerSettings, setReaderSettings, ankiSettings, setAnkiSettings, segmentationMode, setSegmentationMode, webSearchEngine, setWebSearchEngine, showToast
}) => {
  const t = getTranslation(language);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set()); 
  const [shortcutScene, setShortcutScene] = useState<keyof SceneKeybindings>('player');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsTestText, setTTSTestText] = useState('');
  const [isImportingDict, setIsImportingDict] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [dictionaries, setDictionaries] = useState<DictionaryMeta[]>([]);
  const [importAbortController, setImportAbortController] = useState<AbortController | null>(null);
  
  const [ankiDecks, setAnkiDecks] = useState<string[]>([]);
  const [ankiModels, setAnkiModels] = useState<string[]>([]);
  const [ankiFields, setAnkiFields] = useState<string[]>([]);
  const [ankiConnected, setAnkiConnected] = useState(false);
  const [ankiConfigMode, setAnkiConfigMode] = useState<'word' | 'sentence'>('word');

  const [viewDictType, setViewDictType] = useState<DictImportType>('definition');
  const [viewDictLang, setViewDictLang] = useState<string>('all'); 

  const [isKeyBindingActive, setIsKeyBindingActive] = useState(false);
  const [tempKeybindings, setTempKeybindings] = useState<SceneKeybindings>(readerSettings.keybindings);
  const [bindingKeyTarget, setBindingKeyTarget] = useState<string | null>(null);

  const [dictImportScope, setDictImportScope] = useState<LearningLanguage | 'universal'>('universal');
  const [dictImportType, setDictImportType] = useState<DictImportType>('definition');
  
  const [searchCategory, setSearchCategory] = useState<WebSearchCategory>('translate');

  useGamepad((buttonIndex: number) => {
      if (!isKeyBindingActive || !bindingKeyTarget) return;
      const code = `Button${buttonIndex}`;
      updateTempBinding(bindingKeyTarget, code);
      setBindingKeyTarget(null);
  });

  useEffect(() => {
    if (['google', 'baidu', 'bing'].includes(webSearchEngine)) setSearchCategory('search');
    else if (['wikipedia', 'baidu_baike', 'moegirl'].includes(webSearchEngine)) setSearchCategory('encyclopedia');
    else setSearchCategory('translate');
  }, [webSearchEngine]);

  useEffect(() => {
    const loadVoices = () => {
        const vs = window.speechSynthesis.getVoices();
        setVoices(vs);
    };
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
        refreshDictionaries();
        setTempKeybindings(readerSettings.keybindings);
        setIsKeyBindingActive(false);
        setBindingKeyTarget(null);
    }
  }, [isOpen, readerSettings.keybindings]);

  useEffect(() => {
      const targetModel = ankiConfigMode === 'word' ? ankiSettings.modelName : ankiSettings.sentenceModelName;
      if (ankiConnected && targetModel) {
          AnkiService.getModelFieldNames(ankiSettings, targetModel)
            .then(fields => setAnkiFields(fields))
            .catch(() => setAnkiFields([]));
      }
  }, [ankiSettings.modelName, ankiSettings.sentenceModelName, ankiConfigMode, ankiConnected]);

  const refreshDictionaries = async () => {
      const dicts = await getDictionaries();
      setDictionaries(dicts);
  };

  const checkAnkiConnection = async () => {
      try {
          const connected = await AnkiService.testConnection(ankiSettings);
          setAnkiConnected(connected);
          if (connected) {
              const decks = await AnkiService.getDeckNames(ankiSettings);
              const models = await AnkiService.getModelNames(ankiSettings);
              setAnkiDecks(decks);
              setAnkiModels(models);
          } else {
              alert(t.ankiNotConnected);
          }
      } catch (e) {
          alert(t.ankiNotConnected);
          setAnkiConnected(false);
      }
  };

  const toggleSection = (section: string) => {
    const newSections = new Set(openSections);
    if (newSections.has(section)) newSections.delete(section);
    else newSections.add(section);
    setOpenSections(newSections);
  };

  const updateTempBinding = (target: string, code: string) => {
      const [scene, action] = target.split('-');
      setTempKeybindings(prev => ({
          ...prev,
          [scene]: {
              ...prev[scene as keyof SceneKeybindings],
              [action]: code
          }
      }));
  };

  const handleKeybindKeyDown = (e: KeyboardEvent) => {
      if (!isKeyBindingActive || !bindingKeyTarget) return;
      if (e.code === 'Escape') {
          e.preventDefault();
          setBindingKeyTarget(null);
          return;
      }
      e.preventDefault();
      e.stopPropagation();

      const code = e.code;
      updateTempBinding(bindingKeyTarget, code);
      setBindingKeyTarget(null);
  };

  useEffect(() => {
      if (isKeyBindingActive) {
          window.addEventListener('keydown', handleKeybindKeyDown, { capture: true });
          return () => window.removeEventListener('keydown', handleKeybindKeyDown, { capture: true });
      }
  }, [isKeyBindingActive, bindingKeyTarget]);

  const startBindingAction = (scene: string, action: string) => {
      setBindingKeyTarget(`${scene}-${action}`);
  };

  const clearBinding = (scene: string, action: string) => {
      updateTempBinding(`${scene}-${action}`, '');
  };

  const cancelBinding = () => {
      setBindingKeyTarget(null);
  };

  const applyKeybindings = () => {
      setReaderSettings({ ...readerSettings, keybindings: tempKeybindings });
      setIsKeyBindingActive(false);
  };

  const cancelAllKeybindingChanges = () => {
      setTempKeybindings(readerSettings.keybindings);
      setIsKeyBindingActive(false);
      setBindingKeyTarget(null);
  };

  const restoreDefaultKeybindings = () => {
      if (confirm(t.resetShortcutsConfirm)) {
           const defaults: SceneKeybindings = {
             library: { import: 'KeyI', settings: 'KeyS' },
             player: { playPause: 'Space', rewind: 'ArrowLeft', forward: 'ArrowRight', sidebar: 'KeyL', dict: 'KeyD' },
             dictionary: { close: 'Escape', addAnki: 'KeyA', replay: 'KeyR' }
           };
           setTempKeybindings(defaults);
      }
  };

  const cancelImport = () => {
      if (importAbortController) {
          importAbortController.abort();
      }
  };

  const handleYomitanImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (typeof JSZip === 'undefined') {
        alert(t.jszipError);
        return;
    }

    const controller = new AbortController();
    setImportAbortController(controller);
    setIsImportingDict(true);
    setImportProgress("Reading file...");

    try {
        const zip = await JSZip.loadAsync(file);
        let dictTitle = file.name;
        if (zip.file('index.json')) {
            const indexText = await zip.file('index.json').async('string');
            try { const indexData = JSON.parse(indexText); if (indexData.title) dictTitle = indexData.title; } catch (e) {}
        }
        const dictionaryId = crypto.randomUUID();
        const entries: LocalDictEntry[] = [];
        const batchSize = 2000;
        let totalCount = 0;
        const filePattern = dictImportType === 'definition' ? 'term_bank' : 'term_meta_bank';
        const files = Object.keys(zip.files).filter(f => f.includes(filePattern) && f.endsWith('.json'));
        
        if (files.length === 0) {
            alert(t.dictFileNotFound.replace('{filePattern}', filePattern));
            setIsImportingDict(false);
            setImportProgress('');
            setImportAbortController(null);
            return;
        }

        for (let i = 0; i < files.length; i++) {
            if (controller.signal.aborted) throw new Error("Import Aborted");
            setImportProgress(`Parsing bank ${i + 1}/${files.length}...`);
            const fileName = files[i];
            const content = await zip.file(fileName).async('string');
            const data = JSON.parse(content);
            for (const item of data) {
                if (controller.signal.aborted) throw new Error("Import Aborted");
                if (!Array.isArray(item)) continue;
                if (dictImportType === 'definition') {
                    const term = item[0];
                    const reading = item[1];
                    const glossary = item[5]; 
                    const tagsData = item[7] || ''; 
                    const tags = typeof tagsData === 'string' && tagsData ? tagsData.split(' ') : [];
                    let definitions: string[] = [];
                    if (Array.isArray(glossary)) {
                        definitions = glossary.map((g: any) => {
                            if (typeof g === 'string') return g;
                            return JSON.stringify(g);
                        });
                    }
                    entries.push({ term, reading, definitions, tags, dictionaryId: dictionaryId });
                } else {
                    const term = item[0];
                    const mode = item[1];
                    const metaData = item[2];
                    let tagValue = '';
                    if (mode === 'freq' && metaData && metaData.frequency) { 
                        tagValue = metaData.frequency.displayValue || metaData.frequency.value; 
                    } else if (typeof metaData === 'string') { 
                        tagValue = metaData; 
                    } else if (typeof metaData === 'number') { 
                        tagValue = String(metaData); 
                    } else if (metaData && typeof metaData === 'object') {
                        // Fallback for other metadata types
                        if (metaData.value) tagValue = String(metaData.value);
                        else if (metaData.displayValue) tagValue = String(metaData.displayValue);
                        else if (metaData.reading) tagValue = String(metaData.reading); // Pitch accent?
                    }
                    
                    if (tagValue) { entries.push({ term, definitions: [String(tagValue)], dictionaryId: dictionaryId }); }
                }
                totalCount++;
                if (entries.length >= batchSize) { await saveDictionaryBatch(entries); entries.length = 0; }
            }
        }
        if (entries.length > 0) { await saveDictionaryBatch(entries); }
        await saveDictionaryMeta({ id: dictionaryId, name: dictTitle, type: dictImportType, scope: dictImportScope, count: totalCount, priority: Date.now(), importedAt: Date.now() });
        const typeStr = dictImportType === 'definition' ? t.dictTypeDefinition : t.dictTypeTag;
        alert(t.dictImportSuccess.replace('{title}', dictTitle).replace('{type}', typeStr).replace('{count}', String(totalCount)));
        await refreshDictionaries();
    } catch (err: any) {
        if (err.message === "Import Aborted") { alert("Import cancelled by user."); } 
        else { console.error(err); alert(t.dictImportFailed.replace('{error}', String(err))); }
    } finally {
        setIsImportingDict(false);
        setImportProgress('');
        setImportAbortController(null);
        e.target.value = '';
    }
  };

  const handleTransformImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
          try {
              const content = ev.target?.result as string;
              const parsed = parseTransforms(content);
              if (parsed) { localStorage.setItem('lf_transforms', content); deinflector.load(parsed.language, parsed); alert(t.transformLoadSuccess); } 
              else { alert(t.transformParseError); }
          } catch (err) { alert(t.transformReadError); }
      };
      reader.readAsText(file);
      e.target.value = "";
  };

  const handleDeleteDictionary = async (id: string, name: string) => {
      if (confirm(t.confirmDeleteDict.replace('{name}', name))) { await deleteDictionary(id); await refreshDictionaries(); }
  };

  const handleMoveDictionary = async (index: number, direction: 'up' | 'down') => {
      const filtered = dictionaries.filter(d => d.type === viewDictType && (viewDictLang === 'all' || d.scope === viewDictLang));
      if (index < 0 || index >= filtered.length) return;
      const currentItem = filtered[index];
      let swapItem: DictionaryMeta | null = null;
      if (direction === 'up' && index > 0) swapItem = filtered[index - 1];
      if (direction === 'down' && index < filtered.length - 1) swapItem = filtered[index + 1];
      if (!swapItem) return;
      const tempP = currentItem.priority;
      currentItem.priority = swapItem.priority;
      swapItem.priority = tempP;
      await updateDictionary(currentItem.id, { priority: currentItem.priority });
      await updateDictionary(swapItem.id, { priority: swapItem.priority });
      await refreshDictionaries();
  };

  const handleScopeChange = async (id: string, newScope: string) => {
      await updateDictionary(id, { scope: newScope });
      await refreshDictionaries();
  };

  const handleTTSTest = () => {
    if (!ttsTestText) return;
    const utterance = new SpeechSynthesisUtterance(ttsTestText);
    if (readerSettings.ttsVoice) {
      const voice = voices.find(v => v.name === readerSettings.ttsVoice);
      if (voice) utterance.voice = voice;
    }
    utterance.rate = readerSettings.ttsRate;
    utterance.pitch = readerSettings.ttsPitch;
    utterance.volume = readerSettings.ttsVolume;
    window.speechSynthesis.speak(utterance);
  };

  const renderSearchOptions = () => {
      switch(searchCategory) {
          case 'search': return <><option value="google">Google</option><option value="baidu">Baidu</option><option value="bing">Bing</option></>;
          case 'encyclopedia': return <><option value="wikipedia">Wikipedia</option><option value="baidu_baike">Baidu Baike</option><option value="moegirl">Moegirl</option></>;
          case 'translate': default: return <><option value="bing_trans">Bing Translator</option><option value="baidu_trans">Baidu</option><option value="sogou_trans">Sogou</option></>;
      }
  };

  const toggleTheme = (theme: Theme) => { setReaderSettings({...readerSettings, theme}); };

  const handleExportSettings = () => {
      const data = { settings: readerSettings, ankiSettings: ankiSettings, };
      const json = JSON.stringify(data, null, 2);
      downloadFile(json, 'linguaflow_settings.json', 'application/json');
  };

  const handleImportSettings = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
          try {
              const data = JSON.parse(ev.target?.result as string);
              if (data.settings) setReaderSettings(data.settings);
              if (data.ankiSettings) setAnkiSettings(data.ankiSettings);
              alert(t.importSuccess);
          } catch (err) { alert(t.importError); }
      };
      reader.readAsText(file);
      e.target.value = ""; 
  };

  const getSceneLabel = (scene: string) => {
     switch(scene) { case 'library': return t.scLibrary; case 'player': return t.scPlayer; case 'dictionary': return t.scDictionary; default: return scene.toUpperCase(); }
  };

  const getActionLabel = (key: string) => {
      const map: Record<string, string> = { 'playPause': t.keyPlayPause, 'rewind': t.keyRewind, 'forward': t.keyForward, 'sidebar': t.keySidebar, 'dict': t.keyDict, 'close': t.keyClose, 'addAnki': t.keyAddAnki, 'replay': t.keyReplay, 'import': t.keyImport, 'settings': t.keySettings };
      return map[key] || key;
  };

  const learningLanguages: LearningLanguage[] = ['en', 'zh', 'ja', 'es', 'ru', 'fr'];
  const getLangName = (code: LearningLanguage) => {
      switch(code) { case 'en': return t.langEn; case 'zh': return t.langZh; case 'ja': return t.langJa; case 'es': return t.langEs; case 'ru': return t.langRu; case 'fr': return t.langFr; default: return code; }
  };

  const currentAnkiFieldMap = ankiConfigMode === 'word' ? ankiSettings.fieldMap : (ankiSettings.sentenceFieldMap as any || {});
  const availableFields = ankiConfigMode === 'word' ? ['word', 'reading', 'definition', 'sentence', 'translation', 'audio', 'examVocab'] : ['sentence', 'translation', 'audio', 'definition', 'notes', 'source']; 
  const updateAnkiField = (fieldType: string, value: string) => {
      if (ankiConfigMode === 'word') { setAnkiSettings({ ...ankiSettings, fieldMap: { ...ankiSettings.fieldMap, [fieldType]: value } }); } 
      else { setAnkiSettings({ ...ankiSettings, sentenceFieldMap: { ...ankiSettings.sentenceFieldMap, [fieldType]: value } }); }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[65]" onClick={onClose} />
      <div className="absolute top-0 right-0 bottom-0 w-96 bg-white dark:bg-slate-900 shadow-2xl border-l border-gray-200 dark:border-slate-700 z-[70] flex flex-col animate-slide-in transition-colors duration-300">
        <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex justify-between items-center bg-gray-50 dark:bg-slate-800 transition-colors">
          <h2 className="text-base font-bold text-slate-800 dark:text-white flex items-center gap-2"><i className="fa-solid fa-sliders text-indigo-500 dark:text-indigo-400"></i> {t.settings}</h2>
          <button onClick={onClose} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white p-2">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar pb-20">
          
          <button onClick={() => toggleSection('general')} className="w-full flex items-center justify-between p-4 bg-gray-50/50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-700/50 border-b border-gray-200 dark:border-slate-700/50 text-left transition-colors">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">{t.general}</span>
          </button>
          {openSections.has('general') && (
            <div className="p-4 space-y-4 bg-white dark:bg-slate-800/30 transition-colors">
               <div className="grid grid-cols-2 gap-4">
                   <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{t.theme}</label>
                      <div className="flex bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded p-1 transition-colors">
                          <button onClick={() => toggleTheme('light')} className={`flex-1 py-1.5 text-xs rounded transition-all ${readerSettings.theme === 'light' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>{t.themeLight}</button>
                          <button onClick={() => toggleTheme('dark')} className={`flex-1 py-1.5 text-xs rounded transition-all ${readerSettings.theme === 'dark' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>{t.themeDark}</button>
                      </div>
                   </div>
                   <div className="flex flex-col justify-end">
                        <div className="flex items-center justify-between bg-gray-50 dark:bg-slate-800/50 p-2 rounded border border-gray-200 dark:border-slate-700">
                            <span className="text-xs text-slate-700 dark:text-slate-300">{t.clipboardMode}</span>
                            <input type="checkbox" checked={readerSettings.copyToClipboard} onChange={e => setReaderSettings({...readerSettings, copyToClipboard: e.target.checked})} className="accent-indigo-600" />
                        </div>
                   </div>
               </div>

               <div className="grid grid-cols-2 gap-4">
                   <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{t.language}</label>
                      <select value={language} onChange={(e) => setLanguage(e.target.value as Language)} className="w-full bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-white p-2 rounded border border-gray-300 dark:border-slate-700 outline-none transition-colors"><option value="zh">{t.langZh}</option><option value="zh-TW">繁体中文</option><option value="en">{t.langEn}</option></select>
                   </div>
                   <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{t.learningLanguage}</label>
                      <select value={learningLanguage} onChange={(e) => setLearningLanguage(e.target.value as LearningLanguage)} className="w-full bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-white p-2 rounded border border-gray-300 dark:border-slate-700 outline-none transition-colors"><option value="en">{t.langEn}</option><option value="zh">{t.langZh}</option><option value="ja">{t.langJa}</option><option value="es">{t.langEs}</option><option value="ru">{t.langRu}</option><option value="fr">{t.langFr}</option></select>
                   </div>
               </div>
               
               <div className="grid grid-cols-2 gap-4">
                   <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{t.searchCategory}</label>
                      <select value={searchCategory} onChange={(e) => setSearchCategory(e.target.value as WebSearchCategory)} className="w-full bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-white p-2 rounded border border-gray-300 dark:border-slate-700 outline-none transition-colors">
                          <option value="search">{t.catSearch}</option>
                          <option value="translate">{t.catTranslate}</option>
                          <option value="encyclopedia">{t.catEncyclopedia}</option>
                      </select>
                   </div>
                   <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{t.searchProvider}</label>
                      <select value={webSearchEngine} onChange={(e) => setWebSearchEngine(e.target.value as WebSearchEngine)} className="w-full bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-white p-2 rounded border border-gray-300 dark:border-slate-700 outline-none transition-colors">
                          {renderSearchOptions()}
                      </select>
                   </div>
               </div>

               <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{t.segMode}</label>
                  <select value={segmentationMode} onChange={(e) => setSegmentationMode(e.target.value as SegmentationMode)} className="w-full bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-white p-2 rounded border border-gray-300 dark:border-slate-700 outline-none transition-colors"><option value="browser">{t.segBrowser}</option><option value="mecab">{t.segMecab}</option><option value="none">{t.segNone}</option></select>
               </div>
            </div>
          )}
          
          <button onClick={() => toggleSection('dictionaries')} className="w-full flex items-center justify-between p-4 bg-gray-50/50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-700/50 border-b border-gray-200 dark:border-slate-700/50 text-left transition-colors">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">{t.dictClassic}</span>
          </button>
          {openSections.has('dictionaries') && (
            <div className="p-4 bg-white dark:bg-slate-800/30 transition-colors space-y-4">
               {/* Export Mode Toggle */}
               <div className="border-b border-gray-200 dark:border-slate-700 pb-4">
                   <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">Card Export Mode</label>
                   <div className="flex bg-gray-100 dark:bg-slate-900 rounded p-1 border border-gray-200 dark:border-slate-700">
                       <button 
                           onClick={() => setReaderSettings({...readerSettings, dictExportMode: 'anki'})} 
                           className={`flex-1 py-1.5 text-xs rounded transition-all ${readerSettings.dictExportMode === 'anki' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500'}`}
                       >
                           Anki
                       </button>
                       <button 
                           onClick={() => setReaderSettings({...readerSettings, dictExportMode: 'table'})} 
                           className={`flex-1 py-1.5 text-xs rounded transition-all ${readerSettings.dictExportMode === 'table' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500'}`}
                       >
                           Table
                       </button>
                   </div>
               </div>

               {/* Import Section */}
               <div className="border-b border-gray-200 dark:border-slate-700 pb-4">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{t.importYomitan}</label>
                  <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <select 
                           value={dictImportType} 
                           onChange={(e) => setDictImportType(e.target.value as DictImportType)}
                           className="flex-1 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-white p-1.5 rounded border border-gray-300 dark:border-slate-700 outline-none"
                        >
                            <option value="definition">{t.dictTypeDefinition}</option>
                            <option value="tag">{t.dictTypeTag}</option>
                        </select>
                        <select 
                           value={dictImportScope} 
                           onChange={(e) => setDictImportScope(e.target.value as any)}
                           className="flex-1 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-white p-1.5 rounded border border-gray-300 dark:border-slate-700 outline-none"
                        >
                            <option value="universal">{t.dictLangUniversal}</option>
                            {learningLanguages.map(l => (
                                <option key={l} value={l}>{getLangName(l)} ({l.toUpperCase()})</option>
                            ))}
                        </select>
                      </div>
                      <input type="file" accept=".zip" onChange={handleYomitanImport} disabled={isImportingDict} className="text-xs text-slate-500 dark:text-slate-400" />
                      {isImportingDict && (
                          <div className="flex items-center gap-2">
                              <p className="text-xs text-indigo-500 animate-pulse flex-1">{importProgress}</p>
                              <button onClick={cancelImport} className="px-2 py-0.5 bg-red-100 text-red-600 text-[10px] rounded hover:bg-red-200 font-bold">Stop</button>
                          </div>
                      )}
                  </div>
               </div>
               
               <div className="flex flex-col gap-2 pb-2 border-b border-gray-200 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                            <span className="text-sm text-slate-700 dark:text-slate-300 font-bold">{t.instantLookup}</span>
                            <span className="text-[10px] text-slate-500">{t.instantLookupDesc}</span>
                        </div>
                        <input type="checkbox" checked={readerSettings.yomitanMode} onChange={e => setReaderSettings({...readerSettings, yomitanMode: e.target.checked})} className="accent-indigo-600" />
                    </div>
                    {readerSettings.yomitanMode && (
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{t.lookupMode}</label>
                            <select 
                                value={readerSettings.yomitanModeType} 
                                onChange={e => setReaderSettings({...readerSettings, yomitanModeType: e.target.value as YomitanModeType})}
                                className="w-full bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-white p-2 rounded border border-gray-300 dark:border-slate-700 outline-none"
                            >
                                <option value="fast">{t.lookupFast}</option>
                                <option value="comprehensive">{t.lookupComprehensive}</option>
                            </select>
                        </div>
                    )}
               </div>

               <div className="flex flex-col gap-2 pb-2 border-b border-gray-200 dark:border-slate-700">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">{t.textAnalysis}</label>
                  <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-700 dark:text-slate-300">{t.enablePreprocessing}</span>
                      <input type="checkbox" checked={readerSettings.enablePreprocessing} onChange={e => setReaderSettings({...readerSettings, enablePreprocessing: e.target.checked})} className="accent-indigo-600" />
                  </div>
                  <div className="flex flex-col gap-1 mt-1">
                      <span className="text-xs text-slate-500 dark:text-slate-400">{t.importGrammar}</span>
                      <input type="file" accept=".js" onChange={handleTransformImport} className="text-xs text-slate-500 dark:text-slate-400" />
                  </div>
               </div>

               {/* Management Section */}
               <div>
                   <div className="flex justify-between items-center mb-2 gap-2">
                       <label className="text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">{t.manageDicts}</label>
                       <div className="flex gap-1 flex-1 justify-end">
                           <select 
                               value={viewDictLang}
                               onChange={(e) => setViewDictLang(e.target.value)}
                               className="bg-transparent text-[10px] text-slate-500 font-bold border-none outline-none cursor-pointer max-w-[80px]"
                           >
                               <option value="all">{t.allLangs}</option>
                               <option value="universal">{t.dictLangUniversal}</option>
                               {learningLanguages.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
                           </select>
                           <select 
                               value={viewDictType}
                               onChange={(e) => setViewDictType(e.target.value as DictImportType)}
                               className="bg-transparent text-[10px] text-indigo-500 font-bold border-none outline-none cursor-pointer"
                           >
                               <option value="definition">{t.dictTypeDefinition}</option>
                               <option value="tag">{t.dictTypeTag}</option>
                           </select>
                       </div>
                   </div>
                   
                   {dictionaries.filter(d => d.type === viewDictType && (viewDictLang === 'all' || d.scope === viewDictLang)).length === 0 ? (
                       <p className="text-xs text-slate-400 italic">{t.noDictsFound.replace('{type}', viewDictType === 'definition' ? t.dictTypeDefinition : t.dictTypeTag)}</p>
                   ) : (
                       <div className="space-y-2">
                           {dictionaries.filter(d => d.type === viewDictType && (viewDictLang === 'all' || d.scope === viewDictLang)).map((dict, idx) => (
                               <div key={dict.id} className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded p-2 flex flex-col gap-2">
                                   <div className="flex justify-between items-start">
                                       <div className="flex flex-col overflow-hidden pr-2">
                                          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate" title={dict.name}>{dict.name}</span>
                                          <span className={`text-[9px] uppercase tracking-wider font-bold inline-block px-1 rounded w-fit mt-1 ${dict.type === 'tag' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300' : 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-300'}`}>
                                              {dict.type === 'tag' ? 'TAG BANK' : 'DEFINITION'}
                                          </span>
                                       </div>
                                       <div className="flex items-center gap-1 shrink-0">
                                            <button onClick={() => handleMoveDictionary(idx, 'up')} disabled={idx === 0} className="w-5 h-5 flex items-center justify-center rounded bg-gray-200 dark:bg-slate-800 text-slate-500 hover:bg-indigo-100 hover:text-indigo-600 disabled:opacity-30">
                                                <i className="fa-solid fa-arrow-up text-[10px]"></i>
                                            </button>
                                            <button onClick={() => handleMoveDictionary(idx, 'down')} disabled={idx === dictionaries.filter(d => d.type === viewDictType).length - 1} className="w-5 h-5 flex items-center justify-center rounded bg-gray-200 dark:bg-slate-800 text-slate-500 hover:bg-indigo-100 hover:text-indigo-600 disabled:opacity-30">
                                                <i className="fa-solid fa-arrow-down text-[10px]"></i>
                                            </button>
                                            <button onClick={() => handleDeleteDictionary(dict.id, dict.name)} className="w-5 h-5 flex items-center justify-center rounded bg-gray-200 dark:bg-slate-800 text-slate-500 hover:bg-red-100 hover:text-red-600">
                                                <i className="fa-solid fa-trash text-[10px]"></i>
                                            </button>
                                       </div>
                                   </div>
                                   <div className="flex items-center gap-2">
                                       <span className="text-[10px] text-slate-400">{t.nItems.replace('{count}', String(dict.count))}</span>
                                       <select 
                                           value={dict.scope} 
                                           onChange={(e) => handleScopeChange(dict.id, e.target.value)}
                                           className="flex-1 bg-white dark:bg-slate-800 text-[10px] border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 outline-none"
                                       >
                                          <option value="universal">Universal</option>
                                          {learningLanguages.map(l => (
                                              <option key={l} value={l}>{l.toUpperCase()}</option>
                                          ))}
                                       </select>
                                   </div>
                               </div>
                           ))}
                       </div>
                   )}
               </div>
            </div>
          )}

          <button onClick={() => toggleSection('interface')} className="w-full flex items-center justify-between p-4 bg-gray-50/50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-700/50 border-b border-gray-200 dark:border-slate-700/50 text-left transition-colors">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">{t.interface}</span>
          </button>
          {openSections.has('interface') && (
            <div className="p-4 space-y-4 bg-white dark:bg-slate-800/30 transition-colors">
               <div className="grid grid-cols-2 gap-4">
                   <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{t.subtitleMode}</label>
                      <select value={subtitleMode} onChange={(e) => setSubtitleMode(e.target.value as SubtitleMode)} className="w-full bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-white p-2 rounded border border-gray-300 dark:border-slate-700 outline-none transition-colors"><option value="scroll">{t.modeScroll}</option><option value="single">{t.modeSingle}</option></select>
                   </div>
                   <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{t.fontSize}</label>
                      <input type="range" min="12" max="48" value={subtitleFontSize} onChange={(e) => setSubtitleFontSize(parseInt(e.target.value))} className="w-full accent-indigo-600" />
                   </div>
               </div>
            </div>
          )}

          {/* TTS Settings */}
          <button onClick={() => toggleSection('tts')} className="w-full flex items-center justify-between p-4 bg-gray-50/50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-700/50 border-b border-gray-200 dark:border-slate-700/50 text-left transition-colors">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">{t.ttsSettings}</span>
          </button>
          {openSections.has('tts') && (
            <div className="p-4 space-y-4 bg-white dark:bg-slate-800/30 transition-colors">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-700 dark:text-slate-300">{t.ttsToggle}</span>
                    <input type="checkbox" checked={readerSettings.ttsEnabled} onChange={e => setReaderSettings({...readerSettings, ttsEnabled: e.target.checked})} className="accent-indigo-600" />
                </div>
                {readerSettings.ttsEnabled && (
                    <>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{t.ttsVoice}</label>
                            <select value={readerSettings.ttsVoice} onChange={(e) => setReaderSettings({...readerSettings, ttsVoice: e.target.value})} className="w-full bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-white p-2 rounded border border-gray-300 dark:border-slate-700 outline-none transition-colors">
                                <option value="">{t.ttsDefault}</option>
                                {voices.map(v => (
                                    <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                                ))}
                            </select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t.ttsRate}: {readerSettings.ttsRate}x</label>
                                <input type="range" min="0.5" max="2" step="0.1" value={readerSettings.ttsRate} onChange={(e) => setReaderSettings({...readerSettings, ttsRate: parseFloat(e.target.value)})} className="w-full accent-indigo-600" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t.ttsPitch}: {readerSettings.ttsPitch}</label>
                                <input type="range" min="0" max="2" step="0.1" value={readerSettings.ttsPitch} onChange={(e) => setReaderSettings({...readerSettings, ttsPitch: parseFloat(e.target.value)})} className="w-full accent-indigo-600" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t.ttsVolume}: {readerSettings.ttsVolume}</label>
                            <input type="range" min="0" max="1" step="0.1" value={readerSettings.ttsVolume} onChange={(e) => setReaderSettings({...readerSettings, ttsVolume: parseFloat(e.target.value)})} className="w-full accent-indigo-600" />
                        </div>
                        <div className="pt-2 border-t border-gray-200 dark:border-slate-700">
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{t.ttsTest}</label>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    value={ttsTestText}
                                    onChange={(e) => setTTSTestText(e.target.value)}
                                    placeholder={t.ttsPlaceholder}
                                    className="flex-1 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-white p-2 rounded border border-gray-300 dark:border-slate-700 outline-none"
                                />
                                <button onClick={handleTTSTest} className="px-3 py-1 bg-indigo-600 text-white rounded text-xs font-bold hover:bg-indigo-500"><i className="fa-solid fa-play"></i></button>
                            </div>
                        </div>
                    </>
                )}
            </div>
          )}
          
          {/* Shortcuts and Anki sections remain structurally similar but ensure compact spacing if applicable */}
          <button onClick={() => toggleSection('shortcuts')} className="w-full flex items-center justify-between p-4 bg-gray-50/50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-700/50 border-b border-gray-200 dark:border-slate-700/50 text-left transition-colors">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">{t.shortcuts}</span>
          </button>
          {openSections.has('shortcuts') && (
            <div className="p-4 bg-white dark:bg-slate-800/30 space-y-4 transition-colors">
              <div className="flex justify-between items-center mb-4">
                  <div className="flex bg-gray-100 dark:bg-slate-900 rounded p-1 border border-gray-200 dark:border-slate-700">
                      <button 
                        onClick={() => !isKeyBindingActive && setReaderSettings({...readerSettings, inputSource: 'keyboard'})} 
                        disabled={isKeyBindingActive}
                        className={`px-3 py-1 text-[10px] rounded transition-all ${readerSettings.inputSource === 'keyboard' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500'} disabled:opacity-50`}
                      >
                          <i className="fa-solid fa-keyboard mr-1"></i>
                          {t.keyboard}
                      </button>
                      <button 
                        onClick={() => !isKeyBindingActive && setReaderSettings({...readerSettings, inputSource: 'gamepad'})}
                        disabled={isKeyBindingActive}
                        className={`px-3 py-1 text-[10px] rounded transition-all ${readerSettings.inputSource === 'gamepad' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500'} disabled:opacity-50`}
                      >
                          <i className="fa-solid fa-gamepad mr-1"></i>
                          {t.gamepad}
                      </button>
                  </div>
                  
                  <div className="flex gap-2">
                       {!isKeyBindingActive ? (
                           <>
                             <button onClick={restoreDefaultKeybindings} className="px-3 py-1 bg-gray-200 dark:bg-slate-700 text-[10px] rounded text-slate-600 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-600">{t.restoreDefaults}</button>
                             <button onClick={() => setIsKeyBindingActive(true)} className="px-3 py-1 bg-indigo-600 text-[10px] rounded text-white font-bold hover:bg-indigo-500 shadow">{t.startConfig}</button>
                           </>
                       ) : (
                           <>
                             <button onClick={cancelAllKeybindingChanges} className="px-3 py-1 bg-gray-200 dark:bg-slate-700 text-[10px] rounded text-slate-600 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-600">{t.cancel}</button>
                             <button onClick={applyKeybindings} className="px-3 py-1 bg-green-600 text-[10px] rounded text-white font-bold hover:bg-green-500 shadow">{t.confirm}</button>
                           </>
                       )}
                  </div>
              </div>
              <div className="flex bg-gray-100 dark:bg-slate-900 rounded p-1 border border-gray-200 dark:border-slate-700 transition-colors">
                {(['library', 'player', 'dictionary'] as const).map(scene => (
                  <button key={scene} onClick={() => setShortcutScene(scene)} className={`flex-1 py-1 text-[10px] rounded transition-all ${shortcutScene === scene ? 'bg-indigo-600 text-white' : 'text-slate-500 dark:text-slate-400'}`}>{getSceneLabel(scene)}</button>
                ))}
              </div>
              <div className="space-y-3">
                {Object.keys(readerSettings.keybindings[shortcutScene]).map(key => {
                  const isMappingThis = bindingKeyTarget === `${shortcutScene}-${key}`;
                  const currentBind = isKeyBindingActive ? tempKeybindings[shortcutScene][key] : readerSettings.keybindings[shortcutScene][key];
                  
                  return (
                    <div key={key} className="flex items-center justify-between gap-2 p-2 rounded hover:bg-gray-50 dark:hover:bg-slate-800/50">
                      <span className="text-xs text-slate-600 dark:text-slate-400 capitalize flex-1">{getActionLabel(key)}</span>
                      
                      {isKeyBindingActive ? (
                          <div className="flex items-center gap-2">
                              <button 
                                onClick={() => isMappingThis ? cancelBinding() : startBindingAction(shortcutScene, key)}
                                className={`min-w-[80px] px-2 py-1.5 rounded text-[10px] font-mono border transition-colors ${isMappingThis ? 'bg-indigo-600 border-indigo-400 text-white animate-pulse' : 'bg-white dark:bg-slate-900 border-gray-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'}`}
                              >
                                {isMappingThis ? t.pressKeyToBind : (currentBind || t.none)}
                              </button>
                              {isMappingThis ? (
                                  <button onClick={cancelBinding} className="w-6 h-6 flex items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30 text-red-500 hover:bg-red-200"><i className="fa-solid fa-xmark text-[10px]"></i></button>
                              ) : (
                                  <button onClick={() => clearBinding(shortcutScene, key)} className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-200 dark:bg-slate-700 text-slate-500 hover:text-red-500"><i className="fa-solid fa-eraser text-[10px]"></i></button>
                              )}
                          </div>
                      ) : (
                          <span className="min-w-[80px] px-2 py-1.5 text-right text-[10px] font-mono text-slate-500 dark:text-slate-400">
                             {currentBind || t.none}
                          </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Anki Section */}
          <button onClick={() => toggleSection('anki')} className="w-full flex items-center justify-between p-4 bg-gray-50/50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-700/50 border-b border-gray-200 dark:border-slate-700/50 text-left transition-colors">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">{t.ankiSettings}</span>
          </button>
          {openSections.has('anki') && (
            <div className="p-4 space-y-4 bg-white dark:bg-slate-800/30 transition-colors">
               <div className="grid grid-cols-2 gap-4">
                   <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{t.ankiHost}</label>
                      <input type="text" placeholder="127.0.0.1" value={ankiSettings.host} onChange={(e) => setAnkiSettings({...ankiSettings, host: e.target.value})} className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 text-slate-800 dark:text-white p-2 rounded outline-none text-xs transition-colors" />
                   </div>
                   <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{t.ankiPort}</label>
                      <input type="number" placeholder="8765" value={ankiSettings.port} onChange={(e) => setAnkiSettings({...ankiSettings, port: parseInt(e.target.value)})} className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 text-slate-800 dark:text-white p-2 rounded outline-none text-xs transition-colors" />
                   </div>
               </div>
               
               {/* New Toggle for Bolding */}
               <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Bold Target Word</span>
                  <input type="checkbox" checked={readerSettings.ankiBoldWord} onChange={e => setReaderSettings({...readerSettings, ankiBoldWord: e.target.checked})} className="accent-indigo-600" />
               </div>

               <button onClick={checkAnkiConnection} className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold text-xs shadow-md transition-all">{t.ankiTest}</button>

               {/* ... (Anki Connected Details remain same) ... */}
               {ankiConnected && (
                   <div className="pt-4 border-t border-gray-200 dark:border-slate-700 space-y-4 animate-fade-in">
                       <div>
                           <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{ankiConfigMode === 'word' ? t.ankiDeck : t.ankiDeckSentence}</label>
                           <select 
                               value={ankiConfigMode === 'word' ? ankiSettings.deckName : (ankiSettings.sentenceDeckName || ankiSettings.deckName)} 
                               onChange={(e) => {
                                   if (ankiConfigMode === 'word') setAnkiSettings({...ankiSettings, deckName: e.target.value});
                                   else setAnkiSettings({...ankiSettings, sentenceDeckName: e.target.value});
                               }} 
                               className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 text-slate-800 dark:text-white p-2 rounded outline-none text-xs"
                           >
                               {ankiDecks.map(d => <option key={d} value={d}>{d}</option>)}
                           </select>
                       </div>
                       <div>
                           <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{ankiConfigMode === 'word' ? t.ankiModel : t.ankiModelSentence}</label>
                           <select 
                               value={ankiConfigMode === 'word' ? ankiSettings.modelName : (ankiSettings.sentenceModelName || ankiSettings.modelName)} 
                               onChange={(e) => {
                                   if (ankiConfigMode === 'word') setAnkiSettings({...ankiSettings, modelName: e.target.value});
                                   else setAnkiSettings({...ankiSettings, sentenceModelName: e.target.value});
                               }} 
                               className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 text-slate-800 dark:text-white p-2 rounded outline-none text-xs"
                           >
                               {ankiModels.map(m => <option key={m} value={m}>{m}</option>)}
                           </select>
                       </div>
                       
                       <div>
                           <div className="flex items-center justify-between mb-3">
                               <label className="text-[10px] font-bold text-indigo-500 uppercase">{t.fieldMapping}</label>
                               <div className="flex bg-gray-100 dark:bg-slate-900 rounded p-0.5 border border-gray-200 dark:border-slate-700">
                                   <button 
                                      onClick={() => setAnkiConfigMode('word')} 
                                      className={`px-2 py-0.5 text-[9px] rounded transition-all ${ankiConfigMode === 'word' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}
                                   >
                                      {t.ankiModeWord}
                                   </button>
                                   <button 
                                      onClick={() => setAnkiConfigMode('sentence')} 
                                      className={`px-2 py-0.5 text-[9px] rounded transition-all ${ankiConfigMode === 'sentence' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}
                                   >
                                      {t.ankiModeSentence}
                                   </button>
                               </div>
                           </div>
                           
                           <div className="space-y-2">
                               {availableFields.map(fieldType => (
                                   <div key={fieldType} className="flex flex-col gap-1">
                                       <span className="text-[10px] text-slate-500 capitalize">{t[`field${fieldType.charAt(0).toUpperCase() + fieldType.slice(1)}` as keyof typeof t] || fieldType}</span>
                                       <select 
                                          value={currentAnkiFieldMap[fieldType as keyof typeof currentAnkiFieldMap] || ''} 
                                          onChange={(e) => updateAnkiField(fieldType, e.target.value)} 
                                          className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 text-slate-800 dark:text-white p-1.5 rounded outline-none text-xs"
                                       >
                                           <option value="">{t.none}</option>
                                           {ankiFields.map(f => <option key={f} value={f}>{f}</option>)}
                                       </select>
                                   </div>
                               ))}
                           </div>
                           <p className="text-[9px] text-slate-400 mt-2 italic">
                               {ankiConfigMode === 'sentence' ? t.ankiModeSentenceDesc : t.ankiModeWordDesc}
                           </p>
                       </div>
                       
                       <div>
                           <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">{t.ankiTags}</label>
                           <input type="text" value={ankiSettings.tags} onChange={(e) => setAnkiSettings({...ankiSettings, tags: e.target.value})} className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 text-slate-800 dark:text-white p-2 rounded outline-none text-xs transition-colors" placeholder={t.tagsPlaceholder} />
                       </div>

                       <button 
                           onClick={() => { localStorage.setItem('lf_anki', JSON.stringify(ankiSettings)); showToast(t.saveSuccess || "Settings saved successfully."); }}
                           className="w-full py-2 bg-green-600 hover:bg-green-500 text-white rounded font-bold text-xs shadow-md transition-all mt-2"
                       >
                           <i className="fa-solid fa-save mr-2"></i> {t.save || "Save Settings"}
                       </button>
                   </div>
               )}
            </div>
          )}

          <button onClick={() => toggleSection('data')} className="w-full flex items-center justify-between p-4 bg-gray-50/50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-700/50 border-b border-gray-200 dark:border-slate-700/50 text-left transition-colors">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">{t.dataManagement}</span>
          </button>
          {openSections.has('data') && (
            <div className="p-4 bg-white dark:bg-slate-800/30 transition-colors space-y-3">
               <div className="flex gap-2">
                   <button onClick={handleExportSettings} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1">
                       <i className="fa-solid fa-download"></i> {t.exportSettings}
                   </button>
                   <label className="flex-1 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1 cursor-pointer">
                       <i className="fa-solid fa-upload"></i> {t.importSettings}
                       <input type="file" accept=".json" onChange={handleImportSettings} className="hidden" />
                   </label>
               </div>
               <button onClick={async () => { if(confirm(t.clearCacheConfirm)) { await clearAllDataFromDB(); location.reload(); } }} className="w-full py-2 bg-red-100 dark:bg-red-600/20 text-red-600 dark:text-red-500 border border-red-200 dark:border-red-500/30 rounded font-bold text-xs transition-colors">{t.clearCache}</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
