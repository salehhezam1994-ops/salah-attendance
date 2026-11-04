import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { IClose, ICamSwitch } from './Icons';
import { t } from '../i18n';

export type ScanResult = { kind: 'ok' | 'dup' | 'bad'; title: string; sub?: string };

let audio: AudioContext | null = null;
function beep(ok: boolean) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = ok ? 1046 : 220;
    o.type = ok ? 'sine' : 'square';
    g.gain.setValueAtTime(0.25, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + (ok ? 0.18 : 0.35));
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.4);
  } catch {
    /* لا صوت */
  }
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/** ماسح QR بملء الشاشة: يقرأ البطاقات تباعًا ويعرض نتيجة كل بطاقة */
export function QrScanner({ title, onCode, onClose, footer }: { title: string; onCode: (text: string) => Promise<ScanResult>; onClose: () => void; footer?: React.ReactNode }) {
  const video = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [err, setErr] = useState('');
  const [last, setLast] = useState<ScanResult | null>(null);
  const [recent, setRecent] = useState<ScanResult[]>([]);
  const busy = useRef(false);
  const seen = useRef(new Map<string, number>());
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    let timer = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const BD = (window as unknown as { BarcodeDetector?: new (o: object) => Detector }).BarcodeDetector;
    let detector: Detector | null = null;
    try {
      detector = BD ? new BD({ formats: ['qr_code'] }) : null;
    } catch {
      detector = null;
    }

    const handle = async (text: string) => {
      const now = Date.now();
      if ((seen.current.get(text) ?? 0) > now - 3000) return;
      seen.current.set(text, now);
      busy.current = true;
      try {
        const r = await cb.current(text);
        beep(r.kind === 'ok');
        navigator.vibrate?.(r.kind === 'ok' ? 40 : [60, 60, 60]);
        setLast(r);
        if (r.kind === 'ok') setRecent((a) => [r, ...a].slice(0, 6));
      } finally {
        busy.current = false;
      }
    };

    const tick = async () => {
      if (stop) return;
      const v = video.current;
      if (v && v.readyState >= 2 && !busy.current) {
        try {
          let text: string | null = null;
          if (detector) {
            const codes = await detector.detect(v);
            text = codes[0]?.rawValue ?? null;
          } else {
            const w = 480;
            const h = Math.round((v.videoHeight / v.videoWidth) * w) || 360;
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(v, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            text = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null;
          }
          if (text) await handle(text);
        } catch {
          detector = null; // نرجع إلى jsQR إن فشل الكاشف المدمج
        }
      }
      timer = window.setTimeout(tick, 120);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (stop) return stream.getTracks().forEach((tr) => tr.stop());
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        setErr('');
        tick();
      } catch (e) {
        setErr(t('cam_error') + ' (' + ((e as Error).name || (e as Error).message) + ')');
      }
    })();
    return () => {
      stop = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [facing]);

  return (
    <div className="overlay scanner">
      <div className="scan-top">
        <button className="ib" onClick={onClose} aria-label={t('close')}>
          <IClose />
        </button>
        <b className="grow">{title}</b>
        <button className="ib" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label={t('switch_cam')}>
          <ICamSwitch />
        </button>
      </div>
      <div className="scan-view">
        <video ref={video} playsInline muted style={{ transform: facing === 'user' ? 'scaleX(-1)' : undefined }} />
        <div className="scan-frame" />
        {err && <div className="scan-err">{err}</div>}
      </div>
      <div className={'scan-res ' + (last?.kind ?? 'idle')}>
        {last ? (
          <>
            <b>{last.title}</b>
            {last.sub && <span>{last.sub}</span>}
          </>
        ) : (
          <span>{t('scan_hint')}</span>
        )}
      </div>
      {recent.length > 0 && (
        <div className="scan-recent">
          {recent.map((r, i) => (
            <span key={i} className="pill ok">
              {r.title}
            </span>
          ))}
        </div>
      )}
      {footer}
    </div>
  );
}
