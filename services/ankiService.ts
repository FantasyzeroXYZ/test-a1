
import { AnkiSettings } from '../types';

const invoke = async (settings: AnkiSettings, action: string, params: any = {}) => {
  const url = `http://${settings.host}:${settings.port}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action, version: 6, params })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error);
    }
    return result.result;
  } catch (error) {
    console.error(`AnkiConnect Error (${action}):`, error);
    throw error;
  }
};

export const testConnection = async (settings: AnkiSettings): Promise<boolean> => {
  try {
    const version = await invoke(settings, 'version');
    return !!version;
  } catch (e) {
    return false;
  }
};

export const getDeckNames = async (settings: AnkiSettings): Promise<string[]> => {
  return await invoke(settings, 'deckNames');
};

export const getModelNames = async (settings: AnkiSettings): Promise<string[]> => {
  return await invoke(settings, 'modelNames');
};

export const getModelFieldNames = async (settings: AnkiSettings, modelName: string): Promise<string[]> => {
  return await invoke(settings, 'modelFieldNames', { modelName });
};

/**
 * Stores a media file in Anki and returns its assigned filename.
 */
export const storeMediaFile = async (settings: AnkiSettings, filename: string, dataBase64: string): Promise<string> => {
  // AnkiConnect's storeMediaFile expects base64 without the data URI prefix
  const base64Data = dataBase64.split(',')[1] || dataBase64;
  return await invoke(settings, 'storeMediaFile', {
    filename,
    data: base64Data
  });
};

export const addNote = async (
  settings: AnkiSettings, 
  data: {
    word: string;
    definition: string;
    sentence: string;
    translation: string;
    audioBase64?: string;
    examVocab?: string; // Added Exam Vocabulary data
  }
) => {
  const fields: Record<string, string> = {};
  
  // Map our data to the user's selected fields
  if (settings.fieldMap.word) fields[settings.fieldMap.word] = data.word;
  if (settings.fieldMap.definition) fields[settings.fieldMap.definition] = data.definition;
  if (settings.fieldMap.sentence) fields[settings.fieldMap.sentence] = data.sentence;
  if (settings.fieldMap.translation) fields[settings.fieldMap.translation] = data.translation;
  if (settings.fieldMap.examVocab) fields[settings.fieldMap.examVocab] = data.examVocab || '';
  
  // If we have audio, store it first to get the correct filename
  if (data.audioBase64 && settings.fieldMap.audio) {
    try {
      // Use .webm extension for MediaRecorder captured audio (Opus codec usually)
      const originalFilename = `vam_audio_${Date.now()}.webm`; 
      const storedFilename = await storeMediaFile(settings, originalFilename, data.audioBase64);
      // Reference the actual stored filename using Anki syntax [sound:filename]
      fields[settings.fieldMap.audio] = `[sound:${storedFilename}]`;
    } catch (err) {
      console.error("Failed to store media file, continuing without audio", err);
    }
  }

  const note = {
    deckName: settings.deckName,
    modelName: settings.modelName,
    fields: fields,
    tags: settings.tags.split(',').map(t => t.trim()).filter(t => t)
  };

  return await invoke(settings, 'addNote', { note });
};
