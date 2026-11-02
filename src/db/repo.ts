import { db, uid, attId, FULL_PERMS, type Attendance, type ClassRoom, type Prayer, type Student, type User, type Permissions } from './schema';

// ---------- المستخدمون ----------
export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode('salah::' + pin);
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381;
  for (const b of data) h = ((h << 5) + h + b) | 0;
  return 'x' + (h >>> 0).toString(16);
}

export async function createUser(name: string, pin: string, role: User['role'], perms: Permissions = FULL_PERMS) {
  const u: User = { id: uid(), name: name.trim(), role, pinHash: await hashPin(pin), perms: role === 'admin' ? FULL_PERMS : perms, active: 1, createdAt: Date.now() };
  await db.users.add(u);
  return u;
}

export async function verifyPin(userId: string, pin: string): Promise<User | null> {
  const u = await db.users.get(userId);
  if (!u || !u.active) return null;
  return u.pinHash === (await hashPin(pin)) ? u : null;
}

// ---------- الصفوف ----------
export async function addClass(name: string) {
  const max = await db.classes.orderBy('order').last();
  const c: ClassRoom = { id: uid(), name: name.trim(), order: (max?.order ?? 0) + 1, createdAt: Date.now(), updatedAt: Date.now() };
  await db.classes.add(c);
  return c;
}
export async function renameClass(id: string, name: string) {
  await db.classes.update(id, { name: name.trim(), updatedAt: Date.now() });
}
export async function moveClassOrder(id: string, dir: -1 | 1) {
  const list = await db.classes.orderBy('order').toArray();
  const i = list.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  await db.transaction('rw', db.classes, async () => {
    await db.classes.update(list[i].id, { order: list[j].order });
    await db.classes.update(list[j].id, { order: list[i].order });
  });
}
/** حذف صف: يُسمح فقط إذا كان فارغًا من الطلاب النشطين أو عند تحديد صف بديل */
export async function deleteClass(id: string, moveStudentsTo?: string) {
  await db.transaction('rw', db.classes, db.students, async () => {
    const studs = await db.students.where('classId').equals(id).toArray();
    if (studs.length && !moveStudentsTo) throw new Error('الصف يحتوي على طلاب');
    if (moveStudentsTo) for (const s of studs) await db.students.update(s.id, { classId: moveStudentsTo, updatedAt: Date.now() });
    await db.classes.delete(id);
  });
}

