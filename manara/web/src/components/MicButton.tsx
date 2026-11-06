import { useState } from 'react';
import { useApp } from '../state';
import { useDictation } from '../voice';
import { IMic } from './Icons';

/** Microphone button: dictates into a text field (with user permission prompted by the browser). */
export function MicButton({ onText, onFinal }: { onText?: (t: string) => void; onFinal?: (t: string) => void }) {
  const { t, locale } = useApp();
  const [warn, setWarn] = useState(false);
  const d = useDictation(locale, (text) => (onFinal ?? onText)?.(text));
  return (
    <span style={{ position: 'relative' }}>
      <button
        type="button"
        className={`icon-btn${d.listening ? ' active' : ''}`}
        aria-label={d.listening ? t('listening') : 'mic'}
        aria-pressed={d.listening}
        onClick={() => {
          if (d.listening) return d.stop();
          if (!d.start()) {
            setWarn(true);
            setTimeout(() => setWarn(false), 4000);
          }
        }}
      >
        <IMic />
      </button>
      {(warn || d.interim) && (
        <span className="bubble" style={{ position: 'absolute', bottom: 52, insetInlineEnd: 0, width: 240, fontSize: '.85rem', zIndex: 5 }}>
          {warn ? t('mic_unsupported') : d.interim}
        </span>
      )}
    </span>
  );
}
