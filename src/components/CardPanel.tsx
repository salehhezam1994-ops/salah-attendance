import { useEffect, useState } from 'react';
import { ICard, IClose } from './Icons';
import { beep, type ScanResult } from './QrScanner';
import { NfcReader, useNfcReader, useNfcStatus } from '../lib/nfc';
import { normCard, useCardKeyboard } from '../lib/card';
import { t } from '../i18n';

/** يستقبل أرقام البطاقات من قارئ USB أو NFC الهاتف أو الكتابة اليدوية */
export function useCardSource(active: boolean, onCard: (card: string) => void) {
  const nfc = useNfcStatus();
  useCardKeyboard(active, (c) => onCard(normCard(c)));
  const nfcErr = useNfcReader(active && !!nfc?.supported, (id) => onCard(normCard(id)));
  return { nfc, nfcErr };
}

export function ManualCard({ onSubmit }: { onSubmit: (card: string) => void }) {
  const [v, setV] = useState('');
  return (
    <form
      className="row"
      style={{ gap: 6 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSubmit(normCard(v));
        setV('');
      }}
    >
      <input dir="ltr" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} placeholder={t('card_manual_ph')} style={{ textAlign: 'center' }} />
      <button className="btn" type="submit" disabled={!v.trim()}>
        {t('ok')}
      </button>
    </form>
  );
}

/** شاشة التحضير بالبطاقات */
export function CardPanel({ title, onCard, onClose, footer }: { title: string; onCard: (card: string) => Promise<ScanResult>; onClose: () => void; footer?: React.ReactNode }) {
  const [last, setLast] = useState<ScanResult | null>(null);
  const [recent, setRecent] = useState<ScanResult[]>([]);
  const handle = async (card: string) => {
    if (!card) return;
    const r = await onCard(card);
    beep(r.kind === 'ok');
    navigator.vibrate?.(r.kind === 'ok' ? 40 : [60, 60, 60]);
    setLast(r);
    if (r.kind === 'ok') setRecent((a) => [r, ...a].slice(0, 6));
  };
  const { nfc, nfcErr } = useCardSource(true, handle);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay scanner">
      <div className="scan-top">
        <button className="ib" onClick={onClose} aria-label={t('close')}>
          <IClose />
        </button>
        <b className="grow">{title}</b>
      </div>
      <div className="scan-view nfc-view">
        <ICard className="nfc-ico pulse" />
        <p>{t('card_hint')}</p>
        {nfc?.supported && nfcErr === 'DISABLED' && (
          <button className="btn light sm" onClick={() => NfcReader.openSettings()}>
            {t('nfc_open_settings')}
          </button>
        )}
        <div style={{ width: '100%', maxWidth: 320 }}>
          <ManualCard onSubmit={handle} />
        </div>
      </div>
      <div className={'scan-res ' + (last?.kind ?? 'idle')}>
        {last ? (
          <>
            <b>{last.title}</b>
            {last.sub && <span>{last.sub}</span>}
          </>
        ) : (
          <span>{t('nfc_waiting')}</span>
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
