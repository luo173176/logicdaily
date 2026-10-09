'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { getDatabase } from '@/lib/db/database';
import { LocalStore, type DataStore } from '@/lib/db/store';
import { defaultSettings, migrateSettings, type AppSettings } from '@/lib/domain/settings';
import { detectTimeZone, todayKey } from '@/lib/domain/time';


export const GUEST_PROFILE = 'local';

interface AppContextValue {
  ready: boolean;
  /** 浏览器环境不可用（隐私模式、旧浏览器）时为 false，界面需要给出说明。 */
  storageOk: boolean;
  store: DataStore | null;
  profileId: string;
  settings: AppSettings;
  saveSettings: (next: AppSettings) => Promise<void>;
  dateKey: string;
  nowTs: number;
  timezone: string;
  seeding: { status: 'idle' | 'running' | 'done' | 'failed'; message: string };
  reseedContent: () => Promise<void>;
  toast: string | null;
  notify: (message: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp 必须在 AppProviders 内使用');
  return value;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [storageOk, setStorageOk] = useState(true);
  const [store, setStore] = useState<DataStore | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => defaultSettings(GUEST_PROFILE));
  const [dateKey, setDateKey] = useState('1970-01-01');
  const [nowTs, setNowTs] = useState(0);
  const [timezone, setTimezone] = useState('UTC');
  const [seeding, setSeeding] = useState<AppContextValue['seeding']>({
    status: 'idle',
    message: '',
  });
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const seedContent = useCallback(async (target: DataStore) => {
    setSeeding({ status: 'running', message: '正在载入题库…' });
    try {
      const count = await target.countExercises();
      if (count > 0) {
        const { buildExercisePacks } = await import('@/lib/content/packs');
        const exercises = buildExercisePacks().flatMap((pack: { exercises: import('@/lib/domain/exercise-schema').Exercise[] }) => pack.exercises);
        const current = await target.listExercises();
        // 内容包版本变化或题量变化时重新播种，其余情况直接使用本地缓存。
        const needsReseed =
          current.length !== exercises.length ||
          current.some((e) => !exercises.some((next) => next.id === e.id && next.version === e.version));
        if (!needsReseed) {
          setSeeding({ status: 'done', message: `本地题库已就绪（${current.length} 题）` });
          return;
        }
      }
      const { buildExercisePacks, EXERCISE_CONTENT_TAG } = await import('@/lib/content/packs');
      const exercises = buildExercisePacks().flatMap((pack: { exercises: import('@/lib/domain/exercise-schema').Exercise[] }) => pack.exercises);
      const result = await target.seedExercises(exercises, EXERCISE_CONTENT_TAG);
      setSeeding({
        status: 'done',
        message: `题库已载入：新增 ${result.inserted}，更新 ${result.updated}，移除 ${result.removed}`,
      });
    } catch (error) {
      setSeeding({
        status: 'failed',
        message: error instanceof Error ? error.message : '题库载入失败，可在“我的”里重试。',
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (typeof indexedDB === 'undefined') throw new Error('no-indexeddb');
        const db = getDatabase();
        await db.open();
        const local = new LocalStore(db);
        const stored = await local.getSettings(GUEST_PROFILE);
        const tz = detectTimeZone();
        const nextSettings = stored
          ? migrateSettings(stored)
          : { ...defaultSettings(GUEST_PROFILE), timezone: tz };
        if (!stored) await local.saveSettings(nextSettings);
        if (cancelled) return;
        setStore(local);
        setSettings(nextSettings);
        setTimezone(nextSettings.timezone || tz);
        setDateKey(todayKey(new Date(), nextSettings.timezone || tz));
        setNowTs(Date.now());
        // 先完成题库播种再置 ready，避免页面在空题库上生成“今日计划”。
        await seedContent(local);
        if (cancelled) return;
        setReady(true);
      } catch (error) {
        if (cancelled) return;
        setStorageOk(false);
        setSeeding({
          status: 'failed',
          message:
            error instanceof Error && error.message === 'no-indexeddb'
              ? '当前浏览器禁用了本地存储（可能是隐私模式），无法保存训练数据。'
              : '本地数据库打不开，请检查浏览器存储权限。',
        });
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seedContent]);

  // 跨过午夜时刷新“今天”，不必依赖服务端时间。
  useEffect(() => {
    if (!ready) return;
    const check = setInterval(() => {
      const key = todayKey(new Date(), timezone);
      setDateKey((prev) => (prev === key ? prev : key));
      setNowTs(Date.now());
    }, 60_000);
    return () => clearInterval(check);
  }, [ready, timezone]);

  const saveSettings = useCallback(
    async (next: AppSettings) => {
      setSettings(next);
      if (store) {
        await store.saveSettings(next);
      }
      setDateKey(todayKey(new Date(), next.timezone));
    },
    [store],
  );

  const reseedContent = useCallback(async () => {
    if (store) await seedContent(store);
  }, [seedContent, store]);

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      storageOk,
      store,
      profileId: GUEST_PROFILE,
      settings,
      saveSettings,
      dateKey,
      nowTs,
      timezone,
      seeding,
      reseedContent,
      toast,
      notify,
    }),
    [ready, storageOk, store, settings, saveSettings, dateKey, nowTs, timezone, seeding, reseedContent, toast, notify],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
        {toast ? (
          <p className="card max-w-[420px] text-sm" role="status">
            {toast}
          </p>
        ) : null}
      </div>
    </AppContext.Provider>
  );
}
