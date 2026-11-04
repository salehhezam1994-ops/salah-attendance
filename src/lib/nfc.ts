import { useEffect, useRef, useState } from 'react';
import { registerPlugin, WebPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NfcStatus {
  supported: boolean;
  enabled: boolean;
}
interface NfcReaderPlugin {
  status(): Promise<NfcStatus>;
  start(): Promise<void>;
  stop(): Promise<void>;
  openSettings(): Promise<void>;
  addListener(ev: 'tag', fn: (d: { id: string }) => void): Promise<PluginListenerHandle>;
}

/** على الويب لا يوجد NFC؛ للاختبار فقط: window.__nfcSim = true ثم window.__nfcEmit('UID') */
class NfcWeb extends WebPlugin {
  constructor() {
    super();
    (window as unknown as { __nfcEmit: (id: string) => void }).__nfcEmit = (id: string) => this.notifyListeners('tag', { id });
  }
  async status(): Promise<NfcStatus> {
    const sim = !!(window as unknown as { __nfcSim?: boolean }).__nfcSim;
    return { supported: sim, enabled: sim };
  }
  async start() {}
  async stop() {}
  async openSettings() {}
}

export const NfcReader = registerPlugin<NfcReaderPlugin>('NfcReader', { web: () => new NfcWeb() });

/** بطاقات تعطي رقمًا عشوائيًا في كل مرة (مثل بطاقات الهوية) لا تصلح للربط */
export const isRandomUid = (id: string) => id.length === 8 && id.startsWith('08');

export function useNfcStatus() {
  const [s, setS] = useState<NfcStatus | null>(null);
  useEffect(() => {
    const check = () => NfcReader.status().then(setS, () => setS({ supported: false, enabled: false }));
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, []);
  return s;
}

/** يقرأ البطاقات ما دام active=true؛ يرجع خطأ التشغيل إن وُجد */
export function useNfcReader(active: boolean, onTag: (id: string) => void) {
  const cb = useRef(onTag);
  cb.current = onTag;
  const [error, setError] = useState<'' | 'UNSUPPORTED' | 'DISABLED' | 'OTHER'>('');
  useEffect(() => {
    if (!active) return;
    let h: PluginListenerHandle | null = null;
    let stopped = false;
    const last = { id: '', at: 0 };
    (async () => {
      h = await NfcReader.addListener('tag', ({ id }) => {
        const now = Date.now();
        if (id === last.id && now - last.at < 2500) return; // نفس البطاقة ما زالت ملامسة
        last.id = id;
        last.at = now;
        cb.current(id);
      });
      if (stopped) return h.remove();
      try {
        await NfcReader.start();
        setError('');
      } catch (e) {
        const code = (e as { code?: string }).code;
        setError(code === 'DISABLED' ? 'DISABLED' : code === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'OTHER');
      }
    })();
    return () => {
      stopped = true;
      h?.remove();
      NfcReader.stop().catch(() => {});
    };
  }, [active]);
  return error;
}
