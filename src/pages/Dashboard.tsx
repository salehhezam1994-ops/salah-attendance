import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, PRAYERS, PRAYER_NAMES, type Prayer } from '../db/schema';
import { useSel } from '../App';
import { useAuth } from '../auth';
import { buildReport } from '../lib/stats';
import { DateBar, Empty, RateBar, SearchBox, matchStudent } from '../components/ui';
import { IChart } from '../components/Icons';

export default function DashboardPage() {
  const { date, set } = useSel();
  const { user, allowedClasses, isAdmin } = useAuth();
  const [cls, setCls] = useState<string | null>(null);
  const [pf, setPf] = useState<Prayer | null>(null);
  const [q, setQ] = useState('');

  const classes = useLiveQuery(async () => allowedClasses(await db.classes.orderBy('order').toArray()), [user.id]);
  const report = useLiveQuery(async () => {
    if (!classes) return undefined;
    const ids = cls ? [cls] : isAdmin || user.perms.allClasses ? null : classes.map((c) => c.id);
    return buildReport({ from: date, to: date, classIds: ids ?? null, prayers: pf ? [pf] : null });
  }, [date, cls, pf, classes]);

  if (!classes || !report) return null;
  const day = report.byDate.get(date) ?? {};
  const t = report.totals;
  const repeated = report.byStudent.filter((s) => s.absent >= 2 && matchStudent(q, s.student.name, s.student.serial)).sort((a, b) => b.absent - a.absent);
  const prayersShown = pf ? [pf] : PRAYERS;
  const recordedPrayers = PRAYERS.filter((p) => day[p]).length;

  return (
    <>
      <header className="topbar">
        <h1>لوحة المتابعة اليومية</h1>
      </header>
      <main className="content">
        <DateBar value={date} onChange={(d) => set({ date: d })} />
        <div className="sp" />
        <div className="chips">
          <button className={'chip' + (!cls ? ' on' : '')} onClick={() => setCls(null)}>
            كل الصفوف
          </button>
          {classes.map((c) => (
            <button key={c.id} className={'chip' + (cls === c.id ? ' on' : '')} onClick={() => setCls(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="chips">
          <button className={'chip' + (!pf ? ' on' : '')} onClick={() => setPf(null)}>
            كل الصلوات
          </button>
          {PRAYERS.map((p) => (
            <button key={p} className={'chip' + (pf === p ? ' on' : '')} onClick={() => setPf(p)}>
              {PRAYER_NAMES[p]}
            </button>
          ))}
        </div>

        <div className="kpis">
          <div className="kpi brand">
            <b>{t.students}</b>
            <span>عدد الطلاب</span>
          </div>
          <div className="kpi ok">
            <b>{t.present}</b>
            <span>مرات الحضور</span>
          </div>
          <div className="kpi bad">
            <b>{t.absent}</b>
            <span>مرات الغياب{t.excused ? ` (${t.excused} بعذر)` : ''}</span>
          </div>
          <div className={'kpi ' + (t.rate >= 80 ? 'ok' : 'bad')}>
            <b>{t.recorded ? t.rate + '%' : '—'}</b>
            <span>نسبة الحضور</span>
          </div>
        </div>

        {t.recorded === 0 ? (
          <div className="card">
            <Empty icon={<IChart />} text="لم يُسجَّل أي حضور لهذا اليوم بعد." />
          </div>
        ) : (
          <>
            <div className="card">
              <h3>نسبة الحضور لكل صلاة {!pf && <span className="small muted">({recordedPrayers} من 5 مسجّلة)</span>}</h3>
              {report.byPrayer
                .filter((p) => prayersShown.includes(p.prayer))
                .map((p) => (
                  <div key={p.prayer} className="prow">
                    <div className="row" style={{ marginBottom: 6 }}>
                      <b className="grow">{PRAYER_NAMES[p.prayer]}</b>
                      {p.recorded ? (
                        <>
                          <span className="pill ok">{p.present} حاضر</span>
                          <span className="pill bad">{p.absent} غائب</span>
                          <b style={{ minWidth: 48, textAlign: 'left' }}>{p.rate}%</b>
                        </>
                      ) : (
                        <span className="pill gray">لم تُسجّل</span>
                      )}
                    </div>
                    {p.recorded > 0 && <RateBar rate={p.rate} />}
                  </div>
                ))}
            </div>

            <SearchBox value={q} onChange={setQ} placeholder="تصفية الأسماء بطالب معيّن" />
            <div className="sp" />

            <div className="card">
              <h3>الغائبون حسب الصلاة</h3>
              {prayersShown.map((p) => {
                const ids = (day[p]?.absentIds ?? []).filter((id) => {
                  const s = report.studentMap.get(id);
                  return s && matchStudent(q, s.name, s.serial);
                });
                if (!day[p]) return null;
                return (
                  <div key={p} className="prow">
                    <div className="row" style={{ marginBottom: 4 }}>
                      <b className="grow">{PRAYER_NAMES[p]}</b>
                      <span className={'count ' + (ids.length ? 'bad' : 'ok')}>{ids.length}</span>
                    </div>
                    {ids.length === 0 ? (
                      <span className="small muted">لا يوجد غائبون ✓</span>
                    ) : (
                      ids.map((id) => {
                        const s = report.studentMap.get(id)!;
                        return (
                          <Link key={id} to={`/student/${id}`} className="pill bad" style={{ textDecoration: 'none' }}>
                            {s.name}
                          </Link>
                        );
                      })
                    )}
                  </div>
                );
              })}
            </div>

            {!pf && (
              <div className="card">
                <h3>تكرر غيابهم خلال اليوم</h3>
                {repeated.length === 0 ? (
                  <p className="small muted">لا يوجد طالب غاب أكثر من صلاة.</p>
                ) : (
                  repeated.map((s) => (
                    <Link key={s.student.id} to={`/student/${s.student.id}`} className="list-item" style={{ color: 'inherit', textDecoration: 'none' }}>
                      <span className="avatar bad">{s.absent}</span>
                      <span className="grow">
                        <b>{s.student.name}</b>
                        <div className="small muted">
                          {s.className} — {PRAYERS.filter((p) => s.perPrayerAbsent[p]).map((p) => PRAYER_NAMES[p]).join('، ')}
                        </div>
                      </span>
                    </Link>
                  ))
                )}
              </div>
            )}

            {!cls && report.byClass.length > 1 && (
              <div className="card">
                <h3>حسب الصف</h3>
                {report.byClass.map((c) => (
                  <div key={c.cls.id} className="prow">
                    <div className="row" style={{ marginBottom: 6 }}>
                      <b className="grow">{c.cls.name}</b>
                      <span className="pill bad">{c.absent} غياب</span>
                      <b>{c.rate}%</b>
                    </div>
                    <RateBar rate={c.rate} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
