import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { tr } from './tr';
import { ar } from './ar';

export type Lang = 'tr' | 'ar';
export type Key = keyof typeof tr;
const DICTS: Record<Lang, Record<Key, string>> = { tr, ar };
const KEY = 'salah.lang';

function initialLang(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'tr' || v === 'ar') return v;
  } catch {
    /* ignore */
  }
  return 'tr';
}

let current: Lang = initialLang();
applyDom(current);

function applyDom(l: Lang) {
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
}

export const getLang = () => current;
export const isRTL = () => current === 'ar';
export const locale = () => (current === 'ar' ? 'ar' : 'tr-TR');

/** ترجمة نص مع متغيرات {name} */
export function t(key: Key, vars?: Record<string, string | number>): string {
  let s = DICTS[current][key] ?? tr[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: current, setLang: () => {} });
export const useLang = () => useContext(LangCtx);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setL] = useState<Lang>(current);
  useEffect(() => applyDom(lang), [lang]);
  const setLang = (l: Lang) => {
    current = l;
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
    applyDom(l);
    setL(l);
  };
  // key يعيد رسم الواجهة كاملة عند تغيير اللغة
  return (
    <LangCtx.Provider value={{ lang, setLang }}>
      <div key={lang} style={{ display: 'contents' }}>
        {children}
      </div>
    </LangCtx.Provider>
  );
}

export function LangSwitch({ compact }: { compact?: boolean }) {
  const { lang, setLang } = useLang();
  return (
    <div className="tabs" style={compact ? { margin: 0, boxShadow: 'none' } : undefined}>
      <button className={lang === 'tr' ? 'on' : ''} onClick={() => setLang('tr')}>
        Türkçe
      </button>
      <button className={lang === 'ar' ? 'on' : ''} onClick={() => setLang('ar')}>
        العربية
      </button>
    </div>
  );
}
