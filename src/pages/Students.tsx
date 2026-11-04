import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db, type Activity, type ClassRoom, type Student } from '../db/schema';
import { addActivity, deleteActivity, moveActivityOrder, renameActivity, addClass, deleteClass, deleteStudent, importStudents, moveClassOrder, moveStudents, nextSerial, renameClass, saveStudent, setStudentActive } from '../db/repo';
import { useAuth } from '../auth';
import { Empty, SearchBox, Sheet, matchStudent, useUI } from '../components/ui';
import { IArchive, IDown, IEdit, IMove, IPlus, IQr, ITrash, IUp, IUpload, IUsers } from '../components/Icons';
import { exportQrCards } from '../lib/qrCards';
import { getSetting } from '../db/repo';
import { parseExcel, downloadTemplate, type ParsedSheet } from '../lib/importExcel';
import { pickFile } from '../lib/files';
import { t } from '../i18n';

export default function StudentsPage() {
  const { isAdmin, allowedClasses, user } = useAuth();
  const [tab, setTab] = useState<'students' | 'classes' | 'activities'>('students');
  const [editing, setEditing] = useState<Partial<Student> | null>(null);
  const [importing, setImporting] = useState(false);
  const classes = useLiveQuery(async () => allowedClasses(await db.classes.orderBy('order').toArray()), [user.id]);

  return (
    <>
      <header className="topbar">
        <h1>{t('students_title')}</h1>
        {isAdmin && (
          <>
            <button className="ib" onClick={() => setImporting(true)} aria-label={t('import_excel')}>
              <IUpload />
            </button>
            <button className="ib" onClick={() => setEditing({ classId: classes?.[0]?.id })} aria-label={t('add_student')}>
              <IPlus />
            </button>
          </>
        )}
      </header>
      <main className="content">
        {isAdmin && (
          <div className="tabs">
            <button className={tab === 'students' ? 'on' : ''} onClick={() => setTab('students')}>
              {t('tab_students')}
            </button>
            <button className={tab === 'classes' ? 'on' : ''} onClick={() => setTab('classes')}>
              {t('tab_classes')}
            </button>
            <button className={tab === 'activities' ? 'on' : ''} onClick={() => setTab('activities')}>
              {t('tab_activities')}
            </button>
          </div>
        )}
        {classes && (tab === 'students' ? <StudentsTab classes={classes} onEdit={setEditing} onImport={() => setImporting(true)} /> : tab === 'classes' ? <ClassesTab classes={classes} /> : <ActivitiesTab />)}
      </main>
      {editing && classes && <StudentForm init={editing} classes={classes} onClose={() => setEditing(null)} />}
      {importing && classes && <ImportSheet classes={classes} onClose={() => setImporting(false)} />}
    </>
  );
}

