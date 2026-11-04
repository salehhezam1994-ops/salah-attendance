import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Student } from '../db/schema';
import { Sheet, useUI } from './ui';
import { beep } from './QrScanner';
import { ManualCard, useCardSource } from './CardPanel';
import { isRandomUid } from '../lib/nfc';
import { t } from '../i18n';

/** ربط بطاقات الطلاب واحدًا تلو الآخر: يُعرض اسم الطالب ثم تُمرَّر بطاقته */
export function CardPairSheet({ students, onClose }: { students: Student[]; onClose: () => void }) {
  const ui = useUI();
  const ids = students.map((s) => s.id);
  const live = useLiveQuery(() => db.students.bulkGet(ids), [ids.join()]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const list = (live ?? []).filter(Boolean) as Student[];
  const cur = list.find((s) => s.id === pick) ?? list.find((s) => !s.card && !skipped.has(s.id));
  const done = list.filter((s) => s.card).length;

  const assign = async (card: string) => {
    if (!cur || !card) return;
    if (isRandomUid(card)) {
      beep(false);
      return setMsg({ ok: false, text: t('nfc_random') });
    }
    const owner = await db.students.where('card').equals(card).first();
    if (owner && owner.id !== cur.id) {
      beep(false);
      if (!(await ui.confirm(t('card_used', { name: owner.name }), { ok: t('card_move_here') }))) return;
      await db.students.update(owner.id, { card: undefined });
    }
    await db.students.update(cur.id, { card });
    beep(true);
    navigator.vibrate?.(40);
    setMsg({ ok: true, text: t('card_paired', { name: cur.name }) });
    setPick(null);
  };
  useCardSource(true, assign);

  return (
    <Sheet onClose={onClose}>
      <h2>{t('card_pair')}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('card_pair_hint')}
      </p>
      <div className="row" style={{ marginBottom: 8 }}>
        <b className="grow">{t('card_pair_progress', { n: done, m: list.length })}</b>
      </div>
      {cur ? (
        <div className="card" style={{ background: 'var(--brand-soft)', boxShadow: 'none', textAlign: 'center' }}>
          <div className="small muted">{t('card_now')}</div>
          <b style={{ fontSize: 22 }}>
            {cur.serial}. {cur.name}
          </b>
          {cur.card && <div className="small muted">{t('card_has', { card: cur.card })}</div>}
          <div className="sp" />
          <ManualCard onSubmit={assign} />
          <div className="sp" />
          <button className="btn sm ghost" onClick={() => (setSkipped(new Set(skipped).add(cur.id)), setPick(null), setMsg(null))}>
            {t('skip')}
          </button>
        </div>
      ) : (
        <p className="center">{t('card_all_paired')}</p>
      )}
      {msg && (
        <p className={'pill ' + (msg.ok ? 'ok' : 'bad')} style={{ display: 'block', textAlign: 'center' }}>
          {msg.text}
        </p>
      )}
      <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 8 }}>
        {list.map((s) => (
          <button key={s.id} className="list-item" style={{ width: '100%' }} onClick={() => (setPick(s.id), setMsg(null))}>
            <span className={'avatar' + (s.card ? '' : ' bad')}>{s.card ? '✓' : s.serial}</span>
            <span className="grow" style={{ textAlign: 'start', fontWeight: s.id === cur?.id ? 700 : 400 }}>
              {s.name}
            </span>
            <span className="small muted" dir="ltr">
              {s.card ?? ''}
            </span>
          </button>
        ))}
      </div>
      <div className="acts">
        <button className="btn" onClick={onClose}>
          {t('done')}
        </button>
      </div>
    </Sheet>
  );
}
