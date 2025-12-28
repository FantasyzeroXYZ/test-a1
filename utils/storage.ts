
import { AudioTrack } from '../types';

const DB_NAME = 'LinguaFlowDB';
const DB_VERSION = 1;
const STORE_NAME = 'tracks';

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveTrackToDB = async (track: AudioTrack, file: File) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // 移除无法序列化的临时 URL (包括音频 URL 和封面 URL 字符串)
    // coverBlob 会被保留并存入 IndexedDB
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
            // Fix for iOS M4B playback: Force correct MIME type
            if (file.name.toLowerCase().endsWith('.m4b') || file.name.toLowerCase().endsWith('.m4a')) {
                const fixedBlob = file.slice(0, file.size, 'audio/mp4');
                audioUrl = URL.createObjectURL(fixedBlob);
            } else {
                audioUrl = URL.createObjectURL(file);
            }
        }

        return {
          ...item,
          url: audioUrl, // 为当前会话重新生成音频 URL
          cover: coverBlob ? URL.createObjectURL(coverBlob) : item.cover // 为当前会话重新生成封面 URL (如果 blob 存在)
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
        // 如果更新包含新的 URL，移除它们以免存入 DB
        const { url, cover, ...cleanUpdates } = updates;
        
        // 如果 updates 里有 coverBlob，它会被 merge 进去
        // 如果 updates 里有 cover 字符串但没有 blob (不太可能在当前逻辑下), 我们忽略字符串更新以防覆盖 blob
        
        const finalData = { ...data, ...cleanUpdates, updatedAt: Date.now() };
        // 显式确保如果 updates 有 coverBlob，它被保存
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
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};
