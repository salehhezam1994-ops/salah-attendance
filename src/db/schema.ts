import Dexie, { type Table } from 'dexie';

/** الصلوات الخمس بالترتيب */
export const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type Prayer = (typeof PRAYERS)[number];
export const PRAYER_NAMES: Record<Prayer, string> = {
  fajr: 'الفجر',
  dhuhr: 'الظهر',
  asr: 'العصر',
  maghrib: 'المغرب',
  isha: 'العشاء',
};

export type Status = 'P' | 'A'; // P = حاضر ، A = غائب

export interface ClassRoom {
  id: string;
  name: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface Student {
  id: string;
  name: string;
  classId: string;
  serial: number; // الرقم التسلسلي
  phone?: string;
  active: 1 | 0; // 0 = مؤرشف (لا يظهر في التسجيل لكن يبقى سجله)
  createdAt: number;
  updatedAt: number;
}

/** سجل حضور طالب في صلاة واحدة في يوم واحد */
export interface Attendance {
  id: string; // `${date}|${prayer}|${studentId}` — يضمن سجلًا واحدًا فقط
  date: string; // YYYY-MM-DD
  prayer: Prayer;
  studentId: string;
  classId: string; // صف الطالب وقت التسجيل (حتى لا تتغير التقارير القديمة عند نقل الطالب)
  status: Status;
  excused?: 1 | 0; // غياب بعذر
  note?: string;
  updatedAt: number;
  by?: string; // معرّف المستخدم الذي سجّل
}

export interface Permissions {
  allClasses: boolean;
  classIds: string[];
  viewReports: boolean;
  exportReports: boolean;
  editPastDays: boolean; // تعديل حضور الأيام السابقة
}

export interface User {
  id: string;
  name: string;
  role: 'admin' | 'supervisor';
  pinHash: string;
  perms: Permissions;
  active: 1 | 0;
  createdAt: number;
  updatedAt?: number;
}

export interface Setting {
  key: string;
  value: unknown;
  updatedAt?: number;
}

/** قائمة التغييرات المحلية التي لم تُرفع بعد إلى السحابة */
export interface OutboxItem {
  key: string; // `${table}|${id}`
  table: SyncTable;
  id: string;
  at: number;
}
export const SYNC_TABLES = ['classes', 'students', 'attendance', 'users', 'settings'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
/** إعدادات خاصة بالجهاز لا تُزامَن */
export const LOCAL_SETTINGS = new Set(['syncSchool', 'syncCursor', 'lastBackup', 'syncLast']);

export class AppDB extends Dexie {
  classes!: Table<ClassRoom, string>;
  students!: Table<Student, string>;
  attendance!: Table<Attendance, string>;
  users!: Table<User, string>;
  settings!: Table<Setting, string>;
  outbox!: Table<OutboxItem, string>;

  constructor() {
    super('salah_attendance');
    this.version(1).stores({
      classes: 'id, order, name',
      students: 'id, classId, serial, name, active',
      attendance: 'id, date, studentId, classId, [date+prayer], [date+prayer+classId], [studentId+date]',
      users: 'id, role',
      settings: 'key',
    });
    this.version(2).stores({ outbox: 'key, at' });
  }
}

export const db = new AppDB();

export const FULL_PERMS: Permissions = {
  allClasses: true,
  classIds: [],
  viewReports: true,
  exportReports: true,
  editPastDays: true,
};

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export const attId = (date: string, prayer: Prayer, studentId: string) => `${date}|${prayer}|${studentId}`;
