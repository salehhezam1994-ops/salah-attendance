import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db, type ClassRoom, type Student } from '../db/schema';
import { addClass, deleteClass, deleteStudent, importStudents, moveClassOrder, moveStudents, nextSerial, renameClass, saveStudent, setStudentActive } from '../db/repo';
import { useAuth } from '../auth';
import { Empty, SearchBox, Sheet, matchStudent, useUI } from '../components/ui';
import { IArchive, IDown, IEdit, IMove, IPlus, ITrash, IUp, IUpload, IUsers } from '../components/Icons';
import { parseExcel, downloadTemplate, type ParsedSheet } from '../lib/importExcel';
import { pickFile } from '../lib/files';

export default function StudentsPage() {
  const { isAdmin, allowedClasses, user } = useAuth();
  const [tab, setTab] = useState<'students' | 'classes'>('students');
  const [editing, setEditing] = useState<Partial<Student> | null>(null);
  const [importing, setImporting] = useState(false);
  const classes = useLiveQuery(async () => allowedClasses(await db.classes.orderBy('order').toArray()), [user.id]);

  return (
    <>
      <header className="topbar">
        <h1>الطلاب والصفوف</h1>
        {isAdmin && (
          <>
            <button className="ib" onClick={() => setImporting(true)} aria-label="استيراد من Excel">
              <IUpload />
            </button>
            <button className="ib" onClick={() => setEditing({ classId: classes?.[0]?.id })} aria-label="إضافة طالب">
              <IPlus />
            </button>
          </>
        )}
      </header>
      <main className="content">
        {isAdmin && (
          <div className="tabs">
            <button className={tab === 'students' ? 'on' : ''} onClick={() => setTab('students')}>
              الطلاب
            </button>
            <button className={tab === 'classes' ? 'on' : ''} onClick={() => setTab('classes')}>
              الصفوف
            </button>
          </div>
        )}
        {classes && (tab === 'students' ? <StudentsTab classes={classes} onEdit={setEditing} onImport={() => setImporting(true)} /> : <ClassesTab classes={classes} />)}
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
      <Empty icon={<IUsers />} text="ابدأ بإنشاء الصفوف من تبويب «الصفوف»، أو استورد الطلاب من ملف Excel يحتوي عمود الصف وستُنشأ الصفوف تلقائيًا.">
        {isAdmin && (
          <button className="btn" onClick={onImport}>
            <IUpload /> استيراد من Excel
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
          الكل
        </button>
        {classes.map((c) => (
          <button key={c.id} className={'chip' + (cls === c.id ? ' on' : '')} onClick={() => setCls(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      <div className="row" style={{ margin: '4px 0 8px' }}>
        <span className="grow small muted">{list.length} طالب{archived ? ' (مؤرشف)' : ''}</span>
        {isAdmin && (
          <>
            <button className="btn sm ghost" onClick={() => setArchived((v) => !v)}>
              {archived ? 'النشطون' : 'المؤرشفون'}
            </button>
            <button className={'btn sm ' + (selecting ? '' : 'ghost')} onClick={() => (setSelecting((v) => !v), setSel(new Set()))}>
              {selecting ? 'إلغاء التحديد' : 'تحديد'}
            </button>
          </>
        )}
      </div>
      {list.length === 0 ? (
        <Empty text="لا يوجد طلاب مطابقون." />
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
              <button className="grow" style={{ textAlign: 'right' }} onClick={() => (selecting ? null : nav(`/student/${s.id}`))}>
                <b>{s.name}</b>
                <div className="small muted">
                  {cmap.get(s.classId)?.name}
                  {s.phone ? ` — ${s.phone}` : ''}
                </div>
              </button>
              {isAdmin && !selecting && (
                <button className="ib" onClick={() => onEdit(s)} aria-label="تعديل">
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
            <IMove /> نقل {sel.size} إلى صف آخر
          </button>
          <button
            className="btn ghost"
            onClick={async () => {
              for (const id of sel) await setStudentActive(id, archived);
              ui.toast(archived ? 'تمت الاستعادة' : 'تمت الأرشفة');
              setSel(new Set());
            }}
          >
            <IArchive /> {archived ? 'استعادة' : 'أرشفة'}
          </button>
        </div>
      )}
      {moving && (
        <Sheet onClose={() => setMoving(false)}>
          <h2>نقل {sel.size} طالب إلى:</h2>
          {classes.map((c) => (
            <button
              key={c.id}
              className="menu-item"
              onClick={async () => {
                await moveStudents([...sel], c.id);
                ui.toast(`تم النقل إلى ${c.name}`);
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
    if (!s.name?.trim()) return ui.toast('أدخل اسم الطالب', true);
    if (!s.classId) return ui.toast('اختر الصف', true);
    let serial = s.serial;
    if (!serial) serial = await nextSerial();
    const dup = await db.students.where('serial').equals(serial).first();
    if (dup && dup.id !== s.id) return ui.toast(`الرقم ${serial} مستخدم للطالب ${dup.name}`, true);
    await saveStudent({ ...s, serial, name: s.name, classId: s.classId });
    ui.toast(isNew ? 'تمت إضافة الطالب' : 'تم الحفظ');
    if (isNew && keepAdding) setS({ classId: s.classId });
    else onClose();
  };
  return (
    <Sheet onClose={onClose}>
      <h2>{isNew ? 'إضافة طالب' : 'تعديل بيانات الطالب'}</h2>
      <label className="f">الاسم الكامل *</label>
      <input autoFocus value={s.name ?? ''} onChange={(e) => setS({ ...s, name: e.target.value })} />
      <label className="f">الصف *</label>
      <select value={s.classId ?? ''} onChange={(e) => setS({ ...s, classId: e.target.value })}>
        <option value="">— اختر —</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <div className="row">
        <div className="grow">
          <label className="f">الرقم التسلسلي</label>
          <input type="number" inputMode="numeric" value={s.serial ?? ''} placeholder="تلقائي" onChange={(e) => setS({ ...s, serial: e.target.value ? Number(e.target.value) : undefined })} />
        </div>
        <div className="grow">
          <label className="f">الجوال (اختياري)</label>
          <input type="tel" inputMode="tel" dir="ltr" value={s.phone ?? ''} onChange={(e) => setS({ ...s, phone: e.target.value })} />
        </div>
      </div>
      {isNew && (
        <label className="check">
          <input type="checkbox" checked={keepAdding} onChange={(e) => setKeepAdding(e.target.checked)} />
          إضافة طالب آخر بعد الحفظ
        </label>
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
              await setStudentActive(init.id!, !init.active);
              ui.toast(init.active ? 'تمت أرشفة الطالب (يبقى سجله في التقارير)' : 'تمت استعادة الطالب');
              onClose();
            }}
          >
            <IArchive /> {init.active ? 'أرشفة' : 'استعادة'}
          </button>
          <button
            className="btn sm danger grow"
            onClick={async () => {
              if (await ui.confirm(`حذف «${init.name}» نهائيًا مع جميع سجلات حضوره؟ لا يمكن التراجع.`, { ok: 'حذف نهائي', danger: true })) {
                await deleteStudent(init.id!);
                ui.toast('تم الحذف');
                onClose();
              }
            }}
          >
            <ITrash /> حذف نهائي
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
    if (classes.some((c) => c.name === name.trim())) return ui.toast('يوجد صف بنفس الاسم', true);
    await addClass(name);
    setName('');
    ui.toast('تمت إضافة الصف');
  };
  return (
    <>
      <div className="card">
        <h3>إضافة صف جديد</h3>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: الصف الأول" onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="btn" onClick={add}>
            <IPlus /> إضافة
          </button>
        </div>
      </div>
      {classes.length > 0 && (
        <div className="card" style={{ padding: '4px 14px' }}>
          {classes.map((c, i) => (
            <div key={c.id} className="list-item">
              <div className="grow">
                <b>{c.name}</b>
                <div className="small muted">{counts?.get(c.id) ?? 0} طالب</div>
              </div>
              <button className="ib" disabled={i === 0} style={{ opacity: i === 0 ? 0.3 : 1 }} onClick={() => moveClassOrder(c.id, -1)} aria-label="أعلى">
                <IUp />
              </button>
              <button className="ib" disabled={i === classes.length - 1} style={{ opacity: i === classes.length - 1 ? 0.3 : 1 }} onClick={() => moveClassOrder(c.id, 1)} aria-label="أسفل">
                <IDown />
              </button>
              <button className="ib" onClick={() => setEdit(c)} aria-label="تعديل">
                <IEdit />
              </button>
              <button className="ib" style={{ color: 'var(--bad)' }} onClick={() => setDel(c)} aria-label="حذف">
                <ITrash />
              </button>
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Sheet onClose={() => setEdit(null)}>
          <h2>تعديل اسم الصف</h2>
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
              حفظ
            </button>
            <button className="btn ghost" onClick={() => setEdit(null)}>
              إلغاء
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
      <h2>حذف «{cls.name}»</h2>
      {n > 0 ? (
        <>
          <p className="muted">يحتوي هذا الصف على {n} طالب. اختر الصف الذي سيُنقلون إليه قبل الحذف (يبقى سجل حضورهم محفوظًا).</p>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">— اختر الصف —</option>
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
        <p className="muted">الصف فارغ، سيتم حذفه.</p>
      )}
      <div className="acts">
        <button
          className="btn danger"
          disabled={n > 0 && !to}
          onClick={async () => {
            await deleteClass(cls.id, to || undefined);
            ui.toast('تم حذف الصف');
            onClose();
          }}
        >
          حذف
        </button>
        <button className="btn ghost" onClick={onClose}>
          إلغاء
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
      if (!p.rows.length) return ui.toast('الملف فارغ', true);
      setParsed(p);
      setMap(p.guess);
    } catch {
      ui.toast('تعذّرت قراءة الملف', true);
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
      ui.toast(`تم استيراد ${res.added} طالب${res.createdClasses ? ` وإنشاء ${res.createdClasses} صف` : ''}${res.skipped ? ` — تم تجاهل ${res.skipped} مكرر` : ''}`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const Col = ({ k, label }: { k: keyof typeof map; label: string }) => (
    <div>
      <label className="f">{label}</label>
      <select value={map[k]} onChange={(e) => setMap({ ...map, [k]: Number(e.target.value) })}>
        <option value={-1}>— لا يوجد —</option>
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
      <h2>استيراد الطلاب من Excel</h2>
      {!parsed ? (
        <>
          <p className="muted small">
            جهّز ملف Excel يحتوي عمود «اسم الطالب»، ويمكن إضافة أعمدة «الصف» و«الرقم» و«الجوال». إذا وُجد عمود الصف تُنشأ الصفوف غير الموجودة تلقائيًا.
          </p>
          <button className="btn block" onClick={choose}>
            <IUpload /> اختيار ملف Excel
          </button>
          <div className="sp" />
          <button className="btn block light" onClick={downloadTemplate}>
            تنزيل نموذج جاهز
          </button>
        </>
      ) : (
        <>
          <p className="small muted">تم العثور على {parsed.rows.length} صف. حدّد الأعمدة:</p>
          <Col k="name" label="عمود اسم الطالب *" />
          <div className="row">
            <div className="grow">
              <Col k="className" label="عمود الصف" />
            </div>
            <div className="grow">
              <Col k="serial" label="عمود الرقم" />
            </div>
          </div>
          <Col k="phone" label="عمود الجوال" />
          {needDefault && (
            <>
              <label className="f">الصف الافتراضي للطلاب بدون صف</label>
              <select value={defCls} onChange={(e) => setDefCls(e.target.value)}>
                <option value="">— اختر —</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <div className="card" style={{ marginTop: 12, background: '#f7f9f8', boxShadow: 'none' }}>
            <b>معاينة ({rows.length} طالب):</b>
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
              استيراد {rows.length} طالب
            </button>
            <button className="btn ghost" onClick={() => setParsed(null)}>
              ملف آخر
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
