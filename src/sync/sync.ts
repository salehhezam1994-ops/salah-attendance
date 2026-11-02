/**
 * المزامنة بين الأجهزة عبر Firestore.
 *
 * المبدأ: قاعدة البيانات المحلية (IndexedDB) هي المصدر الذي تقرأ منه الواجهة دائمًا،
 * فيبقى التطبيق سريعًا ويعمل دون إنترنت. كل تغيير محلي يُسجَّل تلقائيًا في جدول outbox
 * (عبر hooks على الجداول)، ثم يُرفع إلى السحابة عند توفر الاتصال.
 * والتغييرات القادمة من الأجهزة الأخرى تصل لحظيًا عبر مستمعات Firestore وتُكتب محليًا.
 * عند التعارض على نفس السجل يُعتمد الأحدث (updatedAt).
 *
 * البنية في Firestore:  schools/{schoolCode}/{table}/{id}
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDocs,
  initializeFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import Dexie, { type Table, type Transaction } from 'dexie';
import { db, LOCAL_SETTINGS, SYNC_TABLES, type OutboxItem, type SyncTable } from '../db/schema';
import { firebaseConfig, useEmulator } from '../firebaseConfig';

export const syncAvailable = () => !!firebaseConfig;

const keyField = (t: SyncTable) => (t === 'settings' ? 'key' : 'id');
const tbl = (t: SyncTable) => db.table(t) as Table<Record<string, unknown>, string>;

// ---------------------------------------------------------------- hooks
// كل كتابة محلية على الجداول المتزامنة تُسجَّل في outbox بعد نجاح المعاملة.
type Tx = Transaction & { __remote?: boolean; __pending?: Map<string, OutboxItem> };

let hooksInstalled = false;
function record(t: SyncTable, id: string, trans: Tx) {
  if (trans.__remote) return;
  if (t === 'settings' && LOCAL_SETTINGS.has(id)) return;
  if (!trans.__pending) {
    trans.__pending = new Map();
    const pending = trans.__pending;
    trans.on('complete', () => {
      if (!currentSchool) return;
      db.outbox
        .bulkPut([...pending.values()])
        .then(schedulePush)
        .catch(() => {});
    });
  }
  trans.__pending.set(`${t}|${id}`, { key: `${t}|${id}`, table: t, id, at: Date.now() });
}

export function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  window.addEventListener('online', () => (setState({ online: true }), void push()));
  window.addEventListener('offline', () => setState({ online: false }));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void push());
  // إعادة المحاولة دوريًا إن بقيت تغييرات لم تُرفع
  setInterval(() => {
    if (currentSchool && state.pending > 0) void push();
  }, 20000);
  for (const t of SYNC_TABLES) {
    const table = tbl(t);
    table.hook('creating', function (pk, obj, trans) {
      const tx = trans as Tx;
      if (!tx.__remote && !(t === 'settings' && LOCAL_SETTINGS.has(String(pk)))) obj.updatedAt = Date.now();
      record(t, String(pk ?? obj[keyField(t)]), tx);
    });
    table.hook('updating', function (_mods, pk, _obj, trans) {
      const tx = trans as Tx;
      record(t, String(pk), tx);
      if (!tx.__remote) return { updatedAt: Date.now() };
      return undefined;
    });
    table.hook('deleting', function (pk, _obj, trans) {
      record(t, String(pk), trans as Tx);
    });
  }
}

/** تنفيذ كتابة قادمة من السحابة دون إعادة رفعها */
async function remoteTx<T>(tables: string[], fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', tables, async () => {
    (Dexie.currentTransaction as Tx).__remote = true;
    return fn();
  });
}

// ---------------------------------------------------------------- state
let app: FirebaseApp | null = null;
let fs: Firestore | null = null;
let currentSchool: string | null = null;
let unsubs: Unsubscribe[] = [];
let pushTimer: number | undefined;
let pushing = false;

