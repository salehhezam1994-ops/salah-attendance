import { daysBetween, fmtDate, fmtShort, dayName, hijri, pct } from './dates';
import { mostAbsent, mostCommitted, type Report } from './stats';
import { slotName, groupName, slotGroup } from './slots';
import { t } from '../i18n';

export type Cell = string | number;
export interface DocTable {
  head: string[];
  rows: Cell[][];
  /** أعمدة تُلوّن كنسبة (أخضر/أحمر) */
  rateCols?: number[];
  /** عمود الغياب للتلوين بالأحمر */
  absentCols?: number[];
}
export interface DocSection {
  heading: string;
  sheet?: string;
  kpis?: { label: string; value: Cell; tone?: 'ok' | 'bad' | 'neutral' }[];
  table?: DocTable;
  text?: string;
}
export interface ReportDoc {
  title: string;
  subtitle: string;
  org?: string;
  sections: DocSection[];
  fileBase: string;
}

const multi = (r: Report) => r.scope.slots.length > 1;
const gName = (r: Report) => groupName(slotGroup(r.scope.slots[0]));

function slotTable(r: Report): DocTable {
  return {
    head: [t('c_slot'), t('c_recorded'), t('c_present'), t('c_absent'), t('c_excused'), t('c_rate')],
    rows: r.bySlot.map((p) => [slotName(p.slot), p.recorded, p.present, p.absent, p.excused, p.recorded ? p.rate : '—']),
    rateCols: [5],
    absentCols: [3],
  };
}

function kpis(r: Report): DocSection['kpis'] {
  return [
    { label: t('students_count'), value: r.totals.students },
    { label: t('times_present'), value: r.totals.present, tone: 'ok' },
    { label: t('times_absent'), value: r.totals.absent, tone: 'bad' },
    { label: t('attendance_rate'), value: r.totals.rate + '%', tone: r.totals.rate >= 80 ? 'ok' : 'bad' },
  ];
}

function scopeLabel(r: Report): string {
  const ids = r.scope.classIds;
  if (!ids || !ids.length) return t('all_classes');
  return ids.map((id) => r.classMap.get(id)?.name ?? '').join(', ');
}

/** التقرير اليومي الشامل */
export function dailyDoc(r: Report, date: string, org?: string): ReportDoc {
  const day = r.byDate.get(date) ?? {};
  const slots = r.scope.slots;
  const sections: DocSection[] = [];
  sections.push({ heading: t('sec_summary_day'), sheet: t('sheet_summary'), kpis: kpis(r) });
  if (multi(r)) sections.push({ heading: t('sec_by_slot'), sheet: t('sec_by_slot'), table: slotTable(r) });

  const absentRows: Cell[][] = [];
  for (const p of slots) {
    for (const id of day[p]?.absentIds ?? []) {
      const s = r.studentMap.get(id);
      const rec = r.records.find((x) => x.studentId === id && x.prayer === p && x.date === date);
      absentRows.push([
        ...(multi(r) ? [slotName(p)] : []),
        s?.serial ?? '',
        s?.name ?? '',
        r.classMap.get(rec?.classId ?? '')?.name ?? '',
        rec?.excused ? t('excused_s') : t('unexcused_s'),
        rec?.note ?? '',
      ]);
    }
  }
  sections.push({
    heading: t('sec_absent_names'),
    sheet: t('c_absent'),
    table: { head: [...(multi(r) ? [t('c_slot')] : []), t('c_serial'), t('c_name'), t('c_class'), t('c_status'), t('c_note')], rows: absentRows },
    text: absentRows.length ? undefined : t('no_absent'),
  });

  if (multi(r)) {
    const perStudent = r.byStudent
      .filter((s) => s.absent > 0)
      .sort((a, b) => b.absent - a.absent || a.student.serial - b.student.serial)
      .map((s) => [s.student.serial, s.student.name, s.className, s.absent, slots.filter((p) => s.perSlotAbsent[p]).map(slotName).join(', ')]);
    sections.push({
      heading: t('sec_absent_count_day'),
      sheet: t('c_absences'),
      table: { head: [t('c_serial'), t('c_name'), t('c_class'), t('c_absences'), t('c_missed')], rows: perStudent, absentCols: [3] },
      text: perStudent.length ? undefined : t('none_short'),
    });
    const notRecorded = slots.filter((p) => !day[p]);
    if (notRecorded.length && notRecorded.length < slots.length)
      sections.push({ heading: t('sec_warning'), text: t('not_recorded_yet', { list: notRecorded.map(slotName).join(', ') }) });
  }

  return {
    title: `${t('r_daily')} — ${gName(r)}`,
    subtitle: `${fmtDate(date)} — ${hijri(date)} — ${scopeLabel(r)}`,
    org,
    sections,
    fileBase: `${t('file_daily')}_${date}`,
  };
}

