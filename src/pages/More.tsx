import { useState } from 'react';
import { UndoBar } from '../components/UndoBar';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, FULL_PERMS, type Permissions, type User } from '../db/schema';
import { createUser, exportBackup, getSetting, hashPin, importBackup, setSetting } from '../db/repo';
import { useAuth } from '../auth';
import { Sheet, useUI } from '../components/ui';
import { IDB, IDownload, IEdit, ILogout, IPlus, IShield, IUpload } from '../components/Icons';
import { pickFile, saveFile, textToBase64 } from '../lib/files';
import { todayISO } from '../lib/dates';
import { SyncCard } from '../sync/SyncUI';
import { requeueAll } from '../sync/sync';
import { clearHistory, withoutHistory } from '../lib/history';
import { t, LangSwitch } from '../i18n';
import { LocationCard } from '../components/LocationCard';
import { SchoolsCard } from '../components/SchoolSwitch';

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
    await saveFile(textToBase64(json), `${t('backup_file')}_${todayISO()}.json`, 'application/json');
    await setSetting('lastBackup', Date.now());
  };
  const restore = async () => {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    if (!(await ui.confirm(t('confirm_restore'), { ok: t('restore_btn'), danger: true }))) return;
    try {
      await withoutHistory(async () => importBackup(await f.text()));
      clearHistory();
      await requeueAll();
      ui.toast(t('restored_data'));
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      ui.toast((e as Error).message || t('invalid_file'), true);
    }
  };

  return (
    <>
      <header className="topbar">
        <h1>{t('more_title')}</h1>
        <UndoBar />
      </header>
      <main className="content">
        <div className="card row">
          <span className="avatar">{user.name.trim()[0]}</span>
          <div className="grow">
            <b>{user.name}</b>
            <div className="small muted">{isAdmin ? t('role_admin') : t('role_sup')}</div>
          </div>
          <button className="btn sm ghost" onClick={() => setPinSheet(true)}>
            {t('change_pin')}
          </button>
        </div>

        {isAdmin && (
          <>
            <div className="card">
              <h3>{t('org_title')}</h3>
              <div className="row">
                <input defaultValue={org ?? ''} key={org} id="org" placeholder={t('org_ph')} />
                <button
                  className="btn"
                  onClick={async () => {
                    await setSetting('org', (document.getElementById('org') as HTMLInputElement).value.trim());
                    ui.toast(t('saved'));
                  }}
                >
                  {t('save')}
                </button>
              </div>
            </div>

            <div className="card">
              <div className="row" style={{ marginBottom: 6 }}>
                <h3 className="grow" style={{ margin: 0 }}>
                  {t('users_perms')}
                </h3>
                <button className="btn sm" onClick={() => setEditUser({ role: 'supervisor', perms: { allClasses: false, classIds: [], viewReports: true, exportReports: false, editPastDays: false } })}>
                  <IPlus /> {t('add_sup')}
                </button>
              </div>
              {users?.map((u) => (
                <div key={u.id} className="list-item">
                  <span className="avatar">{u.name.trim()[0]}</span>
                  <div className="grow">
                    <b>{u.name}</b>
                    <div className="small muted">
                      {u.role === 'admin' ? t('role_admin_short') : t('role_sup')}
                      {!u.active && t('suspended')}
                    </div>
                  </div>
                  {u.id !== user.id && (
                    <button className="ib" onClick={() => setEditUser(u)} aria-label={t('edit')}>
                      <IEdit />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="card">
              <h3>{t('data_backup')}</h3>
              <p className="small muted" style={{ marginTop: 0 }}>
                {t('data_counts', { c: counts?.c ?? 0, s: counts?.s ?? 0, a: counts?.a ?? 0 })}
              </p>
              <button className="menu-item" onClick={backup}>
                <IDownload /> {t('save_backup')}
              </button>
              <button className="menu-item" onClick={restore}>
                <IUpload /> {t('restore_backup')}
              </button>
            </div>
          </>
        )}

        <LocationCard />

        <div className="card">
          <h3>{t('language')}</h3>
          <LangSwitch />
        </div>

        <SyncCard isAdmin={isAdmin} />
        <SchoolsCard />

        {!isAdmin && (
          <div className="card">
            <h3>{t('my_perms')}</h3>
            <PermsSummary u={user} />
          </div>
        )}

        <div className="card">
          <button className="menu-item" onClick={logout} style={{ color: 'var(--bad)' }}>
            <ILogout /> {t('logout')}
          </button>
        </div>
        <p className="center small muted">
          <IDB style={{ width: 16, verticalAlign: 'middle' }} /> {t('version', { v: '1.1' })}
          <br />
          {t('offline_works')}
        </p>
      </main>
      {editUser && <UserForm init={editUser} onClose={() => setEditUser(null)} />}
      {pinSheet && <ChangePin onClose={() => setPinSheet(false)} />}
    </>
  );
}

function PermsSummary({ u }: { u: User }) {
  const classes = useLiveQuery(() => db.classes.toArray(), []);
  const names = u.perms.allClasses ? t('perm_all_classes') : classes?.filter((c) => u.perms.classIds.includes(c.id)).map((c) => c.name).join(', ') || t('none');
  return (
    <div className="small">
      <div>{t('perm_classes', { v: names })}</div>
      <div>{t('perm_view', { v: u.perms.viewReports ? t('yes') : t('no') })}</div>
      <div>{t('perm_export', { v: u.perms.exportReports ? t('yes') : t('no') })}</div>
      <div>{t('perm_past', { v: u.perms.editPastDays ? t('yes') : t('no') })}</div>
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
    if (!name.trim()) return ui.toast(t('enter_name_u'), true);
    if ((isNew || pin) && !/^\d{4}$/.test(pin)) return ui.toast(t('pin4'), true);
    if (isNew) await createUser(name, pin, role, perms);
    else
      await db.users.update(init.id!, {
        name: name.trim(),
        role,
        perms: role === 'admin' ? FULL_PERMS : perms,
        ...(pin ? { pinHash: await hashPin(pin) } : {}),
      });
    ui.toast(t('saved'));
    onClose();
  };
  return (
    <Sheet onClose={onClose}>
      <h2>{isNew ? t('user_new') : t('user_edit')}</h2>
      <label className="f">{t('name')}</label>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <label className="f">{isNew ? t('pin_new') : t('pin_change')}</label>
      <input type="password" inputMode="numeric" maxLength={4} dir="ltr" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
      <label className="f">{t('role')}</label>
      <div className="tabs">
        <button className={role === 'supervisor' ? 'on' : ''} onClick={() => setRole('supervisor')}>
          {t('role_sup')}
        </button>
        <button className={role === 'admin' ? 'on' : ''} onClick={() => setRole('admin')}>
          <IShield style={{ width: 18, verticalAlign: 'middle' }} /> {t('role_admin_short')}
        </button>
      </div>
      {role === 'supervisor' && (
        <>
          <b>{t('perms')}</b>
          {P('allClasses', t('perm_all_classes'))}
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
          {P('viewReports', t('perm_view_l'))}
          {P('exportReports', t('perm_export_l'))}
          {P('editPastDays', t('perm_past_l'))}
        </>
      )}
      <div className="acts">
        <button className="btn" onClick={save}>
          {t('save')}
        </button>
        <button className="btn ghost" onClick={onClose}>
          {t('cancel')}
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
            {init.active ? t('suspend') : t('activate')}
          </button>
          <button
            className="btn sm danger grow"
            onClick={async () => {
              if (init.role === 'admin' && (await db.users.where('role').equals('admin').count()) <= 1) return ui.toast(t('cant_delete_last_admin'), true);
              if (await ui.confirm(t('confirm_delete_user', { name: init.name ?? '' }), { ok: t('delete'), danger: true })) {
                await db.users.delete(init.id!);
                onClose();
              }
            }}
          >
            {t('delete')}
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
      <h2>{t('change_pin')}</h2>
      <label className="f">{t('cur_pin')}</label>
      <input type="password" inputMode="numeric" maxLength={4} dir="ltr" value={oldPin} onChange={(e) => setOld(e.target.value.replace(/\D/g, ''))} />
      <label className="f">{t('new_pin')}</label>
      <input type="password" inputMode="numeric" maxLength={4} dir="ltr" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
      <div className="acts">
        <button
          className="btn"
          onClick={async () => {
            if ((await hashPin(oldPin)) !== user.pinHash) return ui.toast(t('wrong_cur_pin'), true);
            if (!/^\d{4}$/.test(pin)) return ui.toast(t('pin4'), true);
            await db.users.update(user.id, { pinHash: await hashPin(pin) });
            ui.toast(t('pin_changed'));
            onClose();
          }}
        >
          {t('save')}
        </button>
        <button className="btn ghost" onClick={onClose}>
          {t('cancel')}
        </button>
      </div>
    </Sheet>
  );
}
