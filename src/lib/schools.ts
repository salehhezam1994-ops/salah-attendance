/**
 * عدة مدارس على جهاز واحد: لكل مدرسة قاعدة بيانات محلية منفصلة تمامًا
 * (الطلاب والحضور والمستخدمون ورمز المزامنة)، والتبديل يعيد تحميل التطبيق.
 */
export interface SchoolProfile {
  id: string;
  name: string;
}

const LIST = 'salah.schools';
const CUR = 'salah.school';
export const DEFAULT_SCHOOL = 'default';

function read<T>(k: string, def: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export function listSchools(): SchoolProfile[] {
  const l = read<SchoolProfile[]>(LIST, []);
  return l.some((s) => s.id === DEFAULT_SCHOOL) ? l : [{ id: DEFAULT_SCHOOL, name: '' }, ...l];
}
export function currentSchool(): string {
  const id = read<string>(CUR, DEFAULT_SCHOOL);
  return listSchools().some((s) => s.id === id) ? id : DEFAULT_SCHOOL;
}
/** اسم قاعدة البيانات: الأولى تبقى بالاسم القديم حتى لا تضيع بيانات المستخدمين الحاليين */
export const dbNameFor = (id: string) => (id === DEFAULT_SCHOOL ? 'salah_attendance' : `salah_attendance_${id}`);
export const sessionKey = () => (currentSchool() === DEFAULT_SCHOOL ? 'salah.session' : `salah.session.${currentSchool()}`);

export function renameSchool(id: string, name: string) {
  const l = listSchools();
  const s = l.find((x) => x.id === id);
  if (!s || s.name === name) return;
  s.name = name;
  write(LIST, l);
}
export function switchSchool(id: string) {
  write(CUR, id);
  location.reload();
}
export function addSchool(): string {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  write(LIST, [...listSchools(), { id, name: '' }]);
  return id;
}
/** حذف مدرسة من هذا الجهاز فقط (لا يمس نسختها في السحابة) */
export async function removeSchool(id: string) {
  if (id === currentSchool()) return;
  write(
    LIST,
    listSchools().filter((s) => s.id !== id),
  );
  try {
    localStorage.removeItem(id === DEFAULT_SCHOOL ? 'salah.session' : `salah.session.${id}`);
  } catch {
    /* ignore */
  }
  const { default: Dexie } = await import('dexie');
  await Dexie.delete(dbNameFor(id));
}
