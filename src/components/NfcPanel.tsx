import { useEffect, useState } from 'react';
import { IClose, INfc } from './Icons';
import { beep, type ScanResult } from './QrScanner';
import { NfcReader, useNfcReader } from '../lib/nfc';
import { t } from '../i18n';

/** شاشة التحضير بلمس بطاقات NFC */
export function NfcPanel({ title, onTag, onClose, footer }: { title: string; onTag: (id: string) => Promise<ScanResult>; onClose: () => void; footer?: React.ReactNode }) {
  const [last, setLast] = useState<ScanResult | null>(null);
  const [recent, setRecent] = useState<ScanResult[]>([]);
  const err = useNfcReader(true, async (id) => {
    const r = await onTag(id);
    beep(r.kind === 'ok');
    navigator.vibrate?.(r.kind === 'ok' ? 40 : [60, 60, 60]);
    setLast(r);
    if (r.kind === 'ok') setRecent((a) => [r, ...a].slice(0, 6));
  });
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
        <INfc className={'nfc-ico' + (err ? '' : ' pulse')} />
        <p>{err === 'DISABLED' ? t('nfc_disabled') : err ? t('nfc_unsupported') : t('nfc_hint')}</p>
        {err === 'DISABLED' && (
          <button className="btn light" onClick={() => NfcReader.openSettings()}>
            {t('nfc_open_settings')}
          </button>
        )}
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
