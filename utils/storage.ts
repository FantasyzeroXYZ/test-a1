
import { AudioTrack, DictionaryEntry, DictionaryResult } from '../types';

const DB_NAME = 'LinguaFlowDB';
const DB_VERSION = 5; 
const STORE_NAME = 'tracks';
const DICT_STORE_NAME = 'dictionary';
const DICT_META_STORE_NAME = 'dictionary_meta';

export interface DictionaryMeta {
  id: string;
  name: string;
  type: 'definition' | 'tag'; 
  scope: string; 
  count: number;
  priority: number; 
  importedAt: number;
}

export interface LocalDictEntry {
  term: string;
  reading?: string;
  definitions: string[];
  tags?: string[]; 
  dictionaryId: string;
}

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const transaction = request.transaction;
      
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      
      let dictStore;
      if (!db.objectStoreNames.contains(DICT_STORE_NAME)) {
        dictStore = db.createObjectStore(DICT_STORE_NAME, { autoIncrement: true });
        dictStore.createIndex('term', 'term', { unique: false });
      } else {
        dictStore = transaction?.objectStore(DICT_STORE_NAME);
      }
      
      if (dictStore && !dictStore.indexNames.contains('dictionaryId')) {
          dictStore.createIndex('dictionaryId', 'dictionaryId', { unique: false });
      }

      if (!db.objectStoreNames.contains(DICT_META_STORE_NAME)) {
        db.createObjectStore(DICT_META_STORE_NAME, { keyPath: 'id' });
      }
    };
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// --- Track Functions ---

export const saveTrackToDB = async (track: AudioTrack, file: File) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const { url, cover, ...trackData } = track;
    
    const request = store.put({
      ...trackData,
      file,
      updatedAt: Date.now()
    });
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const deleteTrackFromDB = async (id: string) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getAllTracksFromDB = async (): Promise<AudioTrack[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    
    request.onsuccess = () => {
      const results = request.result.map(item => {
        const file = item.file as File;
        const coverBlob = item.coverBlob as Blob | undefined;
        
        let audioUrl = "";
        if (file) {
            const name = file.name.toLowerCase();
            if (name.endsWith('.m4b') || name.endsWith('.m4a') || file.type === 'audio/x-m4b') {
                const fixedBlob = file.slice(0, file.size, 'audio/mp4');
                audioUrl = URL.createObjectURL(fixedBlob);
            } else {
                audioUrl = URL.createObjectURL(file);
            }
        }

        return {
          ...item,
          url: audioUrl,
          cover: coverBlob ? URL.createObjectURL(coverBlob) : item.cover
        };
      });
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
};

export const updateTrackMetadataInDB = async (id: string, updates: Partial<AudioTrack>) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(id);
    
    getRequest.onsuccess = () => {
      const data = getRequest.result;
      if (data) {
        const { url, cover, ...cleanUpdates } = updates;
        const finalData = { ...data, ...cleanUpdates, updatedAt: Date.now() };
        if (updates.coverBlob) {
            finalData.coverBlob = updates.coverBlob;
        }
        store.put(finalData);
      }
      resolve();
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
};

export const clearAllDataFromDB = async () => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME, DICT_STORE_NAME, DICT_META_STORE_NAME], 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    transaction.objectStore(DICT_STORE_NAME).clear();
    transaction.objectStore(DICT_META_STORE_NAME).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

// --- Dictionary Management Functions ---

export const saveDictionaryMeta = async (meta: DictionaryMeta) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(DICT_META_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(DICT_META_STORE_NAME);
    store.put(meta);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const getDictionaries = async (): Promise<DictionaryMeta[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DICT_META_STORE_NAME, 'readonly');
    const store = transaction.objectStore(DICT_META_STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
        const sorted = (request.result || []).sort((a: DictionaryMeta, b: DictionaryMeta) => a.priority - b.priority);
        resolve(sorted);
    };
    request.onerror = () => reject(request.error);
  });
};

