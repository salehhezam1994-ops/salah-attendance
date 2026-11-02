import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, PRAYERS, isPrayerSlot, type Attendance, type Slot, type Student } from '../db/schema';
import { markAll, clearSession, setNote, setStatus } from '../db/repo';
import { useSel } from '../App';
import { useAuth } from '../auth';
import { DateBar, Empty, SearchBox, Sheet, matchStudent, useUI } from '../components/ui';
import { IAllCheck, ICheck, INote, IReset, ISearch, IUsers, IX } from '../components/Icons';
import { guessPrayer, todayISO } from '../lib/dates';
import { SyncDot } from '../sync/SyncUI';
import { t, type Key } from '../i18n';
import { PRAYER_GROUP, groupName, groupSlots, slotGroup, slotName, useActivities } from '../lib/slots';

const REASONS: Key[] = ['reason_sick', 'reason_travel', 'reason_permission', 'reason_family', 'reason_other_mosque'];

export default function AttendancePage() {
  const { date, slot, classId, set } = useSel();
  const { user, isAdmin, allowedClasses } = useAuth();
  const ui = useUI();
  const [q, setQ] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [noteFor, setNoteFor] = useState<Student | null>(null);
  const acts = useActivities();

  const classes = useLiveQuery(async () => allowedClasses(await db.classes.orderBy('order').toArray()), [user.id]);
  const students = useLiveQuery(() => db.students.where('active').equals(1).toArray(), []);
  const recs = useLiveQuery(() => db.attendance.where('[date+prayer]').equals([date, slot]).toArray(), [date, slot]);
  const dayRecs = useLiveQuery(() => db.attendance.where('date').equals(date).toArray(), [date]);

  const group = slotGroup(slot);
  const slots = groupSlots(group);
  const activeClass = classes?.find((c) => c.id === classId) ?? classes?.[0];
  const recMap = useMemo(() => new Map((recs ?? []).map((r) => [r.studentId, r])), [recs]);

  const byClass = useMemo(() => {
    const m = new Map<string, Student[]>();
    for (const s of students ?? []) {
      const a = m.get(s.classId) ?? [];
      a.push(s);
      m.set(s.classId, a);
    }
    for (const a of m.values()) a.sort((x, y) => x.serial - y.serial);
    return m;
  }, [students]);

  const list = activeClass ? byClass.get(activeClass.id) ?? [] : [];
  const shown = list.filter((s) => matchStudent(q, s.name, s.serial));
  const present = list.filter((s) => recMap.get(s.id)?.status === 'P').length;
  const absent = list.filter((s) => recMap.get(s.id)?.status === 'A').length;
  const unmarked = list.length - present - absent;

  // هل اكتمل تسجيل وقت معين للصف الحالي؟ (نقطة خضراء)
  const slotDone = useMemo(() => {
    const ids = new Set(list.map((s) => s.id));
    const out: Record<string, boolean> = {};
    for (const p of slots) {
      const n = (dayRecs ?? []).filter((r) => r.prayer === p && ids.has(r.studentId)).length;
      out[p] = ids.size > 0 && n >= ids.size;
    }
    return out;
  }, [dayRecs, list, slots]);

  const readOnly = !isAdmin && !user.perms.editPastDays && date !== todayISO();

  if (!classes || !students) return null;

  const toggle = async (s: Student, to?: 'P' | 'A') => {
    if (readOnly) return ui.toast(t('no_perm_past'), true);
    const cur = recMap.get(s.id)?.status;
    const next = to ?? (cur === 'P' ? 'A' : 'P');
    if (navigator.vibrate) navigator.vibrate(12);
    await setStatus(date, slot, s, cur === next && to ? null : next, user.id);
  };

  const allPresent = async () => {
    if (readOnly) return ui.toast(t('no_perm_past'), true);
    if (unmarked > 0) {
      await markAll(date, slot, list, 'P', false, user.id);
      ui.toast(t('toast_marked', { n: unmarked }));
    } else if (absent > 0 && (await ui.confirm(t('confirm_all_present'), { ok: t('ok_all_present') }))) {
      await markAll(date, slot, list, 'P', true, user.id);
    }
  };

  const reset = async () => {
    if (readOnly) return;
    if (await ui.confirm(t('confirm_clear', { slot: slotName(slot), cls: activeClass?.name ?? '' }), { ok: t('clear'), danger: true })) {
      await clearSession(date, slot, list);
    }
  };

  const chooseGroup = (g: string) => set({ slot: g === PRAYER_GROUP ? guessPrayer() : groupSlots(g)[0] });
  const nextClass = classes[classes.findIndex((c) => c.id === activeClass?.id) + 1];
  const hasActs = (acts?.length ?? 0) > 0;

  return (
    <>
      <header className="topbar">
        <h1>{t('att_title')}</h1>
        <SyncDot />
        <button className="ib" onClick={() => (setShowSearch((v) => !v), setQ(''))} aria-label={t('search')}>
          <ISearch />
        </button>
        {list.length > 0 && !readOnly && (
          <button className="ib" onClick={reset} aria-label={t('clear_aria')}>
            <IReset />
          </button>
        )}
      </header>
      <main className="content">
        <DateBar value={date} onChange={(d) => set({ date: d })} />
        <div className="sp" />
        {hasActs && (
          <div className="tabs" style={{ marginBottom: 8 }}>
            {[PRAYER_GROUP, ...acts!.map((a) => a.id)].map((g) => (
              <button key={g} className={group === g ? 'on' : ''} onClick={() => chooseGroup(g)}>
                {groupName(g)}
              </button>
            ))}
          </div>
        )}
        {isPrayerSlot(slot) && (
          <>
            <div className="seg">
              {PRAYERS.map((p) => (
                <button key={p} className={p === slot ? 'on' : ''} onClick={() => set({ slot: p })}>
                  {slotDone[p] && <span className="dot" />}
                  {slotName(p)}
                </button>
              ))}
            </div>
            <div className="sp" />
          </>
        )}
        {classes.length === 0 ? (
          <Empty icon={<IUsers />} text={isAdmin ? t('no_classes_admin') : t('no_classes_sup')}>
            {isAdmin && (
              <Link to="/students" className="btn">
                {t('manage_classes')}
              </Link>
            )}
          </Empty>
        ) : (
          <>
            <div className="chips">
              {classes.map((c) => {
                const ss = byClass.get(c.id) ?? [];
                const n = ss.filter((s) => recMap.has(s.id)).length;
                const done = ss.length > 0 && n >= ss.length;
                return (
                  <button key={c.id} className={'chip' + (c.id === activeClass?.id ? ' on' : '') + (done ? ' done' : '')} onClick={() => set({ classId: c.id })}>
                    {done && '✓ '}
                    {c.name}
                    <span className="badge">
                      {n}/{ss.length}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="stats3">
              <div className="stat ok">
                <b>{present}</b>
                <span>{t('present')}</span>
              </div>
              <div className="stat bad">
                <b>{absent}</b>
                <span>{t('absent')}</span>
              </div>
              <div className="stat un">
                <b>{unmarked}</b>
                <span>{t('unmarked')}</span>
              </div>
            </div>
            <div className="sp" />
            {readOnly && <p className="pill warn">{t('readonly_banner')}</p>}
            {showSearch && (
              <>
                <SearchBox value={q} onChange={setQ} />
                <div className="sp" />
              </>
            )}

            {list.length === 0 ? (
              <Empty icon={<IUsers />} text={t('no_students_class')} />
            ) : (
              <div className="att-list">
                {shown.map((s) => (
                  <Row key={s.id} s={s} r={recMap.get(s.id)} onToggle={toggle} onNote={() => setNoteFor(s)} />
                ))}
              </div>
            )}

            {list.length > 0 && !readOnly && (
              <div className="actionbar">
                {unmarked === 0 && nextClass ? (
                  <button className="btn ok grow" onClick={() => set({ classId: nextClass.id })}>
                    {t('next_class', { name: nextClass.name })}
                  </button>
                ) : (
                  <button className="btn ok grow" onClick={allPresent} disabled={unmarked === 0 && absent === 0}>
                    <IAllCheck /> {unmarked > 0 ? t('mark_rest', { n: unmarked }) : t('mark_all')}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>
      {noteFor && (
        <NoteSheet
          s={noteFor}
          slot={slot}
          r={recMap.get(noteFor.id)}
          onClose={() => setNoteFor(null)}
          onSave={async (note, exc) => {
            await setNote(date, slot, noteFor, note, exc, user.id);
            setNoteFor(null);
            ui.toast(t('note_saved'));
          }}
        />
      )}
    </>
  );
}

function Row({ s, r, onToggle, onNote }: { s: Student; r?: Attendance; onToggle: (s: Student, to?: 'P' | 'A') => void; onNote: () => void }) {
  const st = r?.status;
  return (
    <div className={'att ' + (st ?? '')}>
      <span className="num">{s.serial}</span>
      <div className="nm" onClick={() => onToggle(s)}>
        {s.name}
        {st === 'A' && (r?.note || r?.excused) ? (
          <small className="n">
            {r.excused ? t('excused') : ''}
            {r.note ? (r.excused ? ' — ' : '') + r.note : ''}
          </small>
        ) : null}
      </div>
      {st === 'A' && (
        <button className={'ib note' + (r?.note || r?.excused ? ' has' : '')} onClick={onNote} aria-label={t('note_aria')}>
          <INote />
        </button>
      )}
      <div className="tog">
        <button className={'p' + (st === 'P' ? ' on' : '')} onClick={() => onToggle(s, 'P')} aria-label={t('present')}>
          <ICheck />
        </button>
        <button className={'a' + (st === 'A' ? ' on' : '')} onClick={() => onToggle(s, 'A')} aria-label={t('absent')}>
          <IX />
        </button>
      </div>
    </div>
  );
}

function NoteSheet({ s, slot, r, onClose, onSave }: { s: Student; slot: Slot; r?: Attendance; onClose: () => void; onSave: (note: string, excused: boolean) => void }) {
  const [note, setNoteV] = useState(r?.note ?? '');
  const [exc, setExc] = useState(!!r?.excused);
  const reasons = isPrayerSlot(slot) ? REASONS : REASONS.slice(0, 4);
  return (
    <Sheet onClose={onClose}>
      <h2>{t('note_title')}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {s.name} — {slotName(slot)}
      </p>
      <div className="row wrap">
        {reasons.map((k) => (
          <button key={k} className={'chip' + (note === t(k) ? ' on' : '')} onClick={() => (setNoteV(t(k)), setExc(true))}>
            {t(k)}
          </button>
        ))}
      </div>
      <label className="f">{t('note_label')}</label>
      <textarea rows={2} value={note} onChange={(e) => setNoteV(e.target.value)} placeholder={t('note_ph')} />
      <label className="check">
        <input type="checkbox" checked={exc} onChange={(e) => setExc(e.target.checked)} />
        {t('excused_ok')}
      </label>
      <div className="acts">
        <button className="btn" onClick={() => onSave(note, exc)}>
          {t('save')}
        </button>
        <button className="btn ghost" onClick={onClose}>
          {t('cancel')}
        </button>
      </div>
    </Sheet>
  );
}