/** التقارير الدورية (أسبوعي/شهري/فترة) */
export function periodDoc(r: Report, title: string, org?: string): ReportDoc {
  const { from, to, slots } = r.scope;
  const sections: DocSection[] = [];
  sections.push({ heading: t('sec_overall'), sheet: t('sheet_summary'), kpis: kpis(r) });
  if (multi(r)) sections.push({ heading: t('sec_by_slot'), sheet: t('sec_by_slot'), table: slotTable(r) });
  if (r.byClass.length > 1)
    sections.push({
      heading: t('sec_by_class'),
      sheet: t('by_class'),
      table: {
        head: [t('c_class'), t('c_students'), t('c_present'), t('c_absent'), t('c_rate')],
        rows: r.byClass.map((c) => [c.cls.name, c.students, c.present, c.absent, c.rate]),
        rateCols: [4],
        absentCols: [3],
      },
    });

  const days = daysBetween(from, to).filter((d) => r.byDate.has(d));
  if (days.length) {
    const n = slots.length;
    sections.push({
      heading: t('sec_daily_rates'),
      sheet: t('sec_daily_rates'),
      table: {
        head: [t('c_day'), t('c_date'), ...(multi(r) ? slots.map(slotName) : [t('c_present')]), t('c_absent'), t('c_rate')],
        rows: days.map((d) => {
          const day = r.byDate.get(d)!;
          let pr = 0,
            ab = 0;
          const cells = slots.map((p) => {
            const c = day[p];
            if (!c) return '—';
            pr += c.present;
            ab += c.absent;
            return pct(c.present, c.present + c.absent) + '%';
          });
          return [dayName(d), fmtShort(d), ...(multi(r) ? cells : [pr]), ab, pct(pr, pr + ab)];
        }),
        rateCols: [multi(r) ? n + 3 : 4],
        absentCols: [multi(r) ? n + 2 : 3],
      },
    });
  }

  const n = slots.length;
  sections.push({
    heading: t('sec_students_stats'),
    sheet: t('nav_students'),
    table: {
      head: [
        t('c_serial'),
        t('c_name'),
        t('c_class'),
        ...(multi(r) ? slots.map((p) => t('c_absent_in', { slot: slotName(p) })) : []),
        t('c_present'),
        t('c_absent'),
        t('c_excused'),
        t('c_rate'),
        ...(multi(r) ? [t('c_most_missed')] : []),
      ],
      rows: r.byStudent.map((s) => [
        s.student.serial,
        s.student.name,
        s.className,
        ...(multi(r) ? slots.map((p) => s.perSlotAbsent[p]) : []),
        s.present,
        s.absent,
        s.excused,
        s.recorded ? s.rate : '—',
        ...(multi(r) ? [slotName(s.mostMissed)] : []),
      ]),
      rateCols: [multi(r) ? n + 6 : 6],
      absentCols: [multi(r) ? n + 4 : 4],
    },
  });
  const top = mostAbsent(r, 10);
  if (top.length)
    sections.push({
      heading: t('sec_most_absent'),
      sheet: t('sec_most_absent'),
      table: {
        head: [t('c_rank'), t('c_name'), t('c_class'), t('c_absences'), t('c_rate'), ...(multi(r) ? [t('c_most_missed')] : [])],
        rows: top.map((s, i) => [i + 1, s.student.name, s.className, s.absent, s.rate, ...(multi(r) ? [slotName(s.mostMissed)] : [])]),
        rateCols: [4],
        absentCols: [3],
      },
    });
  const best = mostCommitted(r, 10);
  if (best.length)
    sections.push({
      heading: t('sec_most_committed'),
      sheet: t('sec_most_committed'),
      table: { head: [t('c_rank'), t('c_name'), t('c_class'), t('c_times_present'), t('c_rate')], rows: best.map((s, i) => [i + 1, s.student.name, s.className, s.present, s.rate]), rateCols: [4] },
    });

  return {
    title: `${title} — ${gName(r)}`,
    subtitle: `${t('range', { from: fmtDate(from, false), to: fmtDate(to, false) })} — ${scopeLabel(r)}`,
    org,
    sections,
    fileBase: `${title}_${from}_${to}`,
  };
}

