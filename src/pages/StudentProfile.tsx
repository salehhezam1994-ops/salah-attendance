import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { db, PRAYERS, PRAYER_NAMES } from '../db/schema';
import { buildReport } from '../lib/stats';
import { dayName, fmtShort, monthRange, todayISO, pct } from '../lib/dates';
import { useAuth } from '../auth';
import { Empty, RateBar, rateTone } from '../components/ui';
import { IChevR } from '../components/Icons';
import { ExportButtons, PeriodPicker, periodRange, type Period } from './Reports';
import { studentDoc } from '../lib/reportDoc';
import { getSetting } from '../db/repo';

export default function StudentProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, isAdmin } = useAuth();
  const [period, setPeriod] = useState<Period>({ kind: 'month', from: monthRange(todayISO())[0], to: todayISO() });
  const [from, to] = periodRange(period);
  const report = useLiveQuery(() => buildReport({ from, to, studentId: id! }), [id, from, to]);
  const org = useLiveQuery(() => getSetting('org', ''), []);
  if (!report) return null;
  const s = report.byStudent[0];
  if (!s) return <Empty text="الطالب غير موجود" />;
  const canExport = isAdmin || (user.perms.viewReports && user.perms.exportReports);

  // تجميع الغياب حسب اليوم
  const byDay = new Map<string, typeof s.absences>();
  for (const a of s.absences) byDay.set(a.date, [...(byDay.get(a.date) ?? []), a]);

  return (
    <>
      <header className="topbar">
        <button className="ib" onClick={() => nav(-1)} aria-label="رجوع">
          <IChevR />
        </button>
        <h1>{s.student.name}</h1>
      </header>
      <main className="content">
        <div className="card row">
          <span className="avatar" style={{ width: 48, height: 48, fontSize: 18 }}>
            {s.student.serial}
          </span>
          <div className="grow">
            <b style={{ fontSize: 18 }}>{s.student.name}</b>
            <div className="small muted">
              {s.className}
              {s.student.phone && (
                <>
                  {' — '}
                  <a href={`tel:${s.student.phone}`} dir="ltr">
                    {s.student.phone}
                  </a>
                </>
              )}
              {!s.student.active && ' — مؤرشف'}
            </div>
          </div>
        </div>

        <PeriodPicker value={period} onChange={setPeriod} allowAll />

        <div className="kpis">
          <div className={'kpi ' + (s.rate >= 80 ? 'ok' : 'bad')}>
            <b>{s.recorded ? s.rate + '%' : '—'}</b>
            <span>نسبة الالتزام</span>
          </div>
          <div className="kpi bad">
            <b>{s.absent}</b>
            <span>مرات الغياب{s.excused ? ` (${s.excused} بعذر)` : ''}</span>
          </div>
          <div className="kpi ok">
            <b>{s.present}</b>
            <span>مرات الحضور</span>
          </div>
          <div className="kpi brand">
            <b style={{ fontSize: 22 }}>{s.mostMissed ? PRAYER_NAMES[s.mostMissed] : '—'}</b>
            <span>أكثر صلاة يغيب عنها</span>
          </div>
        </div>

        <div className="card">
          <h3>الغياب حسب الصلاة</h3>
          {PRAYERS.map((p) => {
            const rec = s.perPrayerRecorded[p];
            const ab = s.perPrayerAbsent[p];
            const r = pct(rec - ab, rec);
            return (
              <div key={p} className="prow">
                <div className="row" style={{ marginBottom: 6 }}>
                  <b className="grow">{PRAYER_NAMES[p]}</b>
                  <span className={'count ' + (ab ? 'bad' : 'ok')}>{ab}</span>
                  <span className={'small ' + rateTone(r)} style={{ minWidth: 48, textAlign: 'left' }}>
                    {rec ? r + '%' : '—'}
                  </span>
                </div>
                {rec > 0 && <RateBar rate={r} />}
              </div>
            );
          })}
        </div>

        <div className="card">
          <h3>سجل الغياب ({s.absent})</h3>
          {byDay.size === 0 ? (
            <p className="small muted">لا يوجد غياب في هذه الفترة ✓</p>
          ) : (
            [...byDay.entries()].map(([d, list]) => (
              <div key={d} className="prow">
                <div className="row">
                  <b className="grow">
                    {dayName(d)} {fmtShort(d)}
                  </b>
                  <span className="count bad">{list.length}</span>
                </div>
                <div>
                  {list.map((a) => (
                    <span key={a.id} className={'pill ' + (a.excused ? 'warn' : 'bad')}>
                      {PRAYER_NAMES[a.prayer]}
                      {a.excused ? ' (بعذر)' : ''}
                      {a.note ? ` — ${a.note}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {canExport && <ExportButtons make={() => studentDoc(report, org || undefined)} />}
      </main>
    </>
  );
}

