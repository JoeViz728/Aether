const DB_NAME = 'aether-tts';
const DB_VERSION = 1;
const STORE = 'audio';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
  });
}

export function makeTtsCacheKey(
  messageId: string,
  voiceId: string,
  paragraphIndex: number,
  text: string,
): string {
  return `${messageId}:${voiceId}:${paragraphIndex}:${hashText(text)}`;
}

function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export async function getTtsCache(key: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
    });
  } catch {
    return null;
  }
}

export async function setTtsCache(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const request = tx.objectStore(STORE).put(blob, key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch {
    /* cache is best-effort */
  }
}

export async function clearTtsCacheForMessage(messageId: string, voiceId: string): Promise<void> {
  try {
    const db = await openDb();
    const prefix = `${messageId}:${voiceId}:`;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.getAllKeys();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const keys = request.result as IDBValidKey[];
        for (const key of keys) {
          if (typeof key === 'string' && key.startsWith(prefix)) {
            store.delete(key);
          }
        }
        resolve();
      };
    });
  } catch {
    /* ignore */
  }
}