import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, FULL_PERMS, type Permissions, type User } from '../db/schema';
import { createUser, exportBackup, getSetting, hashPin, importBackup, setSetting } from '../db/repo';
import { useAuth } from '../auth';
import { Sheet, useUI } from '../components/ui';
import { IDB, IDownload, IEdit, ILogout, IPlus, IShield, IUpload } from '../components/Icons';
import { pickFile, saveFile, textToBase64 } from '../lib/files';
import { todayISO } from '../lib/dates';

export default function MorePage() {
  const { user, isAdmin, logout } = useAuth();
  const ui = useUI();
  const [editUser, setEditUser] = useState<Partial<User> | null>(null);
  const [pinSheet, setPinSheet] = useState(false);
  const users = useLiveQuery(() => db.users.toArray(), []);
  const org = useLiveQuery(() => getSetting('org', ''), []);
  const counts = useLiveQuery(async () => ({ c: await db.classes.count(), s: await db.students.count(), a: await db.attendance.count() }), []);

  const backup = async () => {
    const json = await exportBackup();
    await saveFile(textToBase64(json), `نسخة_احتياطية_${todayISO()}.json`, 'application/json');
    await setSetting('lastBackup', Date.now());
  };
  const restore = async () => {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    if (!(await ui.confirm('ستُستبدل جميع البيانات الحالية بمحتوى النسخة الاحتياطية. هل تريد المتابعة؟', { ok: 'استرجاع', danger: true }))) return;
    try {
      await importBackup(await f.text());
      ui.toast('تم استرجاع البيانات');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      ui.toast((e as Error).message || 'ملف غير صالح', true);
    }
  };

  return (
    <>
      <header className="topbar">
        <h1>المزيد</h1>
      </header>
      <main className="content">
        <div className="card row">
          <span className="avatar">{user.name.trim()[0]}</span>
          <div className="grow">
            <b>{user.name}</b>
            <div className="small muted">{isAdmin ? 'مسؤول التطبيق' : 'مشرف'}</div>
          </div>
          <button className="btn sm ghost" onClick={() => setPinSheet(true)}>
            تغيير الرمز
          </button>
        </div>

        {isAdmin && (
          <>
            <div className="card">
              <h3>اسم الجهة (يظهر في التقارير)</h3>
              <div className="row">
                <input defaultValue={org ?? ''} key={org} id="org" placeholder="اسم المدرسة / الحلقة" />
                <button
                  className="btn"
                  onClick={async () => {
                    await setSetting('org', (document.getElementById('org') as HTMLInputElement).value.trim());
                    ui.toast('تم الحفظ');
                  }}
                >
                  حفظ
                </button>
              </div>
            </div>

            <div className="card">
              <div className="row" style={{ marginBottom: 6 }}>
                <h3 className="grow" style={{ margin: 0 }}>
                  المستخدمون والصلاحيات
                </h3>
                <button className="btn sm" onClick={() => setEditUser({ role: 'supervisor', perms: { allClasses: false, classIds: [], viewReports: true, exportReports: false, editPastDays: false } })}>
                  <IPlus /> مشرف
                </button>
              </div>
              {users?.map((u) => (
                <div key={u.id} className="list-item">
                  <span className="avatar">{u.name.trim()[0]}</span>
                  <div className="grow">
                    <b>{u.name}</b>
                    <div className="small muted">
                      {u.role === 'admin' ? 'مسؤول' : 'مشرف'}
                      {!u.active && ' — موقوف'}
                    </div>
                  </div>
                  {u.id !== user.id && (
                    <button className="ib" onClick={() => setEditUser(u)} aria-label="تعديل">
                      <IEdit />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="card">
              <h3>البيانات والنسخ الاحتياطي</h3>
              <p className="small muted" style={{ marginTop: 0 }}>
                جميع البيانات محفوظة على هذا الجهاز فقط ({counts?.c ?? 0} صف، {counts?.s ?? 0} طالب، {counts?.a ?? 0} سجل حضور). احفظ نسخة احتياطية دوريًا لنقلها إلى جهاز آخر أو حمايتها من الضياع.
              </p>
              <button className="menu-item" onClick={backup}>
                <IDownload /> حفظ نسخة احتياطية
              </button>
              <button className="menu-item" onClick={restore}>
                <IUpload /> استرجاع من نسخة احتياطية
              </button>
            </div>
          </>
        )}

        {!isAdmin && (
          <div className="card">
            <h3>صلاحياتي</h3>
            <PermsSummary u={user} />
          </div>
        )}

        <div className="card">
          <button className="menu-item" onClick={logout} style={{ color: 'var(--bad)' }}>
            <ILogout /> تسجيل الخروج
          </button>
        </div>
        <p className="center small muted">
          <IDB style={{ width: 16, verticalAlign: 'middle' }} /> برنامج متابعة حضور الصلاة — الإصدار 1.0
          <br />
          يعمل بالكامل دون اتصال بالإنترنت
        </p>
      </main>
      {editUser && <UserForm init={editUser} onClose={() => setEditUser(null)} />}
      {pinSheet && <ChangePin onClose={() => setPinSheet(false)} />}
    </>
  );
}

function PermsSummary({ u }: { u: User }) {
  const classes = useLiveQuery(() => db.classes.toArray(), []);
  const names = u.perms.allClasses ? 'جميع الصفوف' : classes?.filter((c) => u.perms.classIds.includes(c.id)).map((c) => c.name).join('، ') || 'لا يوجد';
  return (
    <div className="small">
      <div>الصفوف: {names}</div>
      <div>مراجعة التقارير: {u.perms.viewReports ? 'نعم' : 'لا'}</div>
      <div>تصدير التقارير: {u.perms.exportReports ? 'نعم' : 'لا'}</div>
      <div>تعديل حضور الأيام السابقة: {u.perms.editPastDays ? 'نعم' : 'لا'}</div>
    </div>
  );
}

function UserForm({ init, onClose }: { init: Partial<User>; onClose: () => void }) {
  const ui = useUI();
  const classes = useLiveQuery(() => db.classes.orderBy('order').toArray(), []);
  const [name, setName] = useState(init.name ?? '');
  const [role, setRole] = useState<User['role']>(init.role ?? 'supervisor');
  const [pin, setPin] = useState('');
  const [perms, setPerms] = useState<Permissions>(init.perms ?? FULL_PERMS);
  const isNew = !init.id;
  const P = (k: keyof Omit<Permissions, 'classIds'>, label: string) => (
    <label className="check">
      <input type="checkbox" checked={perms[k]} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} />
      {label}
    </label>
  );
  const save = async () => {
    if (!name.trim()) return ui.toast('أدخل الاسم', true);
    if ((isNew || pin) && !/^\d{4}$/.test(pin)) return ui.toast('رمز الدخول 4 أرقام', true);
    if (isNew) await createUser(name, pin, role, perms);
    else
      await db.users.update(init.id!, {
        name: name.trim(),
        role,
        perms: role === 'admin' ? FULL_PERMS : perms,
        ...(pin ? { pinHash: await hashPin(pin) } : {}),
      });
    ui.toast('تم الحفظ');
    onClose();
  };
  return (
    <Sheet onClose={onClose}>
      <h2>{isNew ? 'إضافة مستخدم' : 'تعديل مستخدم'}</h2>
      <label className="f">الاسم</label>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <label className="f">{isNew ? 'رمز الدخول (4 أرقام)' : 'رمز دخول جديد (اتركه فارغًا لعدم التغيير)'}</label>
      <input type="password" inputMode="numeric" maxLength={4} dir="ltr" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
      <label className="f">الدور</label>
      <div className="tabs">
        <button className={role === 'supervisor' ? 'on' : ''} onClick={() => setRole('supervisor')}>
          مشرف
        </button>
        <button className={role === 'admin' ? 'on' : ''} onClick={() => setRole('admin')}>
          <IShield style={{ width: 18, verticalAlign: 'middle' }} /> مسؤول
        </button>
      </div>
      {role === 'supervisor' && (
        <>
          <b>الصلاحيات</b>
          {P('allClasses', 'جميع الصفوف')}
          {!perms.allClasses &&
            classes?.map((c) => (
              <label key={c.id} className="check" style={{ paddingInlineStart: 24 }}>
                <input
                  type="checkbox"
                  checked={perms.classIds.includes(c.id)}
                  onChange={(e) => setPerms({ ...perms, classIds: e.target.checked ? [...perms.classIds, c.id] : perms.classIds.filter((x) => x !== c.id) })}
                />
                {c.name}
              </label>
            ))}
          {P('viewReports', 'مراجعة التقارير')}
          {P('exportReports', 'تصدير التقارير (Excel / PDF)')}
          {P('editPastDays', 'تعديل حضور الأيام السابقة')}
        </>
      )}
      <div className="acts">
        <button className="btn" onClick={save}>
          حفظ
        </button>
        <button className="btn ghost" onClick={onClose}>
          إلغاء
        </button>
      </div>
      {!isNew && (
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn sm ghost grow"
            onClick={async () => {
              await db.users.update(init.id!, { active: init.active ? 0 : 1 });
              onClose();
            }}
          >
            {init.active ? 'إيقاف الحساب' : 'تفعيل الحساب'}
          </button>
          <button
            className="btn sm danger grow"
            onClick={async () => {
              if (init.role === 'admin' && (await db.users.where('role').equals('admin').count()) <= 1) return ui.toast('لا يمكن حذف آخر مسؤول', true);
              if (await ui.confirm(`حذف المستخدم «${init.name}»؟`, { ok: 'حذف', danger: true })) {
                await db.users.delete(init.id!);
                onClose();
              }
            }}
          >
            حذف
          </button>
        </div>
      )}
    </Sheet>
  );
}

function ChangePin({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const ui = useUI();
  const [oldPin, setOld] = useState('');
  const [pin, setPin] = useState('');
  return (
    <Sheet onClose={onClose}>
      <h2>تغيير رمز الدخول</h2>
      <label className="f">الرمز الحالي</label>
      <input type="password" inputMode="numeric" maxLength={4} dir="ltr" value={oldPin} onChange={(e) => setOld(e.target.value.replace(/\D/g, ''))} />
      <label className="f">الرمز الجديد (4 أرقام)</label>
      <input type="password" inputMode="numeric" maxLength={4} dir="ltr" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
      <div className="acts">
        <button
          className="btn"
          onClick={async () => {
            if ((await hashPin(oldPin)) !== user.pinHash) return ui.toast('الرمز الحالي غير صحيح', true);
            if (!/^\d{4}$/.test(pin)) return ui.toast('الرمز الجديد 4 أرقام', true);
            await db.users.update(user.id, { pinHash: await hashPin(pin) });
            ui.toast('تم تغيير الرمز');
            onClose();
          }}
        >
          حفظ
        </button>
        <button className="btn ghost" onClick={onClose}>
          إلغاء
        </button>
      </div>
    </Sheet>
  );
}