// ---------- الطلاب ----------
export async function nextSerial(): Promise<number> {
  const last = await db.students.orderBy('serial').last();
  return (last?.serial ?? 0) + 1;
}
export async function saveStudent(s: Partial<Student> & { name: string; classId: string }) {
  const now = Date.now();
  if (s.id) {
    await db.students.update(s.id, { name: s.name.trim(), classId: s.classId, serial: s.serial, phone: s.phone?.trim() || undefined, updatedAt: now });
    return s.id;
  }
  const st: Student = {
    id: uid(),
    name: s.name.trim(),
    classId: s.classId,
    serial: s.serial ?? (await nextSerial()),
    phone: s.phone?.trim() || undefined,
    active: 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.students.add(st);
  return st.id;
}
export async function moveStudents(ids: string[], classId: string) {
  await db.students.where('id').anyOf(ids).modify({ classId, updatedAt: Date.now() });
}
export async function setStudentActive(id: string, active: boolean) {
  await db.students.update(id, { active: active ? 1 : 0, updatedAt: Date.now() });
}
/** حذف نهائي للطالب مع سجله */
export async function deleteStudent(id: string) {
  await db.transaction('rw', db.students, db.attendance, async () => {
    await db.attendance.where('studentId').equals(id).delete();
    await db.students.delete(id);
  });
}

export interface ImportRow {
  name: string;
  serial?: number;
  phone?: string;
  className?: string;
}
/** استيراد جماعي: ينشئ الصفوف غير الموجودة تلقائيًا، ويتجاهل الأسماء المكررة في نفس الصف */
export async function importStudents(rows: ImportRow[], defaultClassId: string | null) {
  let added = 0,
    skipped = 0,
    createdClasses = 0;
  await db.transaction('rw', db.classes, db.students, async () => {
    const classes = await db.classes.toArray();
    const byName = new Map(classes.map((c) => [c.name.trim(), c.id]));
    const existing = await db.students.toArray();
    const key = (n: string, c: string) => n.replace(/\s+/g, ' ').trim() + '::' + c;
    const seen = new Set(existing.map((s) => key(s.name, s.classId)));
    const usedSerials = new Set(existing.map((s) => s.serial));
    let serial = Math.max(0, ...existing.map((s) => s.serial)) + 1;
    let order = Math.max(0, ...classes.map((c) => c.order));
    for (const r of rows) {
      const name = r.name.replace(/\s+/g, ' ').trim();
      if (!name) continue;
      let classId = defaultClassId;
      if (r.className?.trim()) {
        const cn = r.className.trim();
        classId = byName.get(cn) ?? null;
        if (!classId) {
          const c: ClassRoom = { id: uid(), name: cn, order: ++order, createdAt: Date.now(), updatedAt: Date.now() };
          await db.classes.add(c);
          byName.set(cn, c.id);
          classId = c.id;
          createdClasses++;
        }
      }
      if (!classId) {
        skipped++;
        continue;
      }
      if (seen.has(key(name, classId))) {
        skipped++;
        continue;
      }
      seen.add(key(name, classId));
      let s = r.serial && !usedSerials.has(r.serial) ? r.serial : 0;
      if (!s) {
        while (usedSerials.has(serial)) serial++;
        s = serial++;
      }
      usedSerials.add(s);
      await db.students.add({ id: uid(), name, classId, serial: s, phone: r.phone?.trim() || undefined, active: 1, createdAt: Date.now(), updatedAt: Date.now() });
      added++;
    }
  });
  return { added, skipped, createdClasses };
}

// ---------- الحضور ----------
export async function setStatus(date: string, prayer: Prayer, student: Student, status: 'P' | 'A' | null, by?: string) {
  const id = attId(date, prayer, student.id);
  if (status === null) {
    await db.attendance.delete(id);
    return;
  }
  const prev = await db.attendance.get(id);
  const rec: Attendance = {
    id,
    date,
    prayer,
    studentId: student.id,
    classId: prev?.classId ?? student.classId,
    status,
    excused: status === 'A' ? prev?.excused ?? 0 : 0,
    note: status === 'A' ? prev?.note : undefined,
    updatedAt: Date.now(),
    by,
  };
  await db.attendance.put(rec);
}

export async function setNote(date: string, prayer: Prayer, student: Student, note: string, excused: boolean, by?: string) {
  const id = attId(date, prayer, student.id);
  const prev = await db.attendance.get(id);
  await db.attendance.put({
    id,
    date,
    prayer,
    studentId: student.id,
    classId: prev?.classId ?? student.classId,
    status: 'A',
    note: note.trim() || undefined,
    excused: excused ? 1 : 0,
    updatedAt: Date.now(),
    by,
  });
}

/** تحديد الجميع حاضرًا (لا يغيّر من سُجّل غيابه مسبقًا إلا إذا overwrite) */
export async function markAll(date: string, prayer: Prayer, students: Student[], status: 'P' | 'A', overwrite: boolean, by?: string) {
  await db.transaction('rw', db.attendance, async () => {
    const ids = students.map((s) => attId(date, prayer, s.id));
    const prev = await db.attendance.bulkGet(ids);
    const now = Date.now();
    const recs: Attendance[] = [];
    students.forEach((s, i) => {
      const p = prev[i];
      if (p && !overwrite) return;
      recs.push({ id: ids[i], date, prayer, studentId: s.id, classId: p?.classId ?? s.classId, status, excused: 0, updatedAt: now, by });
    });
    await db.attendance.bulkPut(recs);
  });
}

export async function clearSession(date: string, prayer: Prayer, students: Student[]) {
  await db.attendance.bulkDelete(students.map((s) => attId(date, prayer, s.id)));
}

// ---------- الإعدادات ----------
export async function getSetting<T>(key: string, def: T): Promise<T> {
  const s = await db.settings.get(key);
  return (s?.value as T) ?? def;
}
export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}

// ---------- النسخ الاحتياطي ----------
export async function exportBackup() {
  const [classes, students, attendance, users, settings] = await Promise.all([
    db.classes.toArray(),
    db.students.toArray(),
    db.attendance.toArray(),
    db.users.toArray(),
    db.settings.toArray(),
  ]);
  return JSON.stringify({ app: 'salah-attendance', version: 1, exportedAt: new Date().toISOString(), classes, students, attendance, users, settings });
}
export async function importBackup(json: string) {
  const data = JSON.parse(json);
  if (data.app !== 'salah-attendance') throw new Error('الملف ليس نسخة احتياطية لهذا التطبيق');
  await db.transaction('rw', [db.classes, db.students, db.attendance, db.users, db.settings], async () => {
    await Promise.all([db.classes.clear(), db.students.clear(), db.attendance.clear(), db.users.clear(), db.settings.clear()]);
    await db.classes.bulkAdd(data.classes ?? []);
    await db.students.bulkAdd(data.students ?? []);
    await db.attendance.bulkAdd(data.attendance ?? []);
    await db.users.bulkAdd(data.users ?? []);
    await db.settings.bulkAdd(data.settings ?? []);
  });
}
