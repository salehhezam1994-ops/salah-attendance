import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, put } from './api';
import { makeT, type Locale, type T } from './i18n';

export type Prefs = {
  locale: Locale;
  detail: 'brief' | 'medium' | 'detailed';
  documentation: 'standard' | 'strict';
  voice: { rate: number; autoRead: boolean; voiceName: string | null };
  notify: { enabled: boolean; dailyTime: string; reviews: boolean; comeback: boolean; updates: boolean; quietStart: string; quietEnd: string };
  timezone: string;
  savedCommands: string[];
  advanced: boolean;
  interests: string[];
  avoid: string[];
  preferredSources: string[];
  theme: 'system' | 'light' | 'dark';
};
export type JourneyLite = { id: string; title: string | null; topic: string; status: string; last_active_at: string | null; progress: number | null };
export type Me = {
  user: { id: string; email: string | null; name: string | null; is_guest: number; admin: boolean };
  prefs: Prefs;
  subscription: any;
  plans: any;
  ai: 'anthropic' | 'demo' | 'off';
  journeys: JourneyLite[];
};

type Ctx = {
  me: Me | null;
  loading: boolean;
  t: T;
  locale: Locale;
  setLocale: (l: Locale) => void;
  refresh: () => Promise<void>;
  savePrefs: (p: Partial<Prefs>) => Promise<void>;
};
const AppCtx = createContext<Ctx>(null as unknown as Ctx);

const storedLocale = (): Locale => {
  try {
    const l = localStorage.getItem('manara.locale');
    if (l === 'ar' || l === 'en') return l;
  } catch {
    /* ignore */
  }
  return navigator.language?.startsWith('ar') || !navigator.language ? 'ar' : 'en';
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [locale, setLocaleState] = useState<Locale>(storedLocale);

  const refresh = useCallback(async () => {
    try {
      const m = await api<Me>('/me');
      setMe(m);
      setLocaleState(m.prefs.locale);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.title = locale === 'ar' ? 'منارة المعرفة' : 'Manara';
    try {
      localStorage.setItem('manara.locale', locale);
    } catch {
      /* ignore */
    }
  }, [locale]);

  // Keep the device time zone on the server so pushes arrive at the learner's local time.
  useEffect(() => {
    if (!me) return;
    let tz = 'UTC';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      /* ignore */
    }
    if (me.prefs.timezone !== tz) void put('/prefs', { timezone: tz }).catch(() => undefined);
  }, [me]);

  useEffect(() => {
    const th = me?.prefs.theme ?? 'system';
    if (th === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', th);
  }, [me?.prefs.theme]);

  const savePrefs = useCallback(async (p: Partial<Prefs>) => {
    const next = await put<Prefs>('/prefs', p);
    setMe((m) => (m ? { ...m, prefs: next } : m));
    if (p.locale) setLocaleState(p.locale);
  }, []);

  const setLocale = useCallback(
    (l: Locale) => {
      setLocaleState(l);
      if (me) void savePrefs({ locale: l });
    },
    [me, savePrefs],
  );

  const value = useMemo(() => ({ me, loading, t: makeT(locale), locale, setLocale, refresh, savePrefs }), [me, loading, locale, setLocale, refresh, savePrefs]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export const useApp = () => useContext(AppCtx);

/** Small data-loading hook with error + reload. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fn());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'default');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}
