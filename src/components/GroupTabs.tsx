import { groupName, groupsOf, useActivities, type Group } from '../lib/slots';

/** أزرار اختيار: الصلاة / الأنشطة — لا تظهر إن لم توجد أنشطة */
export function GroupTabs({ value, onChange }: { value: Group; onChange: (g: Group) => void }) {
  const acts = useActivities();
  if (!acts?.length) return null;
  return (
    <div className="tabs" style={{ marginBottom: 8 }}>
      {groupsOf(acts).map((g) => (
        <button key={g} className={value === g ? 'on' : ''} onClick={() => onChange(g)}>
          {groupName(g)}
        </button>
      ))}
    </div>
  );
}
