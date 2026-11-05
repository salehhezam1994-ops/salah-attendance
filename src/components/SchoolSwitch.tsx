import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSetting } from '../db/repo';
import { addSchool, currentSchool, listSchools, removeSchool, renameSchool, switchSchool, type SchoolProfile } from '../lib/schools';
import { useUI } from './ui';
import { ICheck, IPlus, ITrash } from './Icons';
import { t } from '../i18n';

const label = (s: SchoolProfile, i: number) => s.name || t('school_unnamed', { n: i + 1 });

/** يحدّث اسم المدرسة الحالية في القائمة من اسم المؤسسة المحفوظ */
function useSchools() {
  const org = useLiveQuery(() => getSetting('org', ''), []);
  const [list, setList] = useState(listSchools);
  useEffect(() => {
    if (org !== undefined) {
      renameSchool(currentSchool(), org);
      setList(listSchools());
    }
  }, [org]);
  return [list, setList] as const;
}

/** بطاقة في «المزيد»: المدارس على هذا الجهاز */
export function SchoolsCard() {
  const ui = useUI();
  const [list, setList] = useSchools();
  const cur = currentSchool();

  const add = async () => {
    if (!(await ui.confirm(t('school_add_confirm'), { ok: t('school_add'), title: t('school_add') }))) return;
    switchSchool(addSchool());
  };
  const del = async (s: SchoolProfile, i: number) => {
    if (!(await ui.confirm(t('school_del_confirm', { name: label(s, i) }), { ok: t('delete'), danger: true }))) return;
    await removeSchool(s.id);
    setList(listSchools());
    ui.toast(t('deleted'));
  };

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h3 className="grow" style={{ margin: 0 }}>
          {t('schools_title')}
        </h3>
        <button className="btn sm" onClick={add}>
          <IPlus /> {t('school_add')}
        </button>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('schools_hint')}
      </p>
      {list.map((s, i) => (
        <div key={s.id} className="list-item">
          <span className="avatar">{label(s, i).trim()[0]}</span>
          <div className="grow">
            <b>{label(s, i)}</b>
            {s.id === cur && <div className="small muted">{t('school_current')}</div>}
          </div>
          {s.id === cur ? (
            <span className="ib" style={{ color: 'var(--ok)' }}>
              <ICheck />
            </span>
          ) : (
            <>
              <button className="ib" onClick={() => del(s, i)} aria-label={t('delete')}>
                <ITrash />
              </button>
              <button className="btn sm light" onClick={() => switchSchool(s.id)}>
                {t('school_open')}
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** اختيار المدرسة في شاشة الدخول (يظهر فقط عند وجود أكثر من مدرسة) */
export function SchoolPicker() {
  const [list] = useSchools();
  if (list.length < 2) return null;
  return (
    <div className="card row" style={{ padding: '10px 14px' }}>
      <span className="small muted">{t('school_label')}</span>
      <select className="grow" value={currentSchool()} onChange={(e) => switchSchool(e.target.value)}>
        {list.map((s, i) => (
          <option key={s.id} value={s.id}>
            {label(s, i)}
          </option>
        ))}
      </select>
    </div>
  );
}
