/**
 * سجل التراجع/الإعادة (لكل جهاز، في الذاكرة فقط).
 * - كل معاملة Dexie محلية = خطوة واحدة (أو مجموعة عبر historyGroup).
 * - التغييرات القادمة من المزامنة (__remote) لا تُسجَّل.
 * - عند التراجع: لا نكتب فوق سجل غيّره شخص آخر بعد خطوتنا (نقارن updatedAt).
 */
import Dexie, { type Transaction } from 'dexie';
import { db } from '../db/schema';
import { t } from '../i18n';

export const HIST_TABLES = ['classes', 'students', 'attendance', 'activities'] as const;
type Rec = Record<string, unknown> & { updatedAt?: number };
interface Change {
  table: string;
  id: string;
  before?: Rec;
  after?: Rec;
}
export interface Step {
  label: string;
  changes: Change[];
  at: number;
}
type Tx = Transaction & { __remote?: boolean; __hist?: Change[]; __noHist?: boolean };

const MAX = 30;
let undoStack: Step[] = [];
let redoStack: Step[] = [];
let group: Change[] | null = null;
let groupDepth = 0;
let suspended = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const subscribeHistory = (f: () => void) => (subs.add(f), () => subs.delete(f));
export const historyState = () => ({ undo: undoStack[undoStack.length - 1]?.label ?? null, redo: redoStack[redoStack.length - 1]?.label ?? null });
export function clearHistory() {
  undoStack = [];
  redoStack = [];
  emit();
}

const clone = (o: unknown) => (o === undefined ? undefined : (JSON.parse(JSON.stringify(o)) as Rec));

function push(changes: Change[]) {
  // دمج التغييرات على نفس السجل: أول «قبل» وآخر «بعد»
  const m = new Map<string, Change>();
  for (const c of changes) {
    const k = c.table + '|' + c.id;
    const prev = m.get(k);
    if (prev) prev.after = c.after;
    else m.set(k, { ...c });
  }
  const list = [...m.values()].filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after));
  if (!list.length) return;
  undoStack.push({ label: describe(list), changes: list, at: Date.now() });
  if (undoStack.length > MAX) undoStack.shift();
  redoStack = [];
  emit();
}

function capture(trans: Transaction, c: Change) {
  const tx = trans as Tx;
  if (tx.__remote || tx.__noHist || suspended > 0 || tx.mode === 'versionchange') return;
  if (group) {
    group.push(c);
    return;
  }
  if (!tx.__hist) {
    tx.__hist = [];
    const list = tx.__hist;
    tx.on('complete', () => push(list));
  }
  tx.__hist.push(c);
}

/** يُستدعى مرة واحدة عند بدء التطبيق */
export function installHistoryHooks() {
  for (const name of HIST_TABLES) {
    const table = db.table(name);
    table.hook('creating', function (pk, obj, trans) {
      const id = String(pk ?? (obj as Rec).id);
      const after = clone(obj);
      capture(trans, { table: name, id, before: undefined, after });
      // قيمة updatedAt النهائية تُضبط في خطاف المزامنة قبلنا أو بعدنا؛ نقرؤها بعد الحفظ
      this.onsuccess = () => {
        if (after) after.updatedAt = (obj as Rec).updatedAt;
      };
    });
    table.hook('updating', function (mods, pk, obj, trans) {
      const before = clone(obj)!;
      const after = clone(obj)!;
      for (const [k, v] of Object.entries(mods)) {
        if (v === undefined) delete after[k];
        else Dexie.setByKeyPath(after, k, v);
      }
      const c: Change = { table: name, id: String(pk), before, after };
      capture(trans, c);
      this.onsuccess = (updated: Rec) => {
        c.after = clone(updated);
      };
      return undefined;
    });
    table.hook('deleting', function (pk, obj, trans) {
      capture(trans, { table: name, id: String(pk), before: clone(obj), after: undefined });
    });
  }
}

/** تجميع عدة معاملات في خطوة واحدة (مثل أرشفة عدة طلاب) */
export async function historyGroup<T>(fn: () => Promise<T>): Promise<T> {
  const outer = groupDepth === 0;
  if (outer) group = [];
  groupDepth++;
  try {
    return await fn();
  } finally {
    groupDepth--;
    if (outer) {
      const g = group!;
      group = null;
      push(g);
    }
  }
}

/** تنفيذ كتابة دون تسجيلها في السجل (مثل الاسترجاع من نسخة احتياطية) */
export async function withoutHistory<T>(fn: () => Promise<T>): Promise<T> {
  suspended++;
  try {
    return await fn();
  } finally {
    suspended--;
  }
}