function StudentsTab({ classes, onEdit, onImport }: { classes: ClassRoom[]; onEdit: (s: Partial<Student>) => void; onImport: () => void }) {
  const { isAdmin } = useAuth();
  const ui = useUI();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [cls, setCls] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const all = useLiveQuery(() => db.students.toArray(), []);
  const cmap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

  if (!all) return null;
  const list = all
    .filter((s) => cmap.has(s.classId) && (archived ? !s.active : !!s.active) && (!cls || s.classId === cls) && matchStudent(q, s.name, s.serial))
    .sort((a, b) => (cmap.get(a.classId)!.order - cmap.get(b.classId)!.order) || a.serial - b.serial);

  if (classes.length === 0)
    return (
      <Empty icon={<IUsers />} text={t('empty_classes_hint')}>
        {isAdmin && (
          <button className="btn" onClick={onImport}>
            <IUpload /> {t('import_excel')}
          </button>
        )}
      </Empty>
    );

  return (
    <>
      <SearchBox value={q} onChange={setQ} />
      <div className="sp" />
      <div className="chips">
        <button className={'chip' + (!cls ? ' on' : '')} onClick={() => setCls(null)}>
          {t('all')}
        </button>
        {classes.map((c) => (
          <button key={c.id} className={'chip' + (cls === c.id ? ' on' : '')} onClick={() => setCls(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      <div className="row" style={{ margin: '4px 0 8px' }}>
        <span className="grow small muted">{t('n_students', { n: list.length })}{archived ? t('archived_suffix') : ''}</span>
        {isAdmin && (
          <>
            <button className="btn sm ghost" onClick={() => setArchived((v) => !v)}>
              {archived ? t('active_btn') : t('archived_btn')}
            </button>
            {!archived && list.length > 0 && (
              <button
                className="btn sm ghost"
                aria-label={t('qr_cards')}
                onClick={async () => {
                  if (!(await ui.confirm(t('qr_cards_n', { n: list.length }), { ok: t('qr_cards') }))) return;
                  try {
                    await exportQrCards(list, classes, await getSetting('org', ''));
                  } catch (e) {
                    const m = (e as Error)?.message ?? '';
                    if (!/cancel|abort/i.test(m)) ui.toast(t('export_failed', { e: m }), true);
                  }
                }}
              >
                <IQr style={{ width: 18 }} />
              </button>
            )}
            <button className={'btn sm ' + (selecting ? '' : 'ghost')} onClick={() => (setSelecting((v) => !v), setSel(new Set()))}>
              {selecting ? t('cancel_select') : t('select')}
            </button>
          </>
        )}
      </div>
      {list.length === 0 ? (
        <Empty text={t('no_match')} />
      ) : (
        <div className="card" style={{ padding: '4px 14px' }}>
          {list.map((s) => (
            <div key={s.id} className="list-item">
              {selecting ? (
                <input
                  type="checkbox"
                  style={{ width: 22, height: 22, accentColor: 'var(--brand)' }}
                  checked={sel.has(s.id)}
                  onChange={(e) => {
                    const n = new Set(sel);
                    if (e.target.checked) n.add(s.id);
                    else n.delete(s.id);
                    setSel(n);
                  }}
                />
              ) : (
                <span className="avatar">{s.serial}</span>
              )}
              <button className="grow" style={{ textAlign: 'start' }} onClick={() => (selecting ? null : nav(`/student/${s.id}`))}>
                <b>{s.name}</b>
                <div className="small muted">
                  {cmap.get(s.classId)?.name}
                  {s.phone ? ` — ${s.phone}` : ''}
                </div>
              </button>
              {isAdmin && !selecting && (
                <button className="ib" onClick={() => onEdit(s)} aria-label={t('edit')}>
                  <IEdit />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {selecting && sel.size > 0 && (
        <div className="actionbar">
          <button className="btn grow" onClick={() => setMoving(true)}>
            <IMove /> {t('move_n', { n: sel.size })}
          </button>
          <button
            className="btn ghost"
            onClick={async () => {
              for (const id of sel) await setStudentActive(id, archived);
              ui.toast(archived ? t('restored_done') : t('archived_done'));
              setSel(new Set());
            }}
          >
            <IArchive /> {archived ? t('restore') : t('archive')}
          </button>
        </div>
      )}
      {moving && (
        <Sheet onClose={() => setMoving(false)}>
          <h2>{t('move_n_to', { n: sel.size })}</h2>
          {classes.map((c) => (
            <button
              key={c.id}
              className="menu-item"
              onClick={async () => {
                await moveStudents([...sel], c.id);
                ui.toast(t('moved_to', { name: c.name }));
                setMoving(false);
                setSelecting(false);
                setSel(new Set());
              }}
            >
              {c.name}
            </button>
          ))}
        </Sheet>
      )}
    </>
  );
}

function StudentForm({ init, classes, onClose }: { init: Partial<Student>; classes: ClassRoom[]; onClose: () => void }) {
  const ui = useUI();
  const [s, setS] = useState<Partial<Student>>(init);
  const [keepAdding, setKeepAdding] = useState(false);
  const isNew = !init.id;
  const save = async () => {
    if (!s.name?.trim()) return ui.toast(t('enter_name'), true);
    if (!s.classId) return ui.toast(t('choose_class'), true);
    let serial = s.serial;
    if (!serial) serial = await nextSerial();
    const dup = await db.students.where('serial').equals(serial).first();
    if (dup && dup.id !== s.id) return ui.toast(t('serial_used', { serial, name: dup.name }), true);
    await saveStudent({ ...s, serial, name: s.name, classId: s.classId });
    ui.toast(isNew ? t('student_added') : t('saved'));
    if (isNew && keepAdding) setS({ classId: s.classId });
    else onClose();
  };
  return (
    <Sheet onClose={onClose}>
      <h2>{isNew ? t('student_new') : t('student_edit')}</h2>
      <label className="f">{t('full_name')}</label>
      <input autoFocus value={s.name ?? ''} onChange={(e) => setS({ ...s, name: e.target.value })} />
      <label className="f">{t('class_req')}</label>
      <select value={s.classId ?? ''} onChange={(e) => setS({ ...s, classId: e.target.value })}>
        <option value="">{t('choose')}</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <div className="row">
        <div className="grow">
          <label className="f">{t('serial')}</label>
          <input type="number" inputMode="numeric" value={s.serial ?? ''} placeholder={t('auto')} onChange={(e) => setS({ ...s, serial: e.target.value ? Number(e.target.value) : undefined })} />
        </div>
        <div className="grow">
          <label className="f">{t('phone_opt')}</label>
          <input type="tel" inputMode="tel" dir="ltr" value={s.phone ?? ''} onChange={(e) => setS({ ...s, phone: e.target.value })} />
        </div>
      </div>
      {isNew && (
        <label className="check">
          <input type="checkbox" checked={keepAdding} onChange={(e) => setKeepAdding(e.target.checked)} />
          {t('add_another')}
        </label>
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
              await setStudentActive(init.id!, !init.active);
              ui.toast(init.active ? t('student_archived') : t('student_restored'));
              onClose();
            }}
          >
            <IArchive /> {init.active ? t('archive') : t('restore')}
          </button>
          <button
            className="btn sm danger grow"
            onClick={async () => {
              if (await ui.confirm(t('confirm_delete_student', { name: init.name ?? '' }), { ok: t('delete_forever'), danger: true })) {
                await deleteStudent(init.id!);
                ui.toast(t('deleted'));
                onClose();
              }
            }}
          >
            <ITrash /> {t('delete_forever')}
          </button>
        </div>
      )}
    </Sheet>
  );
}

function ClassesTab({ classes }: { classes: ClassRoom[] }) {
  const ui = useUI();
  const [name, setName] = useState('');
  const [edit, setEdit] = useState<ClassRoom | null>(null);
  const [del, setDel] = useState<ClassRoom | null>(null);
  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    await db.students.where('active').equals(1).each((s) => m.set(s.classId, (m.get(s.classId) ?? 0) + 1));
    return m;
  }, []);
  const add = async () => {
    if (!name.trim()) return;
    if (classes.some((c) => c.name === name.trim())) return ui.toast(t('class_exists'), true);
    await addClass(name);
    setName('');
    ui.toast(t('class_added'));
  };
  return (
    <>
      <div className="card">
        <h3>{t('add_class')}</h3>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('class_ph')} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="btn" onClick={add}>
            <IPlus /> {t('add')}
          </button>
        </div>
      </div>
      {classes.length > 0 && (
        <div className="card" style={{ padding: '4px 14px' }}>
          {classes.map((c, i) => (
            <div key={c.id} className="list-item">
              <div className="grow">
                <b>{c.name}</b>
                <div className="small muted">{t('n_students', { n: counts?.get(c.id) ?? 0 })}</div>
              </div>
              <button className="ib" disabled={i === 0} style={{ opacity: i === 0 ? 0.3 : 1 }} onClick={() => moveClassOrder(c.id, -1)} aria-label={t('up')}>
                <IUp />
              </button>
              <button className="ib" disabled={i === classes.length - 1} style={{ opacity: i === classes.length - 1 ? 0.3 : 1 }} onClick={() => moveClassOrder(c.id, 1)} aria-label={t('down')}>
                <IDown />
              </button>
              <button className="ib" onClick={() => setEdit(c)} aria-label={t('edit')}>
                <IEdit />
              </button>
              <button className="ib" style={{ color: 'var(--bad)' }} onClick={() => setDel(c)} aria-label={t('delete')}>
                <ITrash />
              </button>
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Sheet onClose={() => setEdit(null)}>
          <h2>{t('rename_class')}</h2>
          <input autoFocus defaultValue={edit.name} id="cls-name" />
          <div className="acts">
            <button
              className="btn"
              onClick={async () => {
                const v = (document.getElementById('cls-name') as HTMLInputElement).value;
                if (v.trim()) await renameClass(edit.id, v);
                setEdit(null);
              }}
            >
              {t('save')}
            </button>
            <button className="btn ghost" onClick={() => setEdit(null)}>
              {t('cancel')}
            </button>
          </div>
        </Sheet>
      )}
      {del && <DeleteClassSheet cls={del} classes={classes} onClose={() => setDel(null)} />}
    </>
  );
}

function DeleteClassSheet({ cls, classes, onClose }: { cls: ClassRoom; classes: ClassRoom[]; onClose: () => void }) {
  const ui = useUI();
  const n = useLiveQuery(() => db.students.where('classId').equals(cls.id).count(), [cls.id]);
  const [to, setTo] = useState('');
  if (n === undefined) return null;
  return (
    <Sheet onClose={onClose}>
      <h2>{t('delete_class', { name: cls.name })}</h2>
      {n > 0 ? (
        <>
          <p className="muted">{t('class_has_students', { n })}</p>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">{t('choose')}</option>
            {classes
              .filter((c) => c.id !== cls.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </>
      ) : (
        <p className="muted">{t('class_empty')}</p>
      )}
      <div className="acts">
        <button
          className="btn danger"
          disabled={n > 0 && !to}
          onClick={async () => {
            await deleteClass(cls.id, to || undefined);
            ui.toast(t('class_deleted'));
            onClose();
          }}
        >
          {t('delete')}
        </button>
        <button className="btn ghost" onClick={onClose}>
          {t('cancel')}
        </button>
      </div>
    </Sheet>
  );
}

function ImportSheet({ classes, onClose }: { classes: ClassRoom[]; onClose: () => void }) {
  const ui = useUI();
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [map, setMap] = useState({ name: -1, serial: -1, phone: -1, className: -1 });
  const [defCls, setDefCls] = useState(classes[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    const f = await pickFile('.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv');
    if (!f) return;
    try {
      const p = await parseExcel(f);
      if (!p.rows.length) return ui.toast(t('file_empty'), true);
      setParsed(p);
      setMap(p.guess);
    } catch {
      ui.toast(t('file_error'), true);
    }
  };

  const rows = parsed
    ? parsed.rows
        .map((r) => ({
          name: r[map.name] ?? '',
          serial: map.serial >= 0 ? parseInt(r[map.serial]) || undefined : undefined,
          phone: map.phone >= 0 ? r[map.phone] : undefined,
          className: map.className >= 0 ? r[map.className] : undefined,
        }))
        .filter((r) => r.name && r.name.length > 1 && !/^\d+$/.test(r.name))
    : [];
  const needDefault = map.className < 0 || rows.some((r) => !r.className);

  const doImport = async () => {
    setBusy(true);
    try {
      const res = await importStudents(rows, needDefault ? defCls || null : null);
      ui.toast(t('imported', { n: res.added }) + (res.createdClasses ? t('imported_classes', { n: res.createdClasses }) : '') + (res.skipped ? t('imported_skipped', { n: res.skipped }) : ''));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const Col = ({ k, label }: { k: keyof typeof map; label: string }) => (
    <div>
      <label className="f">{label}</label>
      <select value={map[k]} onChange={(e) => setMap({ ...map, [k]: Number(e.target.value) })}>
        <option value={-1}>{t('none')}</option>
        {parsed!.headers.map((h, i) => (
          <option key={i} value={i}>
            {h}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <Sheet onClose={onClose}>
      <h2>{t('import_title')}</h2>
      {!parsed ? (
        <>
          <p className="muted small">
            {t('import_hint')}
          </p>
          <button className="btn block" onClick={choose}>
            <IUpload /> {t('pick_excel')}
          </button>
          <div className="sp" />
          <button className="btn block light" onClick={downloadTemplate}>
            {t('download_template')}
          </button>
        </>
      ) : (
        <>
          <p className="small muted">{t('found_rows', { n: parsed.rows.length })}</p>
          <Col k="name" label={t('col_name')} />
          <div className="row">
            <div className="grow">
              <Col k="className" label={t('col_class')} />
            </div>
            <div className="grow">
              <Col k="serial" label={t('col_serial')} />
            </div>
          </div>
          <Col k="phone" label={t('col_phone')} />
          {needDefault && (
            <>
              <label className="f">{t('default_class')}</label>
              <select value={defCls} onChange={(e) => setDefCls(e.target.value)}>
                <option value="">{t('choose')}</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <div className="card" style={{ marginTop: 12, background: 'var(--soft, #f7f9f8)', boxShadow: 'none' }}>
            <b>{t('preview', { n: rows.length })}</b>
            {rows.slice(0, 5).map((r, i) => (
              <div key={i} className="small">
                {r.serial ? r.serial + ' — ' : ''}
                {r.name}
                {r.className ? ` (${r.className})` : ''}
              </div>
            ))}
            {rows.length > 5 && <div className="small muted">...</div>}
          </div>
          <div className="acts">
            <button className="btn" disabled={busy || !rows.length || map.name < 0 || (needDefault && !defCls && map.className < 0)} onClick={doImport}>
              {t('import_n', { n: rows.length })}
            </button>
            <button className="btn ghost" onClick={() => setParsed(null)}>
              {t('other_file')}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function ActivitiesTab() {
  const ui = useUI();
  const [name, setName] = useState('');
  const [edit, setEdit] = useState<Activity | null>(null);
  const list = useLiveQuery(() => db.activities.orderBy('order').toArray(), []);
  if (!list) return null;
  const add = async () => {
    if (!name.trim()) return;
    if (list.some((a) => a.name === name.trim())) return ui.toast(t('activity_exists'), true);
    await addActivity(name);
    setName('');
    ui.toast(t('activity_added'));
  };
  return (
    <>
      <p className="small muted">{t('activities_hint')}</p>
      <div className="card">
        <h3>{t('add_activity')}</h3>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('activity_ph')} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="btn" onClick={add}>
            <IPlus /> {t('add')}
          </button>
        </div>
      </div>
      {list.length === 0 ? (
        <Empty text={t('no_activities')} />
      ) : (
        <div className="card" style={{ padding: '4px 14px' }}>
          {list.map((a, i) => (
            <div key={a.id} className="list-item">
              <b className="grow">{a.name}</b>
              <button className="ib" disabled={i === 0} style={{ opacity: i === 0 ? 0.3 : 1 }} onClick={() => moveActivityOrder(a.id, -1)} aria-label={t('up')}>
                <IUp />
              </button>
              <button className="ib" disabled={i === list.length - 1} style={{ opacity: i === list.length - 1 ? 0.3 : 1 }} onClick={() => moveActivityOrder(a.id, 1)} aria-label={t('down')}>
                <IDown />
              </button>
              <button className="ib" onClick={() => setEdit(a)} aria-label={t('edit')}>
                <IEdit />
              </button>
              <button
                className="ib"
                style={{ color: 'var(--bad)' }}
                aria-label={t('delete')}
                onClick={async () => {
                  if (await ui.confirm(t('confirm_delete_activity', { name: a.name }), { ok: t('delete'), danger: true })) {
                    await deleteActivity(a.id);
                    ui.toast(t('activity_deleted'));
                  }
                }}
              >
                <ITrash />
              </button>
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Sheet onClose={() => setEdit(null)}>
          <h2>{t('rename_activity')}</h2>
          <input autoFocus defaultValue={edit.name} id="act-name" />
          <div className="acts">
            <button
              className="btn"
              onClick={async () => {
                const v = (document.getElementById('act-name') as HTMLInputElement).value;
                if (v.trim()) await renameActivity(edit.id, v);
                setEdit(null);
              }}
            >
              {t('save')}
            </button>
            <button className="btn ghost" onClick={() => setEdit(null)}>
              {t('cancel')}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
