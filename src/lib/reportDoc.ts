import { PRAYERS, PRAYER_NAMES, type Prayer } from '../db/schema';
import { daysBetween, fmtDate, fmtShort, dayName, hijri, pct } from './dates';
import { mostAbsent, mostCommitted, type Report } from './stats';

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

const pname = (p: Prayer | null) => (p ? PRAYER_NAMES[p] : '—');

function prayerTable(r: Report): DocTable {
  return {
    head: ['الصلاة', 'المسجَّلون', 'الحاضرون', 'الغائبون', 'منهم بعذر', 'نسبة الحضور %'],
    rows: r.byPrayer.map((p) => [PRAYER_NAMES[p.prayer], p.recorded, p.present, p.absent, p.excused, p.recorded ? p.rate : '—']),
    rateCols: [5],
    absentCols: [3],
  };
}

function kpis(r: Report): DocSection['kpis'] {
  return [
    { label: 'عدد الطلاب', value: r.totals.students },
    { label: 'مرات الحضور', value: r.totals.present, tone: 'ok' },
    { label: 'مرات الغياب', value: r.totals.absent, tone: 'bad' },
    { label: 'نسبة الحضور', value: r.totals.rate + '%', tone: r.totals.rate >= 80 ? 'ok' : 'bad' },
  ];
}

function scopeLabel(r: Report): string {
  const ids = r.scope.classIds;
  if (!ids || !ids.length) return 'جميع الصفوف';
  return ids.map((id) => r.classMap.get(id)?.name ?? '').join('، ');
}

/** التقرير اليومي الشامل للصلوات الخمس */
export function dailyDoc(r: Report, date: string, org?: string): ReportDoc {
  const day = r.byDate.get(date) ?? {};
  const sections: DocSection[] = [];
  sections.push({ heading: 'ملخص اليوم', sheet: 'ملخص', kpis: kpis(r) });
  sections.push({ heading: 'الحضور حسب الصلاة', sheet: 'حسب الصلاة', table: prayerTable(r) });

  const absentRows: Cell[][] = [];
  for (const p of PRAYERS) {
    const ids = day[p]?.absentIds ?? [];
    for (const id of ids) {
      const s = r.studentMap.get(id);
      const rec = r.records.find((x) => x.studentId === id && x.prayer === p && x.date === date);
      absentRows.push([PRAYER_NAMES[p], s?.serial ?? '', s?.name ?? '', r.classMap.get(rec?.classId ?? '')?.name ?? '', rec?.excused ? 'بعذر' : 'بدون عذر', rec?.note ?? '']);
    }
  }
  sections.push({
    heading: 'أسماء الغائبين في كل صلاة',
    sheet: 'الغائبون',
    table: { head: ['الصلاة', 'الرقم', 'اسم الطالب', 'الصف', 'الحالة', 'ملاحظة'], rows: absentRows },
    text: absentRows.length ? undefined : 'لا يوجد غائبون — الحمد لله.',
  });

  const perStudent = r.byStudent
    .filter((s) => s.absent > 0)
    .sort((a, b) => b.absent - a.absent || a.student.serial - b.student.serial)
    .map((s) => [s.student.serial, s.student.name, s.className, s.absent, PRAYERS.filter((p) => s.perPrayerAbsent[p]).map((p) => PRAYER_NAMES[p]).join('، ')]);
  sections.push({
    heading: 'عدد مرات غياب كل طالب خلال اليوم',
    sheet: 'غياب الطلاب',
    table: { head: ['الرقم', 'اسم الطالب', 'الصف', 'مرات الغياب', 'الصلوات الفائتة'], rows: perStudent, absentCols: [3] },
    text: perStudent.length ? undefined : 'لا يوجد.',
  });

  const notRecorded = PRAYERS.filter((p) => !day[p]);
  if (notRecorded.length && notRecorded.length < 5)
    sections.push({ heading: 'تنبيه', text: 'صلوات لم يُسجَّل حضورها بعد: ' + notRecorded.map((p) => PRAYER_NAMES[p]).join('، ') });

  return {
    title: 'التقرير اليومي لحضور الصلوات',
    subtitle: `${fmtDate(date)} — ${hijri(date)} — ${scopeLabel(r)}`,
    org,
    sections,
    fileBase: `تقرير_يومي_${date}`,
  };
}