export const deleteDictionary = async (id: string) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([DICT_STORE_NAME, DICT_META_STORE_NAME], 'readwrite');
    
    transaction.objectStore(DICT_META_STORE_NAME).delete(id);

    const entryStore = transaction.objectStore(DICT_STORE_NAME);
    const index = entryStore.index('dictionaryId');
    const range = IDBKeyRange.only(id);
    const cursorReq = index.openCursor(range);
    
    cursorReq.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest).result;
        if (cursor) {
            cursor.delete();
            cursor.continue();
        }
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const updateDictionary = async (id: string, updates: Partial<DictionaryMeta>) => {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(DICT_META_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(DICT_META_STORE_NAME);
        const getReq = store.get(id);
        getReq.onsuccess = () => {
            if (getReq.result) {
                store.put({ ...getReq.result, ...updates });
            }
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
};

// --- Dictionary Entry Functions ---

export const saveDictionaryBatch = async (entries: LocalDictEntry[]) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(DICT_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(DICT_STORE_NAME);
    
    entries.forEach(entry => {
      store.put(entry);
    });
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const getLocalTagsForTerm = async (term: string, scope: string): Promise<string[]> => {
  const db = await initDB();
  const dictionaries = await getDictionaries();
  const tagDicts = dictionaries.filter(d => (d.scope === 'universal' || d.scope === scope) && d.type === 'tag');
  if (tagDicts.length === 0) return [];
  
  const tagDictIds = new Set(tagDicts.map(d => d.id));

  return new Promise((resolve, reject) => {
      const transaction = db.transaction(DICT_STORE_NAME, 'readonly');
      const store = transaction.objectStore(DICT_STORE_NAME);
      const index = store.index('term');
      const request = index.getAll(term);
      
      request.onsuccess = () => {
          const rawResults: LocalDictEntry[] = request.result || [];
          const tags: string[] = [];
          
          rawResults.forEach(entry => {
              if (tagDictIds.has(entry.dictionaryId)) {
                  tags.push(...entry.definitions);
              }
          });
          resolve([...new Set(tags)]);
      };
      request.onerror = () => resolve([]);
  });
};

export const searchLocalDictionary = async (term: string, currentScope: string): Promise<DictionaryResult | null> => {
  const db = await initDB();
  
  const dictionaries = await getDictionaries();
  if (dictionaries.length === 0) return null;

  const activeDicts = dictionaries.filter(d => d.scope === 'universal' || d.scope === currentScope);
  const activeDictIds = new Set(activeDicts.map(d => d.id));
  const dictMap = new Map(activeDicts.map(d => [d.id, d]));

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DICT_STORE_NAME, 'readonly');
    const store = transaction.objectStore(DICT_STORE_NAME);
    const index = store.index('term');
    const request = index.getAll(term);
    
    request.onsuccess = () => {
      const rawResults: LocalDictEntry[] = request.result || [];
      const filtered = rawResults.filter(r => r.dictionaryId && activeDictIds.has(r.dictionaryId));
      
      if (filtered.length === 0) {
        resolve(null);
        return;
      }

      const definitionEntries: LocalDictEntry[] = [];
      const tags: string[] = [];

      filtered.forEach(entry => {
          const dictMeta = dictMap.get(entry.dictionaryId);
          if (!dictMeta) return;

          if (dictMeta.type === 'tag') {
              tags.push(...entry.definitions);
          } else {
              definitionEntries.push(entry);
          }
      });
      
      definitionEntries.sort((a, b) => {
          const pA = dictMap.get(a.dictionaryId)?.priority || 9999;
          const pB = dictMap.get(b.dictionaryId)?.priority || 9999;
          return pA - pB;
      });
      
      if (definitionEntries.length === 0 && tags.length > 0) {
           const mappedResult: DictionaryResult = {
            word: term,
            entries: [{
                partOfSpeech: 'Tags',
                pronunciations: [],
                senses: [{ definition: 'No definition found, only tags available.', examples: [], subsenses: [] }],
                tags: [...tags]
            }]
          };
          resolve(mappedResult);
          return;
      }

      const mappedResult: DictionaryResult = {
        word: term,
        entries: definitionEntries.map(item => ({
          partOfSpeech: dictMap.get(item.dictionaryId)?.name || 'Dictionary',
          pronunciations: item.reading ? [{ text: item.reading }] : [],
          tags: [...(item.tags || []), ...tags],
          senses: [{
             definition: item.definitions.join(''),
             examples: [],
             subsenses: []
          }]
        }))
      };
      
      resolve(mappedResult);
    };
    request.onerror = () => reject(request.error);
  });
};