/** التقرير التفصيلي لطالب */
export function studentDoc(r: Report, org?: string): ReportDoc {
  const s = r.byStudent[0];
  const slots = r.scope.slots;
  const sections: DocSection[] = [];
  if (!s) return { title: t('r_student'), subtitle: '', sections, fileBase: t('file_student') };
  sections.push({
    heading: t('sec_student_info'),
    sheet: t('sheet_summary'),
    kpis: [
      { label: t('k_name'), value: s.student.name },
      { label: t('k_class'), value: s.className },
      { label: t('k_serial'), value: s.student.serial },
      { label: t('k_phone'), value: s.student.phone || '—' },
    ],
  });
  sections.push({
    heading: t('sec_commit_summary'),
    kpis: [
      { label: t('times_present'), value: s.present, tone: 'ok' },
      { label: t('times_absent'), value: s.absent, tone: 'bad' },
      { label: t('c_excused'), value: s.excused },
      { label: t('rate_commit'), value: s.rate + '%', tone: s.rate >= 80 ? 'ok' : 'bad' },
      ...(multi(r) ? [{ label: t('most_missed'), value: slotName(s.mostMissed) }] : []),
    ],
  });
  if (multi(r))
    sections.push({
      heading: t('absence_by_slot'),
      sheet: t('sec_by_slot'),
      table: {
        head: [t('c_slot'), t('c_recorded'), t('c_absent'), t('c_rate')],
        rows: slots.map((p) => [slotName(p), s.perSlotRecorded[p], s.perSlotAbsent[p], s.perSlotRecorded[p] ? pct(s.perSlotRecorded[p] - s.perSlotAbsent[p], s.perSlotRecorded[p]) : '—']),
        rateCols: [3],
        absentCols: [2],
      },
    });
  sections.push({
    heading: t('sec_absence_log'),
    sheet: t('sec_absence_log'),
    table: {
      head: [t('c_day'), t('c_date'), ...(multi(r) ? [t('c_slot')] : []), t('c_status'), t('c_note')],
      rows: s.absences.map((a) => [dayName(a.date), fmtShort(a.date), ...(multi(r) ? [slotName(a.prayer)] : []), a.excused ? t('excused_s') : t('unexcused_s'), a.note ?? '']),
    },
    text: s.absences.length ? undefined : t('no_absence'),
  });
  return {
    title: `${t('r_student')} — ${gName(r)}`,
    subtitle: `${s.student.name} — ${t('range', { from: fmtDate(r.scope.from, false), to: fmtDate(r.scope.to, false) })}`,
    org,
    sections,
    fileBase: `${t('file_student')}_${s.student.name}`,
  };
}
