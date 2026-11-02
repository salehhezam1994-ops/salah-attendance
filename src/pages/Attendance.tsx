import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, PRAYERS, PRAYER_NAMES, type Attendance, type Student } from '../db/schema';
import { markAll, clearSession, setNote, setStatus } from '../db/repo';
import { useSel } from '../App';
import { useAuth } from '../auth';
import { DateBar, Empty, SearchBox, Sheet, matchStudent, useUI } from '../components/ui';
import { IAllCheck, ICheck, INote, IReset, ISearch, IUsers, IX } from '../components/Icons';
import { todayISO } from '../lib/dates';

const REASONS = ['مريض', 'مسافر', 'استئذان', 'ظرف عائلي', 'صلّى في مسجد آخر'];

export default function AttendancePage() {
  const { date, prayer, classId, set } = useSel();
  const { user, isAdmin, allowedClasses } = useAuth();
  const ui = useUI();
  const [q, setQ] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [noteFor, setNoteFor] = useState<Student | null>(null);

  const classes = useLiveQuery(async () => allowedClasses(await db.classes.orderBy('order').toArray()), [user.id]);
  const students = useLiveQuery(() => db.students.where('active').equals(1).toArray(), []);
  const recs = useLiveQuery(() => db.attendance.where('[date+prayer]').equals([date, prayer]).toArray(), [date, prayer]);
  const dayRecs = useLiveQuery(() => db.attendance.where('date').equals(date).toArray(), [date]);

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

  // هل اكتمل تسجيل صلاة معينة للصف الحالي؟ (لعرض نقطة خضراء)
  const prayerDone = useMemo(() => {
    const ids = new Set(list.map((s) => s.id));
    const out: Record<string, boolean> = {};
    for (const p of PRAYERS) {
      const n = (dayRecs ?? []).filter((r) => r.prayer === p && ids.has(r.studentId)).length;
      out[p] = ids.size > 0 && n >= ids.size;
    }
    return out;
  }, [dayRecs, list]);

  const readOnly = !isAdmin && !user.perms.editPastDays && date !== todayISO();

  if (!classes || !students) return null;

  const toggle = async (s: Student, to?: 'P' | 'A') => {
    if (readOnly) return ui.toast('لا تملك صلاحية تعديل الأيام السابقة', true);
    const cur = recMap.get(s.id)?.status;
    const next = to ?? (cur === 'P' ? 'A' : 'P');
    if (navigator.vibrate) navigator.vibrate(12);
    await setStatus(date, prayer, s, cur === next && to ? null : next, user.id);
  };

  const allPresent = async () => {
    if (readOnly) return ui.toast('لا تملك صلاحية تعديل الأيام السابقة', true);
    if (unmarked > 0) {
      await markAll(date, prayer, list, 'P', false, user.id);
      ui.toast(`تم تحديد ${unmarked} طالبًا حاضرًا — حدّد الغائبين فقط`);
    } else if (absent > 0 && (await ui.confirm('سيتم تحويل جميع الغائبين إلى حاضرين وحذف ملاحظاتهم. هل أنت متأكد؟', { ok: 'نعم، الجميع حاضر' }))) {
      await markAll(date, prayer, list, 'P', true, user.id);
    }
  };

  const reset = async () => {
    if (readOnly) return;
    if (await ui.confirm(`مسح تسجيل ${PRAYER_NAMES[prayer]} لصف «${activeClass?.name}» في هذا التاريخ؟`, { ok: 'مسح', danger: true })) {
      await clearSession(date, prayer, list);
    }
  };

  const nextClass = classes[classes.findIndex((c) => c.id === activeClass?.id) + 1];

  return (
    <>
      <header className="topbar">
        <h1>تسجيل الحضور</h1>
        <button className="ib" onClick={() => (setShowSearch((v) => !v), setQ(''))} aria-label="بحث">
          <ISearch />
        </button>
        {list.length > 0 && !readOnly && (
          <button className="ib" onClick={reset} aria-label="مسح التسجيل">
            <IReset />
          </button>
        )}
      </header>
      <main className="content">
        <DateBar value={date} onChange={(d) => set({ date: d })} />
        <div className="sp" />
        <div className="seg">
          {PRAYERS.map((p) => (
            <button key={p} className={p === prayer ? 'on' : ''} onClick={() => set({ prayer: p })}>
              {prayerDone[p] && <span className="dot" />}
              {PRAYER_NAMES[p]}
            </button>
          ))}
        </div>
        <div className="sp" />
        {classes.length === 0 ? (
          <Empty icon={<IUsers />} text={isAdmin ? 'لا توجد صفوف بعد. ابدأ بإضافة الصفوف والطلاب.' : 'لم تُمنح صلاحية على أي صف.'}>
            {isAdmin && (
              <Link to="/students" className="btn">
                إدارة الصفوف والطلاب
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
                <span>حاضر</span>
              </div>
              <div className="stat bad">
                <b>{absent}</b>
                <span>غائب</span>
              </div>
              <div className="stat un">
                <b>{unmarked}</b>
                <span>لم يُحدَّد</span>
              </div>
            </div>
            <div className="sp" />
            {readOnly && <p className="pill warn">عرض فقط — لا تملك صلاحية تعديل الأيام السابقة</p>}
            {showSearch && (
              <>
                <SearchBox value={q} onChange={setQ} />
                <div className="sp" />
              </>
            )}

            {list.length === 0 ? (
              <Empty icon={<IUsers />} text="لا يوجد طلاب في هذا الصف." />
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
                  <>
                    <button className="btn ok grow" onClick={() => set({ classId: nextClass.id })}>
                      ✓ تم — الصف التالي: {nextClass.name}
                    </button>
                  </>
                ) : (
                  <button className="btn ok grow" onClick={allPresent} disabled={unmarked === 0 && absent === 0}>
                    <IAllCheck /> {unmarked > 0 ? `تحديد الباقين حاضرين (${unmarked})` : 'تحديد الجميع حاضرًا'}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>
      {noteFor && <NoteSheet s={noteFor} r={recMap.get(noteFor.id)} onClose={() => setNoteFor(null)} onSave={async (note, exc) => {
        await setNote(date, prayer, noteFor, note, exc, user.id);
        setNoteFor(null);
        ui.toast('تم حفظ الملاحظة');
      }} />}
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
        {st === 'A' && (r?.note || r?.excused) ? <small className="n">{r.excused ? 'بعذر' : ''}{r.note ? (r.excused ? ' — ' : '') + r.note : ''}</small> : null}
      </div>
      {st === 'A' && (
        <button className={'ib note' + (r?.note || r?.excused ? ' has' : '')} onClick={onNote} aria-label="ملاحظة">
          <INote />
        </button>
      )}
      <div className="tog">
        <button className={'p' + (st === 'P' ? ' on' : '')} onClick={() => onToggle(s, 'P')} aria-label="حاضر">
          <ICheck />
        </button>
        <button className={'a' + (st === 'A' ? ' on' : '')} onClick={() => onToggle(s, 'A')} aria-label="غائب">
          <IX />
        </button>
      </div>
    </div>
  );
}

function NoteSheet({ s, r, onClose, onSave }: { s: Student; r?: Attendance; onClose: () => void; onSave: (note: string, excused: boolean) => void }) {
  const [note, setNoteV] = useState(r?.note ?? '');
  const [exc, setExc] = useState(!!r?.excused);
  return (
    <Sheet onClose={onClose}>
      <h2>ملاحظة غياب</h2>
      <p className="muted" style={{ marginTop: 0 }}>{s.name}</p>
      <div className="row wrap">
        {REASONS.map((x) => (
          <button key={x} className={'chip' + (note === x ? ' on' : '')} onClick={() => (setNoteV(x), setExc(true))}>
            {x}
          </button>
        ))}
      </div>
      <label className="f">الملاحظة / العذر</label>
      <textarea rows={2} value={note} onChange={(e) => setNoteV(e.target.value)} placeholder="اكتب ملاحظة (اختياري)" />
      <label className="check">
        <input type="checkbox" checked={exc} onChange={(e) => setExc(e.target.checked)} />
        غياب بعذر مقبول
      </label>
      <div className="acts">
        <button className="btn" onClick={() => onSave(note, exc)}>
          حفظ
        </button>
        <button className="btn ghost" onClick={onClose}>
          إلغاء
        </button>
      </div>
    </Sheet>
  );
}
