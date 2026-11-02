import { db, type Attendance, type ClassRoom, type Slot, type Student } from '../db/schema';
import { pct } from './dates';

export interface Scope {
  from: string;
  to: string;
  slots: Slot[]; // الأوقات المشمولة (الصلوات الخمس أو نشاط واحد)
  classIds?: string[] | null; // null = جميع الصفوف
  studentId?: string | null;
}

export interface StudentStat {
  student: Student;
  className: string;
  present: number;
  absent: number;
  excused: number; // ضمن الغياب
  recorded: number;
  rate: number; // نسبة الالتزام %
  perSlotAbsent: Record<Slot, number>;
  perSlotRecorded: Record<Slot, number>;
  mostMissed: Slot | null;
  absences: Attendance[];
}

export interface SlotStat {
  slot: Slot;
  recorded: number;
  present: number;
  absent: number;
  excused: number;
  rate: number;
}

export interface DayCell {
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
  bySlot: SlotStat[];
  byStudent: StudentStat[];
  byDate: Map<string, Partial<Record<Slot, DayCell>>>;
  byClass: { cls: ClassRoom; students: number; present: number; absent: number; rate: number }[];
}

const zero = (slots: Slot[]) => Object.fromEntries(slots.map((s) => [s, 0])) as Record<Slot, number>;

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
  const slotSet = new Set(scope.slots);
  const classSet = scope.classIds && scope.classIds.length ? new Set(scope.classIds) : null;
  records = records.filter((r) => slotSet.has(r.prayer) && (!classSet || classSet.has(r.classId)));

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
      perSlotAbsent: zero(scope.slots),
      perSlotRecorded: zero(scope.slots),
      mostMissed: null,
      absences: [],
    });
  }
  const pMap = new Map<Slot, SlotStat>(scope.slots.map((p) => [p, { slot: p, recorded: 0, present: 0, absent: 0, excused: 0, rate: 0 }]));
  const byDate = new Map<string, Partial<Record<Slot, DayCell>>>();
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
    st.perSlotRecorded[r.prayer]++;
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
      st.perSlotAbsent[r.prayer]++;
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
  const order = (s: Slot) => scope.slots.indexOf(s);
  for (const st of stMap.values()) {
    st.rate = pct(st.present, st.recorded);
    let best: Slot | null = null;
    for (const p of scope.slots) if (st.perSlotAbsent[p] > 0 && (!best || st.perSlotAbsent[p] > st.perSlotAbsent[best])) best = p;
    st.mostMissed = scope.slots.length > 1 ? best : null;
    st.absences.sort((a, b) => (a.date === b.date ? order(a.prayer) - order(b.prayer) : a.date < b.date ? 1 : -1));
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
    bySlot: [...pMap.values()],
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