export type SyncState = { enabled: boolean; school: string | null; online: boolean; pending: number; lastSync: number | null; error: string | null; loading: boolean };
let state: SyncState = { enabled: false, school: null, online: navigator.onLine, pending: 0, lastSync: null, error: null, loading: false };
const listeners = new Set<(s: SyncState) => void>();
function setState(p: Partial<SyncState>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l(state));
}
export const getSyncState = () => state;
export function subscribeSync(fn: (s: SyncState) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function ensureFirebase() {
  if (!firebaseConfig) throw new Error('المزامنة غير مفعّلة في هذا الإصدار');
  if (!app) {
    app = initializeApp(firebaseConfig);
    fs = initializeFirestore(app, { ignoreUndefinedProperties: true, experimentalAutoDetectLongPolling: true });
    if (useEmulator) {
      connectFirestoreEmulator(fs, '127.0.0.1', 8080);
      connectAuthEmulator(getAuth(app), 'http://127.0.0.1:9099', { disableWarnings: true });
    }
  }
  const auth = getAuth(app);
  if (!auth.currentUser) await signInAnonymously(auth);
  return fs!;
}

const settingsGet = async <T,>(k: string, d: T) => ((await db.settings.get(k))?.value as T) ?? d;
const settingsPut = (k: string, v: unknown) => db.settings.put({ key: k, value: v });

// ---------------------------------------------------------------- push
export function schedulePush() {
  db.outbox.count().then((n) => setState({ pending: n }));
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void push(), 600);
}

export async function push() {
  if (!currentSchool || pushing) return;
  if (!navigator.onLine) return setState({ online: false, pending: await db.outbox.count() });
  pushing = true;
  try {
    const f = await ensureFirebase();
    for (;;) {
      const items = await db.outbox.orderBy('at').limit(400).toArray();
      if (!items.length) break;
      const batch = writeBatch(f);
      for (const it of items) {
        const local = await tbl(it.table).get(it.id);
        const ref = doc(f, 'schools', currentSchool, it.table, it.id);
        if (local) batch.set(ref, { ...local, _del: false, _srv: serverTimestamp() });
        else batch.set(ref, { [keyField(it.table)]: it.id, _del: true, updatedAt: it.at, _srv: serverTimestamp() });
      }
      await batch.commit();
      // احذف من الطابور فقط ما لم يتغير أثناء الرفع
      await db.transaction('rw', db.outbox, async () => {
        for (const it of items) {
          const cur = await db.outbox.get(it.key);
          if (cur && cur.at === it.at) await db.outbox.delete(it.key);
        }
      });
    }
    await settingsPut('syncLast', Date.now());
    setState({ lastSync: Date.now(), error: null, pending: await db.outbox.count() });
  } catch (e) {
    setState({ error: (e as Error).message, pending: await db.outbox.count() });
  } finally {
    pushing = false;
  }
}

// ---------------------------------------------------------------- pull
type Cursor = Partial<Record<SyncTable, number>>;

async function applyRemote(t: SyncTable, docs: Record<string, unknown>[], cursor: Cursor) {
  let maxSrv = cursor[t] ?? 0;
  await remoteTx([t, 'outbox'], async () => {
    for (const d of docs) {
      const srv = (d._srv as Timestamp | null)?.toMillis?.() ?? 0;
      if (srv > maxSrv) maxSrv = srv;
      const id = String(d[keyField(t)]);
      if (t === 'settings' && LOCAL_SETTINGS.has(id)) continue;
      const pend = await db.outbox.get(`${t}|${id}`);
      const local = await tbl(t).get(id);
      const remoteAt = Number(d.updatedAt ?? 0);
      // يوجد تعديل محلي أحدث لم يُرفع بعد → نحتفظ بالمحلي
      if (pend && local && Number(local.updatedAt ?? 0) > remoteAt) continue;
      if (pend && !local && pend.at > remoteAt) continue;
      if (d._del) {
        if (local) await tbl(t).delete(id);
      } else {
        const { _srv, _del, ...rec } = d;
        void _srv;
        void _del;
        await tbl(t).put(rec);
      }
      if (pend) await db.outbox.delete(pend.key);
    }
  });
  cursor[t] = maxSrv;
}

function listen(school: string, cursor: Cursor, onFirst?: (t: SyncTable, empty: boolean) => void) {
  const f = fs!;
  for (const t of SYNC_TABLES) {
    const q = query(collection(f, 'schools', school, t), where('_srv', '>', Timestamp.fromMillis(cursor[t] ?? 0)), orderBy('_srv'));
    let first = true;
    const un = onSnapshot(
      q,
      { includeMetadataChanges: false },
      async (snap) => {
        const docs = snap
          .docChanges()
          .filter((c) => c.type !== 'removed' && !c.doc.metadata.hasPendingWrites)
          .map((c) => c.doc.data());
        if (docs.length) {
          await applyRemote(t, docs, cursor);
          await settingsPut('syncCursor', cursor);
        }
        setState({ online: !snap.metadata.fromCache, lastSync: Date.now(), error: null });
        if (first) {
          first = false;
          onFirst?.(t, snap.empty);
        }
      },
      (err) => setState({ error: err.message }),
    );
    unsubs.push(un);
  }
}

