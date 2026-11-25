// 全局内存 store：启动时从 IndexedDB 读全量，写操作走 idb 后本地刷新。
import type { AppSettings, ArrowProfile, BowProfile, PhotoRecord, TuneSession } from '../core/types';
import { DEFAULT_SETTINGS, getSettings, idb } from '../db/database';

const SEL_KEY = 'bowtune-selection-v1';

interface Selection {
  bowId?: string;
  arrowId?: string;
  sessionId?: string;
}

class Store {
  bows: BowProfile[] = [];
  arrows: ArrowProfile[] = [];
  sessions: TuneSession[] = [];
  photos: PhotoRecord[] = [];
  settings: AppSettings = DEFAULT_SETTINGS;
  selection: Selection = {};
  ready = false;

  async init(): Promise<void> {
    const [bows, arrows, sessions, photos, settings] = await Promise.all([
      idb.all<BowProfile>('bows'),
      idb.all<ArrowProfile>('arrows'),
      idb.all<TuneSession>('sessions'),
      idb.all<PhotoRecord>('photos'),
      getSettings(),
    ]);
    this.bows = bows.sort((a, b) => a.createdAt - b.createdAt);
    this.arrows = arrows.sort((a, b) => a.createdAt - b.createdAt);
    this.sessions = sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    this.photos = photos.sort((a, b) => a.createdAt - b.createdAt);
    this.settings = settings;
    try {
      this.selection = JSON.parse(localStorage.getItem(SEL_KEY) ?? '{}');
    } catch {
      this.selection = {};
    }
    if (!this.selection.bowId || !this.bows.some((b) => b.id === this.selection.bowId))
      this.selection.bowId = this.bows[0]?.id;
    if (!this.selection.arrowId || !this.arrows.some((a) => a.id === this.selection.arrowId))
      this.selection.arrowId = this.arrows[0]?.id;
    if (!this.selection.sessionId || !this.sessions.some((s) => s.id === this.selection.sessionId))
      this.selection.sessionId = this.sessions[0]?.id;
    this.ready = true;
  }

  persistSelection(): void {
    localStorage.setItem(SEL_KEY, JSON.stringify(this.selection));
  }

  get bow(): BowProfile | undefined {
    return this.bows.find((b) => b.id === this.selection.bowId) ?? this.bows[0];
  }
  get arrow(): ArrowProfile | undefined {
    return this.arrows.find((a) => a.id === this.selection.arrowId) ?? this.arrows[0];
  }
  get session(): TuneSession | undefined {
    return this.sessions.find((s) => s.id === this.selection.sessionId) ?? this.sessions[0];
  }

  async reloadAll(): Promise<void> {
    await this.init();
  }
  async reloadBows(): Promise<void> {
    this.bows = (await idb.all<BowProfile>('bows')).sort((a, b) => a.createdAt - b.createdAt);
  }
  async reloadArrows(): Promise<void> {
    this.arrows = (await idb.all<ArrowProfile>('arrows')).sort((a, b) => a.createdAt - b.createdAt);
  }
  async reloadSessions(): Promise<void> {
    this.sessions = (await idb.all<TuneSession>('sessions')).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async reloadPhotos(): Promise<void> {
    this.photos = (await idb.all<PhotoRecord>('photos')).sort((a, b) => a.createdAt - b.createdAt);
  }
}

export const store = new Store();
