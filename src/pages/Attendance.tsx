import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, PRAYERS, attId, isPrayerSlot, type Attendance, type Slot, type Student } from '../db/schema';
import { bulkSet, markAll, setNote, setStatus } from '../db/repo';
import { useSel } from '../App';
import { useAuth } from '../auth';
import { DateBar, Empty, SearchBox, Sheet, matchStudent, useUI } from '../components/ui';
import { IAllCheck, ICard, ICheck, INote, IQr, IReset, ISearch, IUsers, IX } from '../components/Icons';
import { QrScanner, type ScanResult } from '../components/QrScanner';
import { parseQr } from '../lib/qrCards';
import { CardPanel } from '../components/CardPanel';
import { fromISO, guessPrayer, todayISO } from '../lib/dates';
import { hhmm, prayerTimes } from '../lib/prayerTimes';
import { ALL } from '../App';
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
  const [scanning, setScanning] = useState<'' | 'qr' | 'card'>('');
  const [summary, setSummary] = useState(false);
  const [scanN, setScanN] = useState(0);
  const scanned = useRef(new Set<string>());
  const touched = useRef(new Set<string>());

  const [allP, setAllP] = useState(false);
  const classes = useLiveQuery(async () => allowedClasses(await db.classes.orderBy('order').toArray()), [user.id]);
  const students = useLiveQuery(() => db.students.where('active').equals(1).toArray(), []);
  const dayRecs = useLiveQuery(() => db.attendance.where('date').equals(date).toArray(), [date]);

  const group = slotGroup(slot);
  const slots = groupSlots(group);
  const multiP = allP && isPrayerSlot(slot);
  const scopeSlots: Slot[] = multiP ? [...PRAYERS] : [slot];
  const allCls = classId === ALL;
  const activeClass = allCls ? undefined : classes?.find((c) => c.id === classId) ?? classes?.[0];
  const scopeClasses = allCls ? classes ?? [] : activeClass ? [activeClass] : [];

  // سجلات اليوم: المفتاح «الوقت|الطالب»
  const cell = useMemo(() => new Map((dayRecs ?? []).map((r) => [r.prayer + '|' + r.studentId, r])), [dayRecs]);
  const recMap = useMemo(() => new Map((dayRecs ?? []).filter((r) => r.prayer === slot).map((r) => [r.studentId, r])), [dayRecs, slot]);

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

  const list = scopeClasses.flatMap((c) => byClass.get(c.id) ?? []);
  const shown = list.filter((s) => matchStudent(q, s.name, s.serial));
  let present = 0,
    absent = 0;
  for (const st of list)
    for (const sl of scopeSlots) {
      const r = cell.get(sl + '|' + st.id);
      if (r?.status === 'P') present++;
      else if (r?.status === 'A') absent++;
    }
  const unmarked = list.length * scopeSlots.length - present - absent;

  // هل اكتمل تسجيل وقت معين للنطاق الحالي؟ (نقطة خضراء)
  const slotDone: Record<string, boolean> = {};
  for (const p of slots) slotDone[p] = list.length > 0 && list.every((st) => cell.has(p + '|' + st.id));
  const times = useMemo(() => prayerTimes(fromISO(date)), [date]);

  const readOnly = !isAdmin && !user.perms.editPastDays && date !== todayISO();

  if (!classes || !students) return null;

  const toggle = async (s: Student, to?: 'P' | 'A', sl: Slot = slot) => {
    if (readOnly) return ui.toast(t('no_perm_past'), true);
    const cur = cell.get(sl + '|' + s.id)?.status;
    const next = to ?? (cur === 'P' ? 'A' : cur === 'A' ? null : 'P');
    if (navigator.vibrate) navigator.vibrate(12);
    await setStatus(date, sl, s, to && cur === to ? null : next, user.id);
  };

  /** الأزرار الثلاثة: حاضر للجميع / غائب للجميع / إلغاء التحديد */
  const bulk = async (status: 'P' | 'A' | null) => {
    if (readOnly) return ui.toast(t('no_perm_past'), true);
    if (!list.length) return;
    const scopeTxt = t('bulk_scope', {
      slots: multiP ? t('all_prayers') : slotName(slot),
      cls: allCls ? t('all_classes') : activeClass?.name ?? '',
      n: list.length,
    });
    const action = status === 'P' ? t('bulk_present') : status === 'A' ? t('bulk_absent') : t('bulk_clear');
    const risky = status !== 'P' || absent > 0 || multiP || allCls;
    if (risky && !(await ui.confirm(scopeTxt, { title: action, ok: action, danger: status !== 'P' }))) return;
    const n = await bulkSet(date, scopeSlots, list, status, user.id);
    ui.toast(t('bulk_done', { n }));
  };

  const onScan = async (text: string): Promise<ScanResult> => {
    const id = parseQr(text);
    const s = id ? await db.students.get(id) : undefined;
    if (!s) return { kind: 'bad', title: t('scan_bad'), sub: t('scan_bad_sub') };
    return markScanned(s);
  };
  const onCard = async (card: string): Promise<ScanResult> => {
    const s = await db.students.where('card').equals(card).first();
    if (!s) return { kind: 'bad', title: t('card_unknown', { card }), sub: t('card_unknown_sub') };
    return markScanned(s);
  };
  const markScanned = async (s: Student): Promise<ScanResult> => {
    const cls = classes.find((c) => c.id === s.classId);
    if (!cls) return { kind: 'bad', title: s.name, sub: t('scan_not_allowed') };
    if (!s.active) return { kind: 'bad', title: s.name, sub: t('scan_archived') };
    const sub = cls.name + ' · ' + slotName(slot);
    const prev = await db.attendance.get(attId(date, slot, s.id));
    touched.current.add(s.classId);
    if (prev?.status === 'P') return { kind: 'dup', title: s.name, sub: t('scan_dup') };
    await setStatus(date, slot, s, 'P', user.id);
    scanned.current.add(s.id);
    setScanN(scanned.current.size);
    return { kind: 'ok', title: s.name, sub };
  };
  const startScan = (mode: 'qr' | 'card') => {
    if (readOnly) return ui.toast(t('no_perm_past'), true);
    scanned.current = new Set();
    setScanN(0);
    touched.current = new Set(scopeClasses.map((c) => c.id));
    setScanning(mode);
  };
  const unmarkedIn = (cid: string) => (byClass.get(cid) ?? []).filter((s) => !cell.has(slot + '|' + s.id));

  const chooseGroup = (g: string) => set({ slot: g === PRAYER_GROUP ? guessPrayer() : groupSlots(g)[0] });
  const hasActs = (acts?.length ?? 0) > 0;

  return (
    <>
      <header className="topbar">
        <h1>{t('att_title')}</h1>
        <SyncDot />
        {classes.length > 0 && !readOnly && (
          <>
            <button className="ib" onClick={() => startScan('card')} aria-label={t('card_scan')}>
              <ICard />
            </button>
            <button className="ib" onClick={() => startScan('qr')} aria-label={t('qr_scan')}>
              <IQr />
            </button>
          </>
        )}
        <button className="ib" onClick={() => (setShowSearch((v) => !v), setQ(''))} aria-label={t('search')}>
          <ISearch />
        </button>
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
            <div className="seg seg6">
              <button className={multiP ? 'on' : ''} onClick={() => setAllP(true)}>
                {t('all_short')}
                <small>{t('all_prayers_short')}</small>
              </button>
              {PRAYERS.map((p) => (
                <button key={p} className={!multiP && p === slot ? 'on' : ''} onClick={() => (setAllP(false), set({ slot: p }))}>
                  {slotDone[p] && <span className="dot" />}
                  {slotName(p)}
                  <small>{hhmm(times[p])}</small>
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
              {classes.length > 1 &&
                (() => {
                  const n = (students ?? []).filter((st) => classes.some((c) => c.id === st.classId) && recMap.has(st.id)).length;
                  const tot = classes.reduce((a, c) => a + (byClass.get(c.id)?.length ?? 0), 0);
                  return (
                    <button className={'chip' + (allCls ? ' on' : '') + (tot && n >= tot ? ' done' : '')} onClick={() => set({ classId: ALL })}>
                      {t('all_classes')}
                      <span className="badge">
                        {n}/{tot}
                      </span>
                    </button>
                  );
                })()}
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
                {shown.map((s, i) => {
                  const head = allCls && (i === 0 || shown[i - 1].classId !== s.classId);
                  return (
                    <div key={s.id}>
                      {head && <div className="att-head">{classes.find((c) => c.id === s.classId)?.name}</div>}
                      {multiP ? (
                        <MultiRow s={s} get={(sl) => cell.get(sl + '|' + s.id)} onToggle={(sl) => toggle(s, undefined, sl)} />
                      ) : (
                        <Row s={s} r={recMap.get(s.id)} onToggle={toggle} onNote={() => setNoteFor(s)} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {list.length > 0 && !readOnly && (
              <div className="actionbar bulkbar">
                <button className="bk p" onClick={() => bulk('P')}>
                  <IAllCheck /> {t('bulk_present_short')}
                </button>
                <button className="bk a" onClick={() => bulk('A')}>
                  <IX /> {t('bulk_absent_short')}
                </button>
                <button className="bk c" onClick={() => bulk(null)}>
                  <IReset /> {t('bulk_clear_short')}
                </button>
              </div>
            )}
          </>
        )}
      </main>
      {scanning && (() => {
        const finish = () => (setScanning(''), setSummary(true));
        const footer = (
          <div className="scan-foot">
            <span className="grow" style={{ alignSelf: 'center' }}>
              {t('scan_count', { n: scanN })}
            </span>
            <button className="btn" onClick={finish}>
              {t('scan_finish')}
            </button>
          </div>
        );
        return scanning === 'qr' ? (
          <QrScanner title={t('scan_title', { slot: slotName(slot) })} onCode={onScan} onClose={finish} footer={footer} />
        ) : (
          <CardPanel title={t('card_title', { slot: slotName(slot) })} onCard={onCard} onClose={finish} footer={footer} />
        );
      })()}
      {summary && (
        <Sheet onClose={() => setSummary(false)}>
          <h2>{t('scan_finish')}</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {t('scan_summary', { n: scanN })}
          </p>
          {[...touched.current].map((cid) => {
            const n = unmarkedIn(cid).length;
            return n ? (
              <div key={cid} className="small">
                {t('scan_unmarked', { cls: classes.find((c) => c.id === cid)?.name ?? '', n })}
              </div>
            ) : null;
          })}
          <div className="acts">
            {[...touched.current].some((cid) => unmarkedIn(cid).length) && (
              <button
                className="btn danger"
                onClick={async () => {
                  const list = [...touched.current].flatMap(unmarkedIn);
                  await markAll(date, slot, list, 'A', false, user.id);
                  ui.toast(t('marked_absent', { n: list.length }));
                  setSummary(false);
                }}
              >
                {t('mark_unscanned_absent', { n: [...touched.current].reduce((a, cid) => a + unmarkedIn(cid).length, 0) })}
              </button>
            )}
            <button className="btn ghost" onClick={() => setSummary(false)}>
              {t('leave_unmarked')}
            </button>
          </div>
        </Sheet>
      )}
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

/** صف الطالب في وضع «كل الصلوات»: خمسة أزرار صغيرة، كل ضغطة: حاضر ← غائب ← بلا */
function MultiRow({ s, get, onToggle }: { s: Student; get: (sl: Slot) => Attendance | undefined; onToggle: (sl: Slot) => void }) {
  return (
    <div className="att multi">
      <span className="num">{s.serial}</span>
      <div className="nm">
        {s.name}
        <div className="mini">
          {PRAYERS.map((p) => {
            const st = get(p)?.status;
            return (
              <button key={p} className={st ?? ''} onClick={() => onToggle(p)}>
                {st === 'P' ? '✓ ' : st === 'A' ? '✕ ' : ''}
                {slotName(p)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
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
