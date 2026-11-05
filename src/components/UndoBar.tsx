import { useEffect, useState } from 'react';
import { historyState, redo, subscribeHistory, undo } from '../lib/history';
import { IRedo, IUndo } from './Icons';
import { useUI } from './ui';
import { t } from '../i18n';

/** زرّا التراجع والإعادة الثابتان */
export function UndoBar() {
  const ui = useUI();
  const [h, setH] = useState(historyState());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const un = subscribeHistory(() => setH(historyState()));
    return () => {
      un();
    };
  }, []);
  const run = async (dir: 'undo' | 'redo') => {
    if (busy) return;
    setBusy(true);
    try {
      const r = dir === 'undo' ? await undo() : await redo();
      if (r) ui.toast(t(dir === 'undo' ? 'undone' : 'redone', { label: r.label }) + (r.skipped ? t('undo_skipped', { n: r.skipped }) : ''), !!r.skipped);
    } catch (e) {
      ui.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="undobar">
      <button disabled={!h.undo || busy} onClick={() => run('undo')} aria-label={t('undo')} title={h.undo ?? ''}>
        <IUndo className="flip-rtl" />
      </button>
      <button disabled={!h.redo || busy} onClick={() => run('redo')} aria-label={t('redo')} title={h.redo ?? ''}>
        <IRedo className="flip-rtl" />
      </button>
    </div>
  );
}
