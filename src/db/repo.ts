import { normCard } from '../lib/card';
import { db, uid, attId, FULL_PERMS, LOCAL_SETTINGS, activitySlot, type Activity, type Attendance, type ClassRoom, type Slot, type Student, type User, type Permissions } from './schema';
import { t } from '../i18n';

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
    if (studs.length && !moveStudentsTo) throw new Error(t('err_class_has_students'));
    if (moveStudentsTo) for (const s of studs) await db.students.update(s.id, { classId: moveStudentsTo, updatedAt: Date.now() });
    await db.classes.delete(id);
  });
}

// ---------- الأنشطة ----------
export async function addActivity(name: string) {
  const max = await db.activities.orderBy('order').last();
  const a: Activity = { id: uid(), name: name.trim(), order: (max?.order ?? 0) + 1, active: 1, createdAt: Date.now(), updatedAt: Date.now() };
  await db.activities.add(a);
  return a;
}
export async function renameActivity(id: string, name: string) {
  await db.activities.update(id, { name: name.trim() });
}
export async function moveActivityOrder(id: string, dir: -1 | 1) {
  const list = await db.activities.orderBy('order').toArray();
  const i = list.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  await db.transaction('rw', db.activities, async () => {
    await db.activities.update(list[i].id, { order: list[j].order });
    await db.activities.update(list[j].id, { order: list[i].order });
  });
}
/** حذف نشاط مع كل سجلات حضوره */
export async function deleteActivity(id: string) {
  const slot = activitySlot(id);
  await db.transaction('rw', db.activities, db.attendance, async () => {
    await db.attendance.filter((r) => r.prayer === slot).delete();
    await db.activities.delete(id);
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
    await db.students.update(s.id, { name: s.name.trim(), classId: s.classId, serial: s.serial, phone: s.phone?.trim() || undefined, card: s.card || undefined, updatedAt: now });
    return s.id;
  }
  const st: Student = {
    id: uid(),
    name: s.name.trim(),
    classId: s.classId,
    serial: s.serial ?? (await nextSerial()),
    phone: s.phone?.trim() || undefined,
    card: s.card || undefined,
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
  card?: string;
}
/** استيراد جماعي: ينشئ الصفوف غير الموجودة تلقائيًا، ويتجاهل الأسماء المكررة في نفس الصف */
/** linkOnly: ملف أرقام بطاقات بلا عمود صف ← نربط البطاقات للطلاب الموجودين فقط ولا نضيف أحدًا */
export async function importStudents(rows: ImportRow[], defaultClassId: string | null, linkOnly = false) {
  let added = 0,
    skipped = 0,
    linked = 0,
    createdClasses = 0;
  await db.transaction('rw', db.classes, db.students, async () => {
    const classes = await db.classes.toArray();
    // مطابقة أسماء الصفوف مع تجاهل المسافات وحالة الأحرف وأشكال الألف
    const ck = (n: string) => n.replace(/\s+/g, ' ').trim().replace(/[أإآ]/g, 'ا').toLocaleLowerCase('tr');
    const byName = new Map(classes.map((c) => [ck(c.name), c.id]));
    const existing = await db.students.toArray();
    const key = (n: string, c: string) => n.replace(/\s+/g, ' ').trim() + '::' + c;
    const seen = new Set(existing.map((s) => key(s.name, s.classId)));
    const usedSerials = new Set(existing.map((s) => s.serial));
    let serial = Math.max(0, ...existing.map((s) => s.serial)) + 1;
    let order = Math.max(0, ...classes.map((c) => c.order));
    const nk = (n: string) => n.replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr');
    const byStudentName = new Map<string, Student[]>();
    for (const s of existing) byStudentName.set(nk(s.name), [...(byStudentName.get(nk(s.name)) ?? []), s]);
    const cardOwner = new Map(existing.filter((s) => s.card).map((s) => [s.card!, s.id]));
    for (const r of rows) {
      const name = r.name.replace(/\s+/g, ' ').trim();
      if (!name) continue;
      const card = r.card ? normCard(r.card) : '';
      // ملف أرقام البطاقات: إن كان الطالب موجودًا (اسم فريد) نربط بطاقته فقط
      const same = byStudentName.get(nk(name));
      if (card && same?.length === 1 && (linkOnly || !r.className)) {
        const st = same[0];
        const owner = cardOwner.get(card);
        if (st.card !== card && (!owner || owner === st.id)) {
          await db.students.update(st.id, { card, updatedAt: Date.now() });
          cardOwner.set(card, st.id);
          linked++;
        }
        continue;
      }
      if (linkOnly) {
        skipped++;
        continue;
      }
      let classId = defaultClassId;
      if (r.className?.trim()) {
        const cn = r.className.trim();
        classId = byName.get(ck(cn)) ?? null;
        if (!classId) {
          const c: ClassRoom = { id: uid(), name: cn, order: ++order, createdAt: Date.now(), updatedAt: Date.now() };
          await db.classes.add(c);
          byName.set(ck(cn), c.id);
          classId = c.id;
          createdClasses++;
        }
      }
      if (!classId) {
        skipped++;
        continue;
      }
      if (seen.has(key(name, classId))) {
        const st = card ? existing.find((x) => key(x.name, x.classId) === key(name, classId!)) : undefined;
        if (st && st.card !== card && !cardOwner.has(card)) {
          await db.students.update(st.id, { card, updatedAt: Date.now() });
          cardOwner.set(card, st.id);
          linked++;
        } else skipped++;
        continue;
      }
      seen.add(key(name, classId));
      let s = r.serial && !usedSerials.has(r.serial) ? r.serial : 0;
      if (!s) {
        while (usedSerials.has(serial)) serial++;
        s = serial++;
      }
      usedSerials.add(s);
      const useCard = card && !cardOwner.has(card) ? card : undefined;
      const nid = uid();
      if (useCard) (cardOwner.set(useCard, nid), linked++);
      await db.students.add({ id: nid, name, classId, serial: s, phone: r.phone?.trim() || undefined, card: useCard, active: 1, createdAt: Date.now(), updatedAt: Date.now() });
      added++;
    }
  });
  return { added, skipped, createdClasses, linked };
}

// ---------- الحضور ----------
export async function setStatus(date: string, prayer: Slot, student: Student, status: 'P' | 'A' | null, by?: string) {
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

export async function setNote(date: string, prayer: Slot, student: Student, note: string, excused: boolean, by?: string) {
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
export async function markAll(date: string, prayer: Slot, students: Student[], status: 'P' | 'A', overwrite: boolean, by?: string) {
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

export async function clearSession(date: string, prayer: Slot, students: Student[]) {
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
  const [classes, students, attendance, users, settings, activities] = await Promise.all([
    db.classes.toArray(),
    db.students.toArray(),
    db.attendance.toArray(),
    db.users.toArray(),
    db.settings.toArray(),
    db.activities.toArray(),
  ]);
  return JSON.stringify({ app: 'salah-attendance', version: 1, exportedAt: new Date().toISOString(), classes, students, attendance, users, activities, settings: settings.filter((x) => !LOCAL_SETTINGS.has(x.key)) });
}
export async function importBackup(json: string) {
  const data = JSON.parse(json);
  if (data.app !== 'salah-attendance') throw new Error(t('not_backup'));
  await db.transaction('rw', [db.classes, db.students, db.attendance, db.users, db.settings, db.activities], async () => {
    const keep = (await db.settings.toArray()).filter((x) => LOCAL_SETTINGS.has(x.key));
    await Promise.all([db.classes.clear(), db.students.clear(), db.attendance.clear(), db.users.clear(), db.settings.clear()]);
    await db.settings.bulkAdd(keep);
    await db.classes.bulkAdd(data.classes ?? []);
    await db.students.bulkAdd(data.students ?? []);
    await db.attendance.bulkAdd(data.attendance ?? []);
    await db.users.bulkAdd(data.users ?? []);
    if (data.activities) {
      await db.activities.clear();
      await db.activities.bulkAdd(data.activities);
    }
    await db.settings.bulkAdd((data.settings ?? []).filter((x: { key: string }) => !LOCAL_SETTINGS.has(x.key)));
  });
}

/**
 * تحديد جماعي لعدة صلوات/صفوف دفعة واحدة:
 * 'P' أو 'A' ← يُسجَّل لمن ليست هذه حالته (من له نفس الحالة يبقى سجله وملاحظته كما هي)
 * null ← حذف السجلات (إلغاء التحديد)
 * يرجع عدد السجلات التي تغيّرت فعلًا
 */
export async function bulkSet(date: string, slots: Slot[], students: Student[], status: 'P' | 'A' | null, by?: string) {
  let changed = 0;
  await db.transaction('rw', db.attendance, async () => {
    for (const slot of slots) {
      const ids = students.map((s) => attId(date, slot, s.id));
      const prev = await db.attendance.bulkGet(ids);
      if (status === null) {
        const del = ids.filter((_, i) => prev[i]);
        changed += del.length;
        if (del.length) await db.attendance.bulkDelete(del);
        continue;
      }
      const now = Date.now();
      const recs: Attendance[] = [];
      students.forEach((s, i) => {
        const p = prev[i];
        if (p?.status === status) return;
        recs.push({ id: ids[i], date, prayer: slot, studentId: s.id, classId: p?.classId ?? s.classId, status, excused: 0, updatedAt: now, by });
      });
      changed += recs.length;
      if (recs.length) await db.attendance.bulkPut(recs);
    }
  });
  return changed;
}
