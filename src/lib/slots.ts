import { useLiveQuery } from 'dexie-react-hooks';
import { db, PRAYERS, isPrayerSlot, activitySlot, type Activity, type Slot } from '../db/schema';
import { t, type Key } from '../i18n';

/** المجموعة: 'prayers' أو معرّف نشاط */
export type Group = string;
export const PRAYER_GROUP = 'prayers';

export const groupSlots = (g: Group): Slot[] => (g === PRAYER_GROUP ? [...PRAYERS] : [activitySlot(g)]);
export const slotGroup = (s: Slot): Group => (isPrayerSlot(s) ? PRAYER_GROUP : s.slice(2));

let actNames = new Map<string, string>();
/** يحدّث أسماء الأنشطة المستخدمة في التقارير والدوال غير المرتبطة بالواجهة */
export function setActivityNames(list: Activity[]) {
  actNames = new Map(list.map((a) => [a.id, a.name]));
}

export function slotName(s: Slot | null | undefined): string {
  if (!s) return '—';
  if (isPrayerSlot(s)) return t(('p_' + s) as Key);
  return actNames.get(s.slice(2)) ?? '—';
}
export function groupName(g: Group): string {
  return g === PRAYER_GROUP ? t('group_prayers') : actNames.get(g) ?? '—';
}

/** الأنشطة الفعّالة مرتبة */
export function useActivities(): Activity[] | undefined {
  const list = useLiveQuery(() => db.activities.orderBy('order').toArray(), []);
  if (list) setActivityNames(list);
  return list?.filter((a) => a.active);
}

/** أزرار اختيار المجموعة (الصلاة / الأنشطة) — تظهر فقط عند وجود أنشطة */
export function groupsOf(acts: Activity[] | undefined): Group[] {
  return [PRAYER_GROUP, ...(acts ?? []).map((a) => a.id)];
}
