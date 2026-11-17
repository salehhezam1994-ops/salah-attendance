import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { PRAYERS, activitySlot, type Slot } from '../db/schema';
import { countSlot, moveSlotRecords } from '../db/repo';
import { slotName, useActivities } from '../lib/slots';
import { addDays, fmtDate, todayISO } from '../lib/dates';
import { historyGroup } from '../lib/history';
import { useUI } from './ui';
import { t } from '../i18n';

/** أداة المسؤول: نقل سجلات صلاة من تاريخ خاطئ إلى التاريخ الصحيح */
export function MoveRecordsCard() {
  const ui = useUI();
  const acts = useActivities();
  const slots: Slot[] = [...PRAYERS, ...(acts ?? []).map((a) => activitySlot(a.id))];
  const [fromDate, setFromDate] = useState(addDays(todayISO(), -1));
  const [fromSlot, setFromSlot] = useState<Slot>('dhuhr');
  const [toDate, setToDate] = useState(todayISO());
  const [toSlot, setToSlot] = useState<Slot>('dhuhr');
  const [busy, setBusy] = useState(false);
  const nFrom = useLiveQuery(() => countSlot(fromDate, fromSlot), [fromDate, fromSlot]) ?? 0;
  const nTo = useLiveQuery(() => countSlot(toDate, toSlot), [toDate, toSlot]) ?? 0;
  const same = fromDate === toDate && fromSlot === toSlot;

  const pick = (v: Slot, set: (s: Slot) => void) => (
    <select value={v} onChange={(e) => set(e.target.value)}>
      {slots.map((s) => (
        <option key={s} value={s}>
          {slotName(s)}
        </option>
      ))}
    </select>
  );

  const run = async () => {
    if (!nFrom || same) return;
    const from = `${slotName(fromSlot)} — ${fmtDate(fromDate)}`;
    const to = `${slotName(toSlot)} — ${fmtDate(toDate)}`;
    if (!(await ui.confirm(t('move_confirm', { n: nFrom, from, to }), { ok: t('move_btn') }))) return;
    let overwrite = false;
    if (nTo > 0) overwrite = await ui.confirm(t('move_overwrite_q', { n: nTo }), { ok: t('move_overwrite'), danger: true });
    setBusy(true);
    try {
      const r = await historyGroup(() => moveSlotRecords(fromDate, fromSlot, toDate, toSlot, overwrite));
      ui.toast(r.kept ? t('move_done_kept', { n: r.moved, k: r.kept }) : t('move_done', { n: r.moved }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>{t('move_title')}</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('move_hint')}
      </p>
      <label className="f">{t('move_from')}</label>
      <div className="row">
        <input type="date" value={fromDate} onChange={(e) => e.target.value && setFromDate(e.target.value)} />
        {pick(fromSlot, setFromSlot)}
      </div>
      <div className="small muted">{t('move_count', { n: nFrom })}</div>
      <label className="f">{t('move_to')}</label>
      <div className="row">
        <input type="date" value={toDate} onChange={(e) => e.target.value && setToDate(e.target.value)} />
        {pick(toSlot, setToSlot)}
      </div>
      <div className="small muted">{t('move_count', { n: nTo })}</div>
      <div className="acts">
        <button className="btn" disabled={busy || !nFrom || same} onClick={run}>
          {t('move_btn')}
        </button>
      </div>
    </div>
  );
}