function stopListening() {
  unsubs.forEach((u) => u());
  unsubs = [];
}

// ---------------------------------------------------------------- public API
/** يُستدعى عند تشغيل التطبيق */
export async function startSync() {
  installHooks();
  const school = await settingsGet<string | null>('syncSchool', null);
  setState({ enabled: !!school, school, lastSync: await settingsGet<number | null>('syncLast', null), pending: await db.outbox.count() });
  if (!school || !firebaseConfig) return;
  currentSchool = school;
  try {
    await ensureFirebase();
    listen(school, await settingsGet<Cursor>('syncCursor', {}));
    void push();
  } catch (e) {
    setState({ error: (e as Error).message });
  }
}

function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = new Uint8Array(12);
  crypto.getRandomValues(r);
  return [...r].map((b) => chars[b % chars.length]).join('');
}
export const formatCode = (c: string) => c.replace(/(.{4})(?=.)/g, '$1-');
const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** إنشاء مساحة مدرسة جديدة ورفع كل البيانات المحلية إليها (للمسؤول) */
export async function createSchool() {
  await ensureFirebase();
  const code = newCode();
  await settingsPut('syncSchool', code);
  await settingsPut('syncCursor', {});
  const items: OutboxItem[] = [];
  for (const t of SYNC_TABLES) {
    const keys = (await tbl(t).toCollection().primaryKeys()) as string[];
    for (const id of keys) if (!(t === 'settings' && LOCAL_SETTINGS.has(id))) items.push({ key: `${t}|${id}`, table: t, id, at: Date.now() });
  }
  await db.outbox.bulkPut(items);
  currentSchool = code;
  setState({ enabled: true, school: code, pending: items.length });
  await push();
  listen(code, {});
  return code;
}

/** انضمام جهاز جديد إلى مدرسة موجودة: يستبدل البيانات المحلية ببيانات المدرسة */
export async function joinSchool(rawCode: string) {
  const code = normCode(rawCode);
  if (code.length < 8) throw new Error('الرمز غير صحيح');
  setState({ loading: true, error: null });
  try {
    const f = await ensureFirebase();
    const probe = await getDocs(query(collection(f, 'schools', code, 'users'), limit(1)));
    if (probe.empty) throw new Error('لم يتم العثور على مدرسة بهذا الرمز');
    stopListening();
    await remoteTx(['classes', 'students', 'attendance', 'users', 'settings', 'outbox'], async () => {
      await Promise.all(SYNC_TABLES.map((t) => tbl(t).clear()));
      await db.outbox.clear();
    });
    await settingsPut('syncSchool', code);
    await settingsPut('syncCursor', {});
    currentSchool = code;
    setState({ enabled: true, school: code });
    const cursor: Cursor = {};
    await new Promise<void>((resolve) => {
      const done = new Set<SyncTable>();
      listen(code, cursor, (t) => {
        done.add(t);
        if (done.size === SYNC_TABLES.length) resolve();
      });
    });
  } finally {
    setState({ loading: false });
  }
}

/** إيقاف المزامنة على هذا الجهاز (تبقى البيانات المحلية) */
export async function leaveSchool() {
  stopListening();
  currentSchool = null;
  await db.settings.bulkDelete(['syncSchool', 'syncCursor', 'syncLast']);
  await db.outbox.clear();
  setState({ enabled: false, school: null, pending: 0, lastSync: null });
}

/** رفع كل البيانات من جديد (بعد استرجاع نسخة احتياطية مثلًا) */
export async function requeueAll() {
  if (!currentSchool) return;
  const items: OutboxItem[] = [];
  for (const t of SYNC_TABLES) {
    const keys = (await tbl(t).toCollection().primaryKeys()) as string[];
    for (const id of keys) if (!(t === 'settings' && LOCAL_SETTINGS.has(id))) items.push({ key: `${t}|${id}`, table: t, id, at: Date.now() });
  }
  await db.outbox.bulkPut(items);
  schedulePush();
}
