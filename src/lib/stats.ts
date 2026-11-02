import { db, PRAYERS, type Attendance, type ClassRoom, type Prayer, type Student } from '../db/schema';
import { pct } from './dates';

export interface Scope {
  from: string;
  to: string;
  classIds?: string[] | null; // null = جميع الصفوف
  studentId?: string | null;
  prayers?: Prayer[] | null;
}

export interface StudentStat {
  student: Student;
  className: string;
  present: number;
  absent: number;
  excused: number; // ضمن الغياب
  recorded: number;
  rate: number; // نسبة الالتزام %
  perPrayerAbsent: Record<Prayer, number>;
  perPrayerRecorded: Record<Prayer, number>;
  mostMissed: Prayer | null;
  absences: Attendance[];
}

export interface PrayerStat {
  prayer: Prayer;
  recorded: number;
  present: number;
  absent: number;
  excused: number;
  rate: number;
}

export interface DayPrayerCell {
  present: number;
  absent: number;
  absentIds: string[];
}

export interface Report {
  scope: Scope;
  records: Attendance[];
  students: Student[];
  classes: ClassRoom[];
  classMap: Map<string, ClassRoom>;
  studentMap: Map<string, Student>;
  totals: { students: number; recorded: number; present: number; absent: number; excused: number; rate: number };
  byPrayer: PrayerStat[];
  byStudent: StudentStat[];
  byDate: Map<string, Partial<Record<Prayer, DayPrayerCell>>>;
  byClass: { cls: ClassRoom; students: number; present: number; absent: number; rate: number }[];
}

const emptyPrayerRec = (): Record<Prayer, number> => ({ fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 });

export async function buildReport(scope: Scope): Promise<Report> {
  const [classes, allStudents] = await Promise.all([db.classes.orderBy('order').toArray(), db.students.toArray()]);
  let records: Attendance[];
  if (scope.studentId) {
    records = await db.attendance
      .where('[studentId+date]')
      .between([scope.studentId, scope.from], [scope.studentId, scope.to], true, true)
      .toArray();
  } else {
    records = await db.attendance.where('date').between(scope.from, scope.to, true, true).toArray();
  }
  const classSet = scope.classIds && scope.classIds.length ? new Set(scope.classIds) : null;
  const prayerSet = scope.prayers && scope.prayers.length ? new Set(scope.prayers) : null;
  if (classSet) records = records.filter((r) => classSet.has(r.classId));
  if (prayerSet) records = records.filter((r) => prayerSet.has(r.prayer));

  const classMap = new Map(classes.map((c) => [c.id, c]));
  const studentMap = new Map(allStudents.map((s) => [s.id, s]));

  // الطلاب ضمن النطاق: النشطون في الصفوف المحددة + أي طالب له سجل في الفترة
  const inScope = new Map<string, Student>();
  if (scope.studentId) {
    const s = studentMap.get(scope.studentId);
    if (s) inScope.set(s.id, s);
  } else {
    for (const s of allStudents) if (s.active && (!classSet || classSet.has(s.classId))) inScope.set(s.id, s);
    for (const r of records) {
      const s = studentMap.get(r.studentId);
      if (s && !inScope.has(s.id)) inScope.set(s.id, s);
    }
  }
  const students = [...inScope.values()].sort(
    (a, b) => (classMap.get(a.classId)?.order ?? 0) - (classMap.get(b.classId)?.order ?? 0) || a.serial - b.serial,
  );

  const stMap = new Map<string, StudentStat>();
  for (const s of students) {
    stMap.set(s.id, {
      student: s,
      className: classMap.get(s.classId)?.name ?? '—',
      present: 0,
      absent: 0,
      excused: 0,
      recorded: 0,
      rate: 0,
      perPrayerAbsent: emptyPrayerRec(),
      perPrayerRecorded: emptyPrayerRec(),
      mostMissed: null,
      absences: [],
    });
  }
  const pMap = new Map<Prayer, PrayerStat>(PRAYERS.map((p) => [p, { prayer: p, recorded: 0, present: 0, absent: 0, excused: 0, rate: 0 }]));
  const byDate = new Map<string, Partial<Record<Prayer, DayPrayerCell>>>();
  const classAgg = new Map<string, { present: number; absent: number; students: Set<string> }>();

  let present = 0,
    absent = 0,
    excused = 0;
  for (const r of records) {
    const st = stMap.get(r.studentId);
    if (!st) continue;
    const ps = pMap.get(r.prayer)!;
    ps.recorded++;
    st.recorded++;
    st.perPrayerRecorded[r.prayer]++;
    let day = byDate.get(r.date);
    if (!day) byDate.set(r.date, (day = {}));
    const cell = (day[r.prayer] ??= { present: 0, absent: 0, absentIds: [] });
    let ca = classAgg.get(r.classId);
    if (!ca) classAgg.set(r.classId, (ca = { present: 0, absent: 0, students: new Set() }));
    ca.students.add(r.studentId);
    if (r.status === 'P') {
      present++;
      ps.present++;
      st.present++;
      cell.present++;
      ca.present++;
    } else {
      absent++;
      ps.absent++;
      st.absent++;
      st.perPrayerAbsent[r.prayer]++;
      st.absences.push(r);
      cell.absent++;
      cell.absentIds.push(r.studentId);
      ca.absent++;
      if (r.excused) {
        excused++;
        ps.excused++;
        st.excused++;
      }
    }
  }
  for (const ps of pMap.values()) ps.rate = pct(ps.present, ps.recorded);
  for (const st of stMap.values()) {
    st.rate = pct(st.present, st.recorded);
    let best: Prayer | null = null;
    for (const p of PRAYERS) if (st.perPrayerAbsent[p] > 0 && (!best || st.perPrayerAbsent[p] > st.perPrayerAbsent[best])) best = p;
    st.mostMissed = best;
    st.absences.sort((a, b) => (a.date === b.date ? PRAYERS.indexOf(a.prayer) - PRAYERS.indexOf(b.prayer) : a.date < b.date ? 1 : -1));
  }
  const byClass = classes
    .filter((c) => classAgg.has(c.id))
    .map((c) => {
      const a = classAgg.get(c.id)!;
      return { cls: c, students: a.students.size, present: a.present, absent: a.absent, rate: pct(a.present, a.present + a.absent) };
    });

  return {
    scope,
    records,
    students,
    classes,
    classMap,
    studentMap,
    totals: { students: students.length, recorded: present + absent, present, absent, excused, rate: pct(present, present + absent) },
    byPrayer: [...pMap.values()],
    byStudent: [...stMap.values()],
    byDate,
    byClass,
  };
}

/** الطلاب الأكثر غيابًا (بعدد مرات الغياب) */
export function mostAbsent(r: Report, n = 10) {
  return r.byStudent.filter((s) => s.absent > 0).sort((a, b) => b.absent - a.absent || a.rate - b.rate).slice(0, n);
}
/** الأكثر التزامًا (أعلى نسبة ثم أكثر عدد حضور) */
export function mostCommitted(r: Report, n = 10) {
  return r.byStudent.filter((s) => s.recorded > 0).sort((a, b) => b.rate - a.rate || b.present - a.present).slice(0, n);
}