const same = (cur: Rec | undefined, exp: Rec | undefined) => (!cur && !exp) || (!!cur && !!exp && (cur.updatedAt ?? 0) === (exp.updatedAt ?? 0));

function relink(table: string, id: string, old: Rec | undefined, now: Rec | undefined) {
  if (!old) return;
  for (const st of [...undoStack, ...redoStack])
    for (const c of st.changes) {
      if (c.table !== table || c.id !== id) continue;
      if (c.after && c.after.updatedAt === old.updatedAt) c.after = now;
      if (c.before && c.before.updatedAt === old.updatedAt) c.before = now;
    }
}

/** تطبيق خطوة باتجاه معيّن؛ يرجع عدد السجلات المتخطّاة بسبب تعارض */
async function apply(step: Step, dir: 'undo' | 'redo'): Promise<number> {
  let skipped = 0;
  const tables = [...new Set(step.changes.map((c) => c.table))];
  await db.transaction('rw', tables, async () => {
    (Dexie.currentTransaction as Tx).__noHist = true;
    const list = dir === 'undo' ? [...step.changes].reverse() : step.changes;
    for (const c of list) {
      const tb = db.table(c.table);
      const expect = dir === 'undo' ? c.after : c.before;
      const target = dir === 'undo' ? c.before : c.after;
      const cur = (await tb.get(c.id)) as Rec | undefined;
      if (!same(cur, expect)) {
        skipped++;
        continue;
      }
      if (target) {
        const { updatedAt: _u, ...rest } = target;
        void _u;
        await tb.put(rest); // يضع خطاف المزامنة updatedAt جديدًا فيُرفع كتعديل أحدث
      } else await tb.delete(c.id);
      const now = clone(await tb.get(c.id));
      // نفس الحالة قد تكون «قبل» أو «بعد» في خطوات أخرى؛ نحدّث توقعاتها بالقيمة الجديدة
      relink(c.table, c.id, target, now);
      if (dir === 'undo') c.before = now;
      else c.after = now;
    }
  });
  return skipped;
}

export async function undo() {
  const step = undoStack.pop();
  if (!step) return null;
  const skipped = await apply(step, 'undo');
  redoStack.push(step);
  emit();
  return { label: step.label, skipped };
}
export async function redo() {
  const step = redoStack.pop();
  if (!step) return null;
  const skipped = await apply(step, 'redo');
  undoStack.push(step);
  emit();
  return { label: step.label, skipped };
}

/** وصف مختصر للخطوة */
function describe(list: Change[]): string {
  const by = (tb: string) => list.filter((c) => c.table === tb);
  const att = by('attendance');
  const st = by('students');
  const cl = by('classes');
  const ac = by('activities');
  const parts: string[] = [];
  const added = (a: Change[]) => a.filter((c) => !c.before && c.after).length;
  const removed = (a: Change[]) => a.filter((c) => c.before && !c.after).length;
  const edited = (a: Change[]) => a.filter((c) => c.before && c.after).length;
  if (st.length) {
    const one = st.length === 1 ? String((st[0].after ?? st[0].before)?.name ?? '') : '';
    if (added(st)) parts.push(t('h_st_added', { n: added(st) }));
    if (removed(st)) parts.push(one ? t('h_st_deleted1', { name: one }) : t('h_st_deleted', { n: removed(st) }));
    if (edited(st)) parts.push(one ? t('h_st_edited1', { name: one }) : t('h_st_edited', { n: edited(st) }));
  }
  if (cl.length) parts.push(t('h_classes', { n: cl.length }));
  if (ac.length) parts.push(t('h_acts', { n: ac.length }));
  if (att.length && !st.length) {
    const p = att.filter((c) => c.after?.status === 'P').length;
    const a = att.filter((c) => c.after?.status === 'A').length;
    const d = removed(att);
    if (att.length === 1) {
      const c = att[0];
      parts.push(c.after ? (c.after.status === 'P' ? t('h_att_p1') : c.after.note !== c.before?.note || c.after.excused !== c.before?.excused ? t('h_att_note1') : t('h_att_a1')) : t('h_att_c1'));
    } else {
      if (p) parts.push(t('h_att_p', { n: p }));
      if (a) parts.push(t('h_att_a', { n: a }));
      if (d) parts.push(t('h_att_c', { n: d }));
    }
  }
  return parts.join(' • ') || t('h_changes', { n: list.length });
}
