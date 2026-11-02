import { useEffect, useState } from 'react';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { createSchool, formatCode, getSyncState, joinSchool, leaveSchool, subscribeSync, syncAvailable, push, type SyncState } from './sync';
import { useUI } from '../components/ui';

export function useSyncState(): SyncState {
  const [s, setS] = useState(getSyncState());
  useEffect(() => {
    const un = subscribeSync(setS);
    return () => {
      un();
    };
  }, []);
  return s;
}

const ago = (t: number | null) => {
  if (!t) return '—';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'الآن';
  if (m < 60) return `قبل ${m} دقيقة`;
  const h = Math.round(m / 60);
  return h < 24 ? `قبل ${h} ساعة` : new Date(t).toLocaleDateString('ar-EG');
};

/** مؤشر صغير في الشريط العلوي */
export function SyncDot() {
  const s = useSyncState();
  if (!s.enabled) return null;
  const ok = s.online && s.pending === 0 && !s.error;
  const title = !s.online ? 'غير متصل — سيتم الرفع لاحقًا' : s.pending ? `بانتظار الرفع: ${s.pending}` : 'تمت المزامنة';
  return (
    <span title={title} aria-label={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, background: 'rgba(255,255,255,.15)', borderRadius: 999, padding: '3px 8px' }}>
      <i style={{ width: 8, height: 8, borderRadius: 9, background: ok ? '#4ade80' : '#fbbf24', display: 'inline-block' }} />
      {ok ? 'متزامن' : !s.online ? 'دون اتصال' : s.pending ? `${s.pending} بانتظار الرفع` : 'مزامنة'}
    </span>
  );
}

/** بطاقة المزامنة في صفحة «المزيد» */
export function SyncCard({ isAdmin }: { isAdmin: boolean }) {
  const s = useSyncState();
  const ui = useUI();
  const [busy, setBusy] = useState(false);
  if (!syncAvailable()) return null;

  const share = async () => {
    const text = `رمز الانضمام لتطبيق متابعة حضور الصلاة:\n${formatCode(s.school!)}`;
    if (Capacitor.isNativePlatform()) await Share.share({ text, dialogTitle: 'مشاركة رمز المدرسة' });
    else {
      await navigator.clipboard?.writeText(formatCode(s.school!));
      ui.toast('تم نسخ الرمز');
    }
  };

  return (
    <div className="card">
      <h3>المزامنة بين الأجهزة</h3>
      {!s.enabled ? (
        isAdmin ? (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>
              فعّل المزامنة ليستطيع المشرفون استخدام التطبيق على هواتفهم ورؤية نفس البيانات. سيظهر لك رمز تعطيه لكل مشرف.
            </p>
            <button
              className="btn block"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await createSchool();
                  ui.toast('تم تفعيل المزامنة ورفع البيانات');
                } catch (e) {
                  ui.toast('تعذّر التفعيل: ' + (e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'جارٍ رفع البيانات...' : 'تفعيل المزامنة وإنشاء رمز المدرسة'}
            </button>
          </>
        ) : (
          <p className="small muted">المزامنة غير مفعّلة على هذا الجهاز.</p>
        )
      ) : (
        <>
          {isAdmin && (
            <>
              <p className="small muted" style={{ margin: '0 0 6px' }}>
                رمز المدرسة (يُدخله المشرف عند فتح التطبيق أول مرة على هاتفه):
              </p>
              <div className="row">
                <b dir="ltr" className="grow" style={{ fontSize: 22, letterSpacing: 2, background: 'var(--brand-soft)', color: 'var(--brand)', borderRadius: 10, padding: '8px 12px', textAlign: 'center' }}>
                  {formatCode(s.school!)}
                </b>
                <button className="btn sm" onClick={share}>
                  مشاركة
                </button>
              </div>
            </>
          )}
          <div className="small" style={{ marginTop: 10, lineHeight: 1.9 }}>
            <div>
              الحالة: <b style={{ color: s.online ? 'var(--ok)' : 'var(--warn)' }}>{s.online ? 'متصل' : 'غير متصل (يُحفظ محليًا ويُرفع لاحقًا)'}</b>
            </div>
            <div>تغييرات بانتظار الرفع: {s.pending}</div>
            <div>آخر مزامنة: {ago(s.lastSync)}</div>
            {s.error && <div style={{ color: 'var(--bad)' }}>خطأ: {s.error}</div>}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm ghost grow" onClick={() => void push()}>
              مزامنة الآن
            </button>
            <button
              className="btn sm ghost grow"
              onClick={async () => {
                if (await ui.confirm('إيقاف المزامنة على هذا الجهاز؟ تبقى البيانات الحالية على الهاتف لكن لن تصله تحديثات الآخرين.', { ok: 'إيقاف', danger: true })) await leaveSchool();
              }}
            >
              إيقاف المزامنة
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** انضمام جهاز مشرف إلى مدرسة موجودة */
export function JoinSchool({ onCancel }: { onCancel: () => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const s = useSyncState();
  return (
    <div className="card">
      <h3>الانضمام إلى مدرسة موجودة</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        اطلب رمز المدرسة من مسؤول التطبيق (يجده في: المزيد ← المزامنة بين الأجهزة). يلزم اتصال بالإنترنت لهذه الخطوة فقط.
      </p>
      <input dir="ltr" value={code} onChange={(e) => (setCode(e.target.value), setErr(''))} placeholder="XXXX-XXXX-XXXX" style={{ textAlign: 'center', fontSize: 20, letterSpacing: 2 }} />
      {err && <p className="small" style={{ color: 'var(--bad)' }}>{err}</p>}
      <div className="sp" />
      <button
        className="btn block"
        disabled={s.loading || code.replace(/[^A-Za-z0-9]/g, '').length < 8}
        onClick={async () => {
          try {
            await joinSchool(code);
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        {s.loading ? 'جارٍ تنزيل البيانات...' : 'انضمام'}
      </button>
      <div className="sp" />
      <button className="btn block ghost" onClick={onCancel} disabled={s.loading}>
        رجوع
      </button>
    </div>
  );
}