/** التقارير الدورية (أسبوعي/شهري/فترة) لصف أو لجميع الصفوف */
export function periodDoc(r: Report, title: string, org?: string): ReportDoc {
  const { from, to } = r.scope;
  const sections: DocSection[] = [];
  sections.push({ heading: 'الملخص العام', sheet: 'ملخص', kpis: kpis(r) });
  sections.push({ heading: 'الحضور حسب الصلاة', sheet: 'حسب الصلاة', table: prayerTable(r) });
  if (r.byClass.length > 1)
    sections.push({
      heading: 'الحضور حسب الصف',
      sheet: 'حسب الصف',
      table: { head: ['الصف', 'الطلاب', 'الحضور', 'الغياب', 'النسبة %'], rows: r.byClass.map((c) => [c.cls.name, c.students, c.present, c.absent, c.rate]), rateCols: [4], absentCols: [3] },
    });

  // ملخص يومي
  const days = daysBetween(from, to).filter((d) => r.byDate.has(d));
  if (days.length)
    sections.push({
      heading: 'نسبة الحضور اليومية',
      sheet: 'يومي',
      table: {
        head: ['اليوم', 'التاريخ', ...PRAYERS.map((p) => PRAYER_NAMES[p]), 'الغياب', 'النسبة %'],
        rows: days.map((d) => {
          const day = r.byDate.get(d)!;
          let pr = 0,
            ab = 0;
          const cells = PRAYERS.map((p) => {
            const c = day[p];
            if (!c) return '—';
            pr += c.present;
            ab += c.absent;
            return pct(c.present, c.present + c.absent) + '%';
          });
          return [dayName(d), fmtShort(d), ...cells, ab, pct(pr, pr + ab)];
        }),
        rateCols: [8],
        absentCols: [7],
      },
    });

  sections.push({
    heading: 'إحصائية الطلاب',
    sheet: 'الطلاب',
    table: {
      head: ['الرقم', 'اسم الطالب', 'الصف', ...PRAYERS.map((p) => 'غياب ' + PRAYER_NAMES[p]), 'الحضور', 'الغياب', 'بعذر', 'الالتزام %', 'أكثر صلاة غيابًا'],
      rows: r.byStudent.map((s) => [
        s.student.serial,
        s.student.name,
        s.className,
        ...PRAYERS.map((p) => s.perPrayerAbsent[p]),
        s.present,
        s.absent,
        s.excused,
        s.recorded ? s.rate : '—',
        pname(s.mostMissed),
      ]),
      rateCols: [11],
      absentCols: [9],
    },
  });
  const top = mostAbsent(r, 10);
  if (top.length)
    sections.push({
      heading: 'الطلاب الأكثر غيابًا',
      sheet: 'الأكثر غيابا',
      table: { head: ['#', 'اسم الطالب', 'الصف', 'مرات الغياب', 'الالتزام %', 'أكثر صلاة غيابًا'], rows: top.map((s, i) => [i + 1, s.student.name, s.className, s.absent, s.rate, pname(s.mostMissed)]), rateCols: [4], absentCols: [3] },
    });
  const best = mostCommitted(r, 10);
  if (best.length)
    sections.push({
      heading: 'الطلاب الأكثر التزامًا',
      sheet: 'الأكثر التزاما',
      table: { head: ['#', 'اسم الطالب', 'الصف', 'مرات الحضور', 'الالتزام %'], rows: best.map((s, i) => [i + 1, s.student.name, s.className, s.present, s.rate]), rateCols: [4] },
    });

  return {
    title,
    subtitle: `من ${fmtDate(from, false)} إلى ${fmtDate(to, false)} — ${scopeLabel(r)}`,
    org,
    sections,
    fileBase: `${title.replace(/\s+/g, '_')}_${from}_${to}`,
  };
}

/** التقرير التفصيلي لطالب */
export function studentDoc(r: Report, org?: string): ReportDoc {
  const s = r.byStudent[0];
  const sections: DocSection[] = [];
  if (!s) return { title: 'تقرير طالب', subtitle: '', sections, fileBase: 'طالب' };
  sections.push({
    heading: 'بيانات الطالب',
    sheet: 'ملخص',
    kpis: [
      { label: 'الاسم', value: s.student.name },
      { label: 'الصف', value: s.className },
      { label: 'الرقم', value: s.student.serial },
      { label: 'الجوال', value: s.student.phone || '—' },
    ],
  });
  sections.push({
    heading: 'ملخص الالتزام',
    kpis: [
      { label: 'مرات الحضور', value: s.present, tone: 'ok' },
      { label: 'مرات الغياب', value: s.absent, tone: 'bad' },
      { label: 'منها بعذر', value: s.excused },
      { label: 'نسبة الالتزام', value: s.rate + '%', tone: s.rate >= 80 ? 'ok' : 'bad' },
      { label: 'أكثر صلاة غيابًا', value: pname(s.mostMissed) },
    ],
  });
  sections.push({
    heading: 'الغياب حسب الصلاة',
    sheet: 'حسب الصلاة',
    table: {
      head: ['الصلاة', 'المسجَّل', 'الغياب', 'الالتزام %'],
      rows: PRAYERS.map((p) => [PRAYER_NAMES[p], s.perPrayerRecorded[p], s.perPrayerAbsent[p], s.perPrayerRecorded[p] ? pct(s.perPrayerRecorded[p] - s.perPrayerAbsent[p], s.perPrayerRecorded[p]) : '—']),
      rateCols: [3],
      absentCols: [2],
    },
  });
  sections.push({
    heading: 'سجل الغياب بالتواريخ',
    sheet: 'سجل الغياب',
    table: { head: ['اليوم', 'التاريخ', 'الصلاة', 'الحالة', 'ملاحظة'], rows: s.absences.map((a) => [dayName(a.date), fmtShort(a.date), PRAYER_NAMES[a.prayer], a.excused ? 'بعذر' : 'بدون عذر', a.note ?? '']) },
    text: s.absences.length ? undefined : 'لا يوجد غياب في هذه الفترة.',
  });
  return {
    title: 'التقرير التفصيلي للطالب',
    subtitle: `${s.student.name} — من ${fmtDate(r.scope.from, false)} إلى ${fmtDate(r.scope.to, false)}`,
    org,
    sections,
    fileBase: `تقرير_${s.student.name.replace(/\s+/g, '_')}`,
  };
}
