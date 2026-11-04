import { useEffect, useRef } from 'react';

/**
 * توحيد رقم البطاقة حتى تتطابق القراءات المختلفة لنفس البطاقة:
 * - "0012603122" و "12603122" ← "12603122"
 * - صيغة Wiegand "192,20210" (منشأة،رقم) ← 192*65536+20210 = "12603122"
 * - أرقام NFC السداسية عشرية ← أحرف كبيرة دون فواصل
 */
export function normCard(raw: string): string {
  const v = raw.trim().toUpperCase();
  const w = v.match(/^(\d{1,3})\s*[,.:/]\s*(\d{1,5})$/);
  if (w) return String(Number(w[1]) * 65536 + Number(w[2]));
  const c = v.replace(/[^0-9A-F]/g, '');
  if (/^\d+$/.test(c)) return c.replace(/^0+(?=\d)/, '');
  return c;
}

/**
 * قارئ البطاقات USB يعمل كلوحة مفاتيح: يكتب الرقم بسرعة ثم Enter.
 * نلتقط ذلك على مستوى الصفحة (خارج حقول الإدخال).
 */
export function useCardKeyboard(active: boolean, onCode: (code: string) => void) {
  const cb = useRef(onCode);
  cb.current = onCode;
  useEffect(() => {
    if (!active) return;
    let buf = '';
    let lastAt = 0;
    const h = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA') && !tgt.dataset.cardSink) return;
      const now = Date.now();
      if (now - lastAt > 400) buf = '';
      lastAt = now;
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (buf.length >= 4) {
          e.preventDefault();
          cb.current(buf);
        }
        buf = '';
      } else if (e.key.length === 1 && /[0-9A-Za-z,]/.test(e.key)) {
        buf += e.key;
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [active]);
}
