import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { useAuth } from '../auth';
import { useSel } from '../App';
import { buildReport } from '../lib/stats';
import { dailyDoc, periodDoc, studentDoc, type ReportDoc } from '../lib/reportDoc';
import { exportExcel, exportPdf } from '../lib/exporters';
import { addDays, fmtDate, monthName, monthRange, todayISO, weekStart, fromISO } from '../lib/dates';
import { DateBar, SearchBox, matchStudent, useUI } from '../components/ui';
import { IChevL, IChevR, IPdf, IXls } from '../components/Icons';
import { getSetting } from '../db/repo';
import { t } from '../i18n';
import { GroupTabs } from '../components/GroupTabs';
import { PRAYER_GROUP, groupSlots } from '../lib/slots';

export type Period = { kind: 'day' | 'week' | 'month' | 'range' | 'all'; from: string; to: string };

export function periodRange(p: Period): [string, string] {
  switch (p.kind) {
    case 'day':
      return [p.from, p.from];
    case 'week': {
      const a = weekStart(p.from);
      return [a, addDays(a, 6)];
    }
    case 'month':
      return monthRange(p.from);
    case 'all':
      return ['2000-01-01', todayISO()];
    default:
      return [p.from, p.to];
  }
}

export function PeriodPicker({ value, onChange, allowAll, allowDay }: { value: Period; onChange: (p: Period) => void; allowAll?: boolean; allowDay?: boolean }) {
  const [from, to] = periodRange(value);
  const kinds: [Period['kind'], string][] = [
    ...(allowDay ? ([['day', t('period_day')]] as [Period['kind'], string][]) : []),
    ['week', t('period_week')],
    ['month', t('period_month')],
    ['range', t('period_range')],
    ...(allowAll ? ([['all', t('period_all')]] as [Period['kind'], string][]) : []),
  ];
  const shift = (dir: number) => {
    if (value.kind === 'week') onChange({ ...value, from: addDays(from, 7 * dir) });
    else if (value.kind === 'month') {
      const d = fromISO(from);
      d.setMonth(d.getMonth() + dir);
      onChange({ ...value, from: monthRange(d.toISOString().slice(0, 10))[0] });
    }
  };
  const label =
    value.kind === 'month'
      ? `${monthName(fromISO(from).getMonth())} ${fromISO(from).getFullYear()}`
      : `${fmtDate(from, false)} — ${fmtDate(to, false)}`;
  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="chips">
        {kinds.map(([k, l]) => (
          <button key={k} className={'chip' + (value.kind === k ? ' on' : '')} onClick={() => onChange({ ...value, kind: k, from: k === 'range' ? from : value.from })}>
            {l}
          </button>
        ))}
      </div>
      {value.kind === 'day' && <DateBar value={value.from} onChange={(d) => onChange({ ...value, from: d })} />}
      {(value.kind === 'week' || value.kind === 'month') && (
        <div className="datebar" style={{ boxShadow: 'none', background: 'var(--soft, #f5f8f6)' }}>
          <button className="ib flip" onClick={() => shift(-1)}>
            <IChevR />
          </button>
          <div className="d">{label}</div>
          <button className="ib flip" onClick={() => shift(1)} disabled={to >= todayISO()} style={{ opacity: to >= todayISO() ? 0.3 : 1 }}>
            <IChevL />
          </button>
        </div>
      )}
      {value.kind === 'range' && (
        <div className="row">
          <div className="grow">
            <label className="f" style={{ marginTop: 4 }}>{t('from')}</label>
            <input type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
          </div>
          <div className="grow">
            <label className="f" style={{ marginTop: 4 }}>{t('to')}</label>
            <input type="date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}

export function ExportButtons({ make }: { make: () => ReportDoc }) {
  const ui = useUI();
  const [busy, setBusy] = useState<'' | 'pdf' | 'xls'>('');
  const run = async (kind: 'pdf' | 'xls') => {
    setBusy(kind);
    try {
      const doc = make();
      if (kind === 'pdf') await exportPdf(doc);
      else await exportExcel(doc);
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      if (!/cancel|abort/i.test(msg)) ui.toast(t('export_failed', { e: msg }), true);
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="row" style={{ margin: '4px 0 12px' }}>
      <button className="btn grow" style={{ background: '#b42318' }} disabled={!!busy} onClick={() => run('pdf')}>
        <IPdf /> {busy === 'pdf' ? t('preparing') : t('export_pdf')}
      </button>
      <button className="btn grow" style={{ background: '#1d6f42' }} disabled={!!busy} onClick={() => run('xls')}>
        <IXls /> {busy === 'xls' ? t('preparing') : t('export_excel')}
      </button>
    </div>
  );
}

/** عرض التقرير على الشاشة بنفس محتوى ملف التصدير */
export function DocView({ doc }: { doc: ReportDoc }) {
  return (
    <>
      <div className="card">
        <h3 style={{ marginBottom: 4 }}>{doc.title}</h3>
        <div className="small muted">{doc.subtitle}</div>
      </div>
      {doc.sections.map((sec, i) => (
        <div className="card" key={i}>
          <h3>{sec.heading}</h3>
          {sec.kpis && (
            <div className="kpis" style={{ marginBottom: 0 }}>
              {sec.kpis.map((k, j) => (
                <div key={j} className={'kpi ' + (k.tone === 'ok' ? 'ok' : k.tone === 'bad' ? 'bad' : '')} style={{ boxShadow: 'none', background: '#f6f9f7', padding: 10 }}>
                  <b style={{ fontSize: typeof k.value === 'string' && k.value.length > 8 ? 16 : 24 }}>{k.value}</b>
                  <span>{k.label}</span>
                </div>
              ))}
            </div>
          )}
          {sec.text && !sec.table?.rows.length && <p className="small muted">{sec.text}</p>}
          {sec.table && sec.table.rows.length > 0 && (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    {sec.table.head.map((h, j) => (
                      <th key={j}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sec.table.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((c, k) => {
                        let cls = '';
                        if (sec.table!.rateCols?.includes(k) && typeof c === 'number') cls = c >= 90 ? 'g' : c >= 70 ? 'y' : 'r';
                        else if (sec.table!.absentCols?.includes(k) && Number(c) > 0) cls = 'r';
                        return (
                          <td key={k} className={cls}>
                            {c}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

type Scope = 'all' | 'class' | 'student';

export default function ReportsPage() {
  const { user, isAdmin, allowedClasses } = useAuth();
  const sel = useSel();
  const [period, setPeriod] = useState<Period>({ kind: 'day', from: sel.date, to: todayISO() });
  const [scope, setScope] = useState<Scope>('all');
  const [classId, setClassId] = useState<string>('');
  const [studentId, setStudentId] = useState<string>('');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState(PRAYER_GROUP);
  const slots = groupSlots(group);
  const classes = useLiveQuery(async () => allowedClasses(await db.classes.orderBy('order').toArray()), [user.id]);
  const students = useLiveQuery(() => db.students.toArray(), []);
  const org = useLiveQuery(() => getSetting('org', ''), []);
  const [from, to] = periodRange(period);
  const restricted = !isAdmin && !user.perms.allClasses;

  const doc = useLiveQuery(async () => {
    if (!classes) return null;
    const allowedIds = classes.map((c) => c.id);
    if (scope === 'student') {
      if (!studentId) return null;
      const r = await buildReport({ from, to, studentId, slots });
      return studentDoc(r, org || undefined);
    }
    const ids = scope === 'class' ? (classId ? [classId] : null) : restricted ? allowedIds : null;
    if (scope === 'class' && !classId) return null;
    const r = await buildReport({ from, to, classIds: ids, slots });
    if (period.kind === 'day') return dailyDoc(r, from, org || undefined);
    const title = period.kind === 'week' ? t('r_weekly') : period.kind === 'month' ? t('r_monthly') : t('r_period');
    const cn = scope === 'class' ? ' — ' + (classes.find((c) => c.id === classId)?.name ?? '') : '';
    return periodDoc(r, title + cn, org || undefined);
  }, [from, to, scope, classId, studentId, classes, period.kind, org, group]);

  const visibleStudents = useMemo(() => {
    if (!students || !classes) return [];
    const ok = new Set(classes.map((c) => c.id));
    return students.filter((s) => ok.has(s.classId) && matchStudent(q, s.name, s.serial)).sort((a, b) => a.serial - b.serial).slice(0, 30);
  }, [students, classes, q]);

  if (!classes) return null;
  const canExport = isAdmin || user.perms.exportReports;
  const chosen = students?.find((s) => s.id === studentId);

  return (
    <>
      <header className="topbar">
        <h1>{t('reports_title')}</h1>
      </header>
      <main className="content">
        <div className="tabs">
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
            {restricted ? t('scope_my') : t('scope_all')}
          </button>
          <button className={scope === 'class' ? 'on' : ''} onClick={() => (setScope('class'), !classId && setClassId(classes[0]?.id ?? ''))}>
            {t('scope_class')}
          </button>
          <button className={scope === 'student' ? 'on' : ''} onClick={() => setScope('student')}>
            {t('scope_student')}
          </button>
        </div>
        {scope === 'class' && (
          <div className="chips">
            {classes.map((c) => (
              <button key={c.id} className={'chip' + (classId === c.id ? ' on' : '')} onClick={() => setClassId(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        )}
        {scope === 'student' && (
          <div className="card" style={{ padding: 10 }}>
            {chosen ? (
              <div className="row">
                <span className="avatar">{chosen.serial}</span>
                <b className="grow">{chosen.name}</b>
                <button className="btn sm ghost" onClick={() => setStudentId('')}>
                  {t('change')}
                </button>
              </div>
            ) : (
              <>
                <SearchBox value={q} onChange={setQ} placeholder={t('search_student')} />
                {visibleStudents.map((s) => (
                  <button key={s.id} className="list-item" style={{ width: '100%' }} onClick={() => setStudentId(s.id)}>
                    <span className="avatar">{s.serial}</span>
                    <span className="grow" style={{ textAlign: 'start' }}>
                      {s.name}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        <GroupTabs value={group} onChange={setGroup} />
        <PeriodPicker value={period} onChange={setPeriod} allowDay={scope !== 'student'} allowAll={scope === 'student'} />

        {doc ? (
          <>
            {canExport && <ExportButtons make={() => doc} />}
            <DocView doc={doc} />
          </>
        ) : (
          <p className="center muted">{scope === 'student' ? t('choose_student_hint') : t('choose_class_hint')}</p>
        )}
      </main>
    </>
  );
}
