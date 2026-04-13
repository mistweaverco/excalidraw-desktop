const DB_NAME = "excalidraw-desktop";
const DB_VERSION = 1;
const STORE = "kv";
const LIBRARY_RECORD_KEY = "library";

export type LibraryPersistedShape = {
  libraryItems: unknown;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });
}

export async function loadLibraryFromIndexedDb(): Promise<LibraryPersistedShape | null> {
  const db = await openDb();
  try {
    return await new Promise<LibraryPersistedShape | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const getReq = tx.objectStore(STORE).get(LIBRARY_RECORD_KEY);
      getReq.onsuccess = () => {
        const row = getReq.result as string | undefined;
        if (typeof row !== "string" || !row) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(row) as LibraryPersistedShape;
          if (parsed?.libraryItems) {
            resolve(parsed);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } finally {
    db.close();
  }
}

export async function saveLibraryToIndexedDb(libraryData: LibraryPersistedShape): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(JSON.stringify(libraryData), LIBRARY_RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
