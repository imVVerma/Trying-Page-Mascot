/**
 * Local persistence for generated mascots.
 *
 * Uses IndexedDB rather than localStorage: a mascot is three 1080x1080 sheets as
 * base64 webp, which is roughly 1.5 MB — well past localStorage's ~5 MB quota
 * once a few generations accumulate, and it blocks the whole origin when hit.
 */

const DB_NAME = 'page-mascot';
const DB_VERSION = 1;
const STORE = 'mascots';

export interface StoredMascot {
  id: string;
  name: string;
  createdAt: number;
  /** 1080x1080 webp data URI. */
  directionsUrl: string;
  reactionsUrl: string;
  /** Canonical bust, used for the picker thumbnail. */
  previewUrl: string;
  /** Which sheets came from the model rather than the procedural fallback. */
  source: { directions: 'ai' | 'procedural'; reactions: 'ai' | 'procedural' };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open database'));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Storage request failed'));
        t.oncomplete = () => db.close();
      })
  );
}

/** Persists (or replaces) a generated mascot. */
export async function saveMascot(mascot: StoredMascot): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put(mascot) as IDBRequest<IDBValidKey>);
  } catch (err) {
    // Persistence is a convenience; generation should still succeed without it.
    console.warn('Could not save mascot locally:', err);
  }
}

/** All saved mascots, newest first. */
export async function listMascots(): Promise<StoredMascot[]> {
  try {
    const all = await tx<StoredMascot[]>('readonly', (s) => s.getAll() as IDBRequest<StoredMascot[]>);
    return (all ?? []).sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    console.warn('Could not read saved mascots:', err);
    return [];
  }
}

/** The most recently generated mascot, or null if there is none. */
export async function loadMostRecent(): Promise<StoredMascot | null> {
  const all = await listMascots();
  return all[0] ?? null;
}

export async function deleteMascot(id: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>);
  } catch (err) {
    console.warn('Could not delete mascot:', err);
  }
}
