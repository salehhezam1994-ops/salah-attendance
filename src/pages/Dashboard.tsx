import { useState } from 'react';
import { UndoBar } from '../components/UndoBar';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, type Slot } from '../db/schema';
import { useSel } from '../App';
import { useAuth } from '../auth';
import { buildReport } from '../lib/stats';
import { DateBar, Empty, RateBar, SearchBox, matchStudent } from '../components/ui';
import { IChart } from '../components/Icons';
import { t } from '../i18n';
import { PRAYER_GROUP, groupName, groupSlots, groupsOf, slotName, useActivities } from '../lib/slots';

export default function DashboardPage() {
  const { date, set } = useSel();
  const { user, allowedClasses, isAdmin } = useAuth();
  const acts = useActivities();
  const [group, setGroup] = useState(PRAYER_GROUP);
  const [cls, setCls] = useState<string | null>(null);
  const [pf, setPf] = useState<Slot | null>(null);
  const [q, setQ] = useState('');

  const allSlots = groupSlots(group);
  const multi = allSlots.length > 1;
  const slots = pf && multi ? [pf] : allSlots;

  const classes = useLiveQuery(async () => allowedClasses(await db.classes.orderBy('order').toArray()), [user.id]);
  const report = useLiveQuery(async () => {
    if (!classes) return undefined;
    const ids = cls ? [cls] : isAdmin || user.perms.allClasses ? null : classes.map((c) => c.id);
    return buildReport({ from: date, to: date, classIds: ids ?? null, slots });
  }, [date, cls, slots.join(','), classes]);

  if (!classes || !report) return null;
  const day = report.byDate.get(date) ?? {};
  const tot = report.totals;
  const repeated = report.byStudent.filter((s) => s.absent >= 2 && matchStudent(q, s.student.name, s.student.serial)).sort((a, b) => b.absent - a.absent);
  const recordedSlots = allSlots.filter((p) => day[p]).length;

  return (
    <>
      <header className="topbar">
        <h1>{t('dash_title')}</h1>
        <UndoBar />
      </header>
      <main className="content">
        <DateBar value={date} onChange={(d) => set({ date: d })} />
        <div className="sp" />
        {(acts?.length ?? 0) > 0 && (
          <div className="tabs" style={{ marginBottom: 8 }}>
            {groupsOf(acts).map((g) => (
              <button key={g} className={group === g ? 'on' : ''} onClick={() => (setGroup(g), setPf(null))}>
                {groupName(g)}
              </button>
            ))}
          </div>
        )}
        <div className="chips">
          <button className={'chip' + (!cls ? ' on' : '')} onClick={() => setCls(null)}>
            {t('all_classes')}
          </button>
          {classes.map((c) => (
            <button key={c.id} className={'chip' + (cls === c.id ? ' on' : '')} onClick={() => setCls(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        {multi && (
          <div className="chips">
            <button className={'chip' + (!pf ? ' on' : '')} onClick={() => setPf(null)}>
              {t('all_slots')}
            </button>
            {allSlots.map((p) => (
              <button key={p} className={'chip' + (pf === p ? ' on' : '')} onClick={() => setPf(p)}>
                {slotName(p)}
              </button>
            ))}
          </div>
        )}

        <div className="kpis">
          <div className="kpi brand">
            <b>{tot.students}</b>
            <span>{t('students_count')}</span>
          </div>
          <div className="kpi ok">
            <b>{tot.present}</b>
            <span>{t('times_present')}</span>
          </div>
          <div className="kpi bad">
            <b>{tot.absent}</b>
            <span>
              {t('times_absent')}
              {tot.excused ? ' ' + t('with_excused', { n: tot.excused }) : ''}
            </span>
          </div>
          <div className={'kpi ' + (tot.rate >= 80 ? 'ok' : 'bad')}>
            <b>{tot.recorded ? tot.rate + '%' : '—'}</b>
            <span>{t('attendance_rate')}</span>
          </div>
        </div>

        {tot.recorded === 0 ? (
          <div className="card">
            <Empty icon={<IChart />} text={t('no_records_day')} />
          </div>
        ) : (
          <>
            <div className="card">
              <h3>
                {multi ? t('rate_per_slot') : groupName(group)}{' '}
                {multi && !pf && <span className="small muted">{t('recorded_of', { n: recordedSlots, m: allSlots.length })}</span>}
              </h3>
              {report.bySlot.map((p) => (
                <div key={p.slot} className="prow">
                  <div className="row" style={{ marginBottom: 6 }}>
                    <b className="grow">{slotName(p.slot)}</b>
                    {p.recorded ? (
                      <>
                        <span className="pill ok">{t('n_present', { n: p.present })}</span>
                        <span className="pill bad">{t('n_absent', { n: p.absent })}</span>
                        <b style={{ minWidth: 48, textAlign: 'end' }}>{p.rate}%</b>
                      </>
                    ) : (
                      <span className="pill gray">{t('not_recorded')}</span>
                    )}
                  </div>
                  {p.recorded > 0 && <RateBar rate={p.rate} />}
                </div>
              ))}
            </div>

            <SearchBox value={q} onChange={setQ} placeholder={t('filter_student')} />
            <div className="sp" />

            <div className="card">
              <h3>{t('absent_by_slot')}</h3>
              {slots.map((p) => {
                if (!day[p]) return null;
                const ids = (day[p]?.absentIds ?? []).filter((id) => {
                  const s = report.studentMap.get(id);
                  return s && matchStudent(q, s.name, s.serial);
                });
                return (
                  <div key={p} className="prow">
                    <div className="row" style={{ marginBottom: 4 }}>
                      <b className="grow">{slotName(p)}</b>
                      <span className={'count ' + (ids.length ? 'bad' : 'ok')}>{ids.length}</span>
                    </div>
                    {ids.length === 0 ? (
                      <span className="small muted">{t('none_absent')}</span>
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

            {multi && !pf && (
              <div className="card">
                <h3>{t('repeated_absent')}</h3>
                {repeated.length === 0 ? (
                  <p className="small muted">{t('no_repeated')}</p>
                ) : (
                  repeated.map((s) => (
                    <Link key={s.student.id} to={`/student/${s.student.id}`} className="list-item" style={{ color: 'inherit', textDecoration: 'none' }}>
                      <span className="avatar bad">{s.absent}</span>
                      <span className="grow">
                        <b>{s.student.name}</b>
                        <div className="small muted">
                          {s.className} — {allSlots.filter((p) => s.perSlotAbsent[p]).map(slotName).join(', ')}
                        </div>
                      </span>
                    </Link>
                  ))
                )}
              </div>
            )}

            {!cls && report.byClass.length > 1 && (
              <div className="card">
                <h3>{t('by_class')}</h3>
                {report.byClass.map((c) => (
                  <div key={c.cls.id} className="prow">
                    <div className="row" style={{ marginBottom: 6 }}>
                      <b className="grow">{c.cls.name}</b>
                      <span className="pill bad">{t('n_absences', { n: c.absent })}</span>
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
