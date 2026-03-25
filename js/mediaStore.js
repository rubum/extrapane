/**
 * mediaStore.js
 * Persistent storage for binary media (videos/blobs) using IndexedDB.
 */

const DB_NAME = 'ExtrapaneMediaStore';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

let db = null;

/** Initializes the IndexedDB database. */
export async function initDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = (event) => {
      console.error('IndexedDB Error:', event.target.error);
      reject(event.target.error);
    };
  });
}

/** 
 * Saves a Blob or File to the persistent store. 
 * Returns the unique ID for the stored item.
 */
export async function saveMedia(blob, customId, customName) {
  const database = await initDB();
  const id = customId || `media-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const name = customName || id.split('-').slice(0, 2).join('-');
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // Store original blob and metadata
    const request = store.put({
      id: id,
      name: name,
      blob: blob,
      type: blob.type,
      size: blob.size,
      timestamp: Date.now()
    });

    request.onsuccess = () => {
      window.dispatchEvent(new CustomEvent('media-updated'));
      resolve(id);
    };
    request.onerror = (event) => reject(event.target.error);
  });
}

/** 
 * Updates the name of a stored media item.
 */
export async function renameMedia(id, newName) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const data = getRequest.result;
      if (data) {
        data.name = newName;
        const putRequest = store.put(data);
        putRequest.onsuccess = () => {
          window.dispatchEvent(new CustomEvent('media-updated'));
          resolve();
        };
        putRequest.onerror = (event) => reject(event.target.error);
      } else {
        reject(new Error('Media not found'));
      }
    };
    getRequest.onerror = (event) => reject(event.target.error);
  });
}

/** 
 * Retrieves a Blob from the persistent store by its ID.
 */
export async function getMedia(id) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.blob);
      } else {
        resolve(null);
      }
    };
    request.onerror = (event) => reject(event.target.error);
  });
}

/** 
 * Deletes a stored item by its ID.
 */
export async function deleteMedia(id) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => {
      window.dispatchEvent(new CustomEvent('media-updated'));
      resolve();
    };
    request.onerror = (event) => reject(event.target.error);
  });
}

/** 
 * Lists all stored media IDs and metadata.
 */
export async function listMedia() {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Calculates total disk space used by the persistent store.
 */
export async function getStorageStats() {
  const mediaItems = await listMedia();
  const totalBytes = mediaItems.reduce((acc, item) => acc + (item.size || 0), 0);
  return {
    totalBytes: totalBytes,
    itemCount: mediaItems.length
  };
}
