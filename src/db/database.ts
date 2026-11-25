// ============================================================
// IndexedDB 数据层：bows / arrows / sessions / photos / kv
// 弓箭档案与调试记录都持久化在这里；首次启动写入演示数据。
// ============================================================

import type { AppSettings, ArrowProfile, BowProfile, PhotoRecord, TuneSession } from '../core/types';
import { SEED_ARROWS, SEED_BOWS } from '../core/sampleData';
import { buildDemoSession } from '../core/seedSession';

const DB_NAME = 'bow-paper-tune-lab';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('bows')) db.createObjectStore('bows', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('arrows')) db.createObjectStore('arrows', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const idb = {
  async all<T>(store: string): Promise<T[]> {
    return tx(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
  },
  async get<T>(store: string, id: string): Promise<T | undefined> {
    return tx(store, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>);
  },
  async put<T>(store: string, value: T): Promise<IDBValidKey> {
    return tx(store, 'readwrite', (s) => s.put(value as object));
  },
  async del(store: string, id: string): Promise<void> {
    await tx(store, 'readwrite', (s) => s.delete(id));
  },
  async clear(store: string): Promise<void> {
    await tx(store, 'readwrite', (s) => s.clear());
  },
  async kvGet<T>(key: string): Promise<T | undefined> {
    const row = await tx<{ key: string; value: T } | undefined>('kv', 'readonly', (s) =>
      s.get(key) as IDBRequest<{ key: string; value: T } | undefined>,
    );
    return row?.value;
  },
  async kvPut<T>(key: string, value: T): Promise<void> {
    await tx('kv', 'readwrite', (s) => s.put({ key, value }));
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  handedness: 'RH',
  paperDistanceM: 2,
  cameraFps: 1000,
  exposureMs: 0.5,
  slowMo: 1000,
  showTrails: true,
  showTopSide: true,
  reducedMotion: false,
};

type ChangeKind = 'bows' | 'arrows' | 'sessions' | 'photos' | 'settings';
const listeners = new Set<(k: ChangeKind) => void>();
export function onDbChange(fn: (k: ChangeKind) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emitChange(k: ChangeKind): void {
  listeners.forEach((fn) => fn(k));
}

export async function getSettings(): Promise<AppSettings> {
  const s = await idb.kvGet<AppSettings>('settings');
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}
export async function saveSettings(s: AppSettings): Promise<void> {
  await idb.kvPut('settings', s);
  emitChange('settings');
}

export async function ensureSeeded(): Promise<void> {
  const seeded = await idb.kvGet<boolean>('seeded-v3');
  if (seeded) return;
  for (const b of SEED_BOWS) await idb.put<BowProfile>('bows', b);
  for (const a of SEED_ARROWS) await idb.put<ArrowProfile>('arrows', a);
  await idb.put<TuneSession>('sessions', buildDemoSession());
  await idb.kvPut('settings', DEFAULT_SETTINGS);
  // 合成照片依赖 canvas，浏览器环境生成
  try {
    const { generateSamplePhotos } = await import('../core/samplePhotos');
    for (const p of generateSamplePhotos()) await idb.put<PhotoRecord>('photos', p);
  } catch (e) {
    console.warn('sample photos generation skipped', e);
  }
  await idb.kvPut('seeded-v3', true);
}

export async function resetAllData(): Promise<void> {
  for (const s of ['bows', 'arrows', 'sessions', 'photos', 'kv']) await idb.clear(s);
  await ensureSeeded();
}
