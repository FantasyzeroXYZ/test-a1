
import React, { useState, useEffect } from 'react';
import { Language, SubtitleMode, KeyBindings, GameType, LearningLanguage, AnkiSettings, SegmentationMode, PlaybackMode, WebSearchEngine } from '../types';
import { getTranslation } from '../utils/i18n';
import { DEFAULT_KEY_BINDINGS } from '../constants';
import * as AnkiService from '../services/ankiService';
import { getAllTracksFromDB, clearAllDataFromDB } from '../utils/storage';
import { downloadFile } from '../utils/parsers';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  learningLanguage: LearningLanguage;
  setLearningLanguage: (lang: LearningLanguage) => void;
  gameType: GameType;
  setGameType: (type: GameType) => void;
  playbackMode: PlaybackMode;
  setPlaybackMode: (mode: PlaybackMode) => void;
  subtitleMode: SubtitleMode;
  setSubtitleMode: (mode: SubtitleMode) => void;
  subtitleFontSize: number;
  setSubtitleFontSize: (size: number) => void;
  keyBindings: KeyBindings;
  setKeyBindings: (bindings: KeyBindings) => void;
  ankiSettings: AnkiSettings;
  setAnkiSettings: (settings: AnkiSettings) => void;
  speechEnabled: boolean;
  setSpeechEnabled: (enabled: boolean) => void;
  speechLang: string;
  setSpeechLang: (lang: string) => void;
  segmentationMode: SegmentationMode;
  setSegmentationMode: (mode: SegmentationMode) => void;
  webSearchEngine: WebSearchEngine; // 新增
  setWebSearchEngine: (engine: WebSearchEngine) => void; // 新增
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen, onClose, language, setLanguage, learningLanguage, setLearningLanguage, gameType, setGameType, playbackMode, setPlaybackMode, subtitleMode, setSubtitleMode, subtitleFontSize, setSubtitleFontSize, keyBindings, setKeyBindings, ankiSettings, setAnkiSettings, speechEnabled, setSpeechEnabled, speechLang, setSpeechLang, segmentationMode, setSegmentationMode, webSearchEngine, setWebSearchEngine
}) => {
  const t = getTranslation(language);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [ankiConnectionStatus, setAnkiConnectionStatus] = useState<'none'|'success'|'fail'>('none');
  const [ankiDecks, setAnkiDecks] = useState<string[]>([]);
  const [ankiModels, setAnkiModels] = useState<string[]>([]);
  const [ankiModelFields, setAnkiModelFields] = useState<string[]>([]);
  const [bindingKey, setBindingKey] = useState<keyof KeyBindings | null>(null);

  if (!isOpen) return null;

  const toggleSection = (section: string) => {
    setOpenSection(openSection === section ? null : section);
  };

  const startBinding = (key: keyof KeyBindings) => {
    setBindingKey(key);
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      setKeyBindings({ ...keyBindings, [key]: e.code });
      setBindingKey(null);
      window.removeEventListener('keydown', handler);
    };
    window.addEventListener('keydown', handler);
  };

  const handleAnkiTest = async () => {
    setAnkiConnectionStatus('none');
    try {
      const success = await AnkiService.testConnection(ankiSettings);
      if (success) {
        const decks = await AnkiService.getDeckNames(ankiSettings);
        const models = await AnkiService.getModelNames(ankiSettings);
        setAnkiDecks(decks);
        setAnkiModels(models);
        
        let currentDeck = ankiSettings.deckName;
        if (!decks.includes(currentDeck) && decks.length > 0) currentDeck = decks[0];
        
        let currentModel = ankiSettings.modelName;
        if (!models.includes(currentModel) && models.length > 0) currentModel = models[0];

        const fields = await AnkiService.getModelFieldNames(ankiSettings, currentModel);
        setAnkiModelFields(fields);
        
        setAnkiSettings({
          ...ankiSettings,
          deckName: currentDeck,
          modelName: currentModel
        });
        setAnkiConnectionStatus('success');
      } else {
        setAnkiConnectionStatus('fail');
      }
    } catch (e) {
      setAnkiConnectionStatus('fail');
    }
  };

  const handleModelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    try {
      const fields = await AnkiService.getModelFieldNames(ankiSettings, newModel);
      setAnkiModelFields(fields);
      setAnkiSettings({ ...ankiSettings, modelName: newModel });
    } catch (err) {
      console.error(err);
    }
  };

  const handleExportData = async () => {
    const allTracks = await getAllTracksFromDB();
    const exportObject = {
      version: "1.0",
      settings: { language, learningLanguage, gameType, playbackMode, subtitleMode, subtitleFontSize, ankiSettings, speechEnabled, speechLang, segmentationMode, keyBindings, webSearchEngine },
      library: allTracks.map(({file, url, cover, ...rest}) => rest) 
    };
    downloadFile(JSON.stringify(exportObject, null, 2), `LF_Backup.json`, 'application/json');
  };

  const handleClearCache = async () => {
    if (confirm(t.clearCacheConfirm)) {
      await clearAllDataFromDB();
      localStorage.clear();
      window.location.reload();
    }
  };

  const SectionHeader = ({ id, title }: { id: string, title: string }) => (
    <button onClick={() => toggleSection(id)} className="w-full flex items-center justify-between p-4 bg-slate-700/50 hover:bg-slate-700 transition-colors border-b border-slate-700 last:border-0 text-left">
      <span className="text-xs uppercase font-bold text-slate-300 tracking-wider">{title}</span>
      <svg className={`w-4 h-4 text-slate-400 transform transition-transform ${openSection === id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
    </button>
  );

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[65] transition-opacity duration-300" onClick={onClose} />
      <div className="absolute top-0 right-0 bottom-0 w-80 bg-slate-800 shadow-2xl border-l border-slate-700 z-[70] flex flex-col animate-slide-in">
        <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-900/50">
          <h2 className="text-xl font-bold text-white">{t.settings}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-2 text-xl">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto pb-20">
          <div className="border-b border-slate-700/50">
            <SectionHeader id="general" title={t.general} />
            {openSection === 'general' && (
              <div className="p-4 space-y-4 bg-slate-800/50">
                 <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">{t.language}</label>
                    <select value={language} onChange={(e) => setLanguage(e.target.value as Language)} className="w-full bg-slate-900 text-white p-2 rounded border border-slate-600 outline-none"><option value="zh">{t.langZh}</option><option value="en">{t.langEn}</option></select>
                    <label className="block text-sm font-medium text-slate-400 mb-2 mt-4">{t.learningLanguage}</label>
                    <select value={learningLanguage} onChange={(e) => setLearningLanguage(e.target.value as LearningLanguage)} className="w-full bg-slate-900 text-white p-2 rounded border border-slate-600 outline-none"><option value="en">{t.langEn}</option><option value="zh">{t.langZh}</option><option value="ja">{t.langJa}</option><option value="es">{t.langEs}</option><option value="ru">{t.langRu}</option><option value="fr">{t.langFr}</option></select>
                 </div>
                 <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">{t.segMode}</label>
                  <select value={segmentationMode} onChange={(e) => setSegmentationMode(e.target.value as SegmentationMode)} className="w-full bg-slate-900 text-white p-2 rounded border border-slate-600 outline-none">
                    <option value="browser">{t.segBrowser}</option>
                    <option value="mecab">{t.segMecab}</option>
                    <option value="none">{t.segNone}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">{t.searchEngine}</label>
                  <select value={webSearchEngine} onChange={(e) => setWebSearchEngine(e.target.value as WebSearchEngine)} className="w-full bg-slate-900 text-white p-2 rounded border border-slate-600 outline-none">
                    <option value="google">{t.engineGoogle}</option>
                    <option value="baidu">{t.engineBaidu}</option>
                    <option value="baidu_baike">{t.engineBaiduBaike}</option>
                    <option value="bing">{t.engineBing}</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="border-b border-slate-700/50">
            <SectionHeader id="interface" title={t.interface} />
            {openSection === 'interface' && (
              <div className="p-4 space-y-4 bg-slate-800/50">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">{t.subtitleMode}</label>
                  <select value={subtitleMode} onChange={(e) => setSubtitleMode(e.target.value as SubtitleMode)} className="w-full bg-slate-900 text-white p-2 rounded border border-slate-600 outline-none">
                    <option value="scroll">{t.modeScroll}</option>
                    <option value="single">{t.modeSingle}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">{t.fontSize}</label>
                  <input type="range" min="12" max="40" value={subtitleFontSize} onChange={(e) => setSubtitleFontSize(parseInt(e.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                  <p className="text-right text-xs text-slate-400 mt-1">{subtitleFontSize}px</p>
                </div>
              </div>
            )}
          </div>

          <div className="border-b border-slate-700/50">
            <SectionHeader id="shortcuts" title={t.shortcuts} />
            {openSection === 'shortcuts' && (
              <div className="p-4 bg-slate-800/50 space-y-3">
                {[
                  { id: 'playPause', label: t.keyPlayPause },
                  { id: 'rewind', label: t.keyRewind },
                  { id: 'forward', label: t.keyForward },
                  { id: 'toggleSidebar', label: t.keySidebar },
                  { id: 'toggleSubtitleMode', label: t.keySubMode },
                ].map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-400">{item.label}</span>
                    <button 
                      onClick={() => startBinding(item.id as keyof KeyBindings)}
                      className={`min-w-[80px] px-2 py-1.5 rounded text-[10px] font-mono border transition-all ${bindingKey === item.id ? 'bg-indigo-600 border-indigo-400 animate-pulse text-white' : 'bg-slate-900 border-slate-700 text-indigo-400'}`}
                    >
                      {bindingKey === item.id ? t.pressKeyToBind : (keyBindings[item.id as keyof KeyBindings] || 'None')}
                    </button>
                  </div>
                ))}
                <div className="pt-2 border-t border-slate-700 mt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">{t.gamepadSupport}</span>
                    <input type="checkbox" checked={true} readOnly className="accent-indigo-500" />
                  </div>
                  <p className="text-[9px] text-slate-500 mt-1 italic">Maps standard D-Pad / ABXY to controls.</p>
                </div>
              </div>
            )}
          </div>

          <div className="border-b border-slate-700/50">
            <SectionHeader id="anki" title={t.ankiSettings} />
            {openSection === 'anki' && (
               <div className="p-4 space-y-4 bg-slate-800/50">
                  <div className="flex gap-2">
                    <div className="flex-1"><label className="text-xs text-slate-400 block mb-1">{t.ankiHost}</label><input type="text" value={ankiSettings.host} onChange={(e) => setAnkiSettings({...ankiSettings, host: e.target.value})} className="w-full bg-slate-900 text-sm p-2 rounded border border-slate-600"/></div>
                    <div className="w-20"><label className="text-xs text-slate-400 block mb-1">{t.ankiPort}</label><input type="number" value={ankiSettings.port} onChange={(e) => setAnkiSettings({...ankiSettings, port: parseInt(e.target.value)})} className="w-full bg-slate-900 text-sm p-2 rounded border border-slate-600"/></div>
                  </div>
                  <button onClick={handleAnkiTest} className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-bold transition-colors">{t.ankiTest}</button>
                  {ankiConnectionStatus === 'success' && <p className="text-green-400 text-xs text-center">{t.ankiConnected}</p>}
                  {ankiConnectionStatus === 'fail' && <p className="text-red-400 text-xs text-center">{t.ankiNotConnected}</p>}
                  
                  {(ankiConnectionStatus === 'success' || ankiModelFields.length > 0) && (
                    <div className="space-y-3 pt-2 border-t border-slate-700 animate-fade-in">
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">{t.ankiDeck}</label>
                        <select value={ankiSettings.deckName} onChange={(e) => setAnkiSettings({...ankiSettings, deckName: e.target.value})} className="w-full bg-slate-900 text-white p-2 rounded border border-slate-600 text-sm">
                          {ankiDecks.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">{t.ankiModel}</label>
                        <select value={ankiSettings.modelName} onChange={handleModelChange} className="w-full bg-slate-900 text-white p-2 rounded border border-slate-600 text-sm">
                          {ankiModels.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-slate-400 block font-bold mt-2">{t.ankiFields}</label>
                        {[{ key: 'word', label: t.fieldWord },{ key: 'definition', label: t.fieldDef },{ key: 'sentence', label: t.fieldSentence },{ key: 'translation', label: t.fieldTrans },{ key: 'audio', label: t.fieldAudio }].map(f => (
                          <div key={f.key} className="flex items-center justify-between gap-2">
                            <span className="text-xs text-slate-500 w-16">{f.label}</span>
                            <select value={(ankiSettings.fieldMap as any)[f.key] || ''} onChange={(e) => setAnkiSettings({...ankiSettings, fieldMap: { ...ankiSettings.fieldMap, [f.key]: e.target.value }})} className="flex-1 bg-slate-900 text-[10px] p-1 rounded border border-slate-600">
                              <option value="">({t.remove})</option>
                              {ankiModelFields.map(field => <option key={field} value={field}>{field}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">{t.ankiTags}</label>
                        <input type="text" value={ankiSettings.tags} onChange={(e) => setAnkiSettings({...ankiSettings, tags: e.target.value})} placeholder="linguaflow, study" className="w-full bg-slate-900 text-sm p-2 rounded border border-slate-600"/>
                      </div>
                    </div>
                  )}
               </div>
            )}
          </div>

          <div className="border-b border-slate-700/50">
            <SectionHeader id="data" title={t.dataManagement} />
            {openSection === 'data' && (
              <div className="p-4 space-y-3 bg-slate-800/50">
                 <button onClick={handleExportData} className="w-full py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-xs font-bold transition-all">{t.exportData}</button>
                 <button onClick={handleClearCache} className="w-full py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-xs font-bold transition-all">{t.clearCache}</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
