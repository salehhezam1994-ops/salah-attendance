import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { createUser, setSetting, verifyPin } from '../db/repo';
import { IMosque } from '../components/Icons';
import { JoinSchool } from '../sync/SyncUI';
import { syncAvailable } from '../sync/sync';
import { t, LangSwitch } from '../i18n';
import { SchoolPicker } from '../components/SchoolSwitch';

function PinPad({ value, onChange, len = 4 }: { value: string; onChange: (v: string) => void; len?: number }) {
  return (
    <>
      <div className="pin">
        {Array.from({ length: len }, (_, i) => (
          <i key={i} className={i < value.length ? 'f' : ''} />
        ))}
      </div>
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
          k === '' ? (
            <span key={i} />
          ) : (
            <button key={i} onClick={() => (k === '⌫' ? onChange(value.slice(0, -1)) : value.length < len && onChange(value + k))}>
              {k}
            </button>
          ),
        )}
      </div>
    </>
  );
}

function Logo({ sub }: { sub: string }) {
  return (
    <div className="logo">
      <IMosque />
      <h1>{t('app_full')}</h1>
      <p>{sub}</p>
    </div>
  );
}

/** الإعداد الأول: إنشاء حساب المسؤول */
export function Setup({ onDone }: { onDone: (id: string) => void }) {
  const [org, setOrg] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [step, setStep] = useState(0);
  const [err, setErr] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (step === 1 && pin.length === 4) setStep(2);
  }, [pin, step]);
  useEffect(() => {
    if (step === 2 && pin2.length === 4) {
      if (pin2 !== pin) {
        setErr(t('pin_mismatch'));
        setPin('');
        setPin2('');
        setStep(1);
      } else {
        (async () => {
          const u = await createUser(name || t('admin_default'), pin, 'admin');
          if (org.trim()) await setSetting('org', org.trim());
          onDone(u.id);
        })();
      }
    }
  }, [pin2, pin, step, name, org, onDone]);

  return (
    <div className="auth">
      <Logo sub={t('setup_sub')} />
      <LangSwitch />
      <SchoolPicker />
      {joining ? (
        <JoinSchool onCancel={() => setJoining(false)} />
      ) : (
      <div className="card">
        {step === 0 && (
          <>
            <h3>{t('create_admin')}</h3>
            <label className="f">{t('org_label')}</label>
            <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder={t('org_example')} />
            <label className="f">{t('admin_name')}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('name_ph')} />
            <div className="sp" />
            <button className="btn block" disabled={!name.trim()} onClick={() => setStep(1)}>
              {t('next_pin')}
            </button>
            {syncAvailable() && (
              <>
                <div className="center small muted" style={{ margin: '14px 0 8px' }}>
                  {t('or')}
                </div>
                <button className="btn block light" onClick={() => setJoining(true)}>
                  {t('join_btn')}
                </button>
              </>
            )}
          </>
        )}
        {step > 0 && (
          <>
            <h3 className="center">{step === 1 ? t('choose_pin') : t('repeat_pin')}</h3>
            {err && <p className="center small" style={{ color: 'var(--bad)' }}>{err}</p>}
            {step === 1 ? <PinPad value={pin} onChange={setPin} /> : <PinPad value={pin2} onChange={setPin2} />}
          </>
        )}
      </div>
      )}
    </div>
  );
}

export function Login({ onLogin }: { onLogin: (id: string) => void }) {
  const users = useLiveQuery(() => db.users.filter((u) => !!u.active).toArray(), []);
  const [sel, setSel] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');

  const [auto, setAuto] = useState(false);
  useEffect(() => {
    // اختيار تلقائي عند وجود مستخدم واحد فقط (ويُلغى إذا وصل مستخدمون آخرون من المزامنة)
    if (users && users.length === 1 && !sel) (setSel(users[0].id), setAuto(true));
    else if (users && users.length > 1 && auto) (setSel(null), setAuto(false));
  }, [users, sel, auto]);

  useEffect(() => {
    if (sel && pin.length === 4) {
      verifyPin(sel, pin).then((u) => {
        if (u) onLogin(u.id);
        else {
          setErr(t('wrong_pin'));
          setPin('');
        }
      });
    }
  }, [pin, sel, onLogin]);

  if (!users) return null;
  const selected = users.find((u) => u.id === sel);
  return (
    <div className="auth">
      <Logo sub={t('login_sub')} />
      <LangSwitch />
      <SchoolPicker />
      <div className="card">
        {!selected ? (
          <>
            <h3>{t('choose_user')}</h3>
            {users.map((u) => (
              <button key={u.id} className="list-item" style={{ width: '100%' }} onClick={() => setSel(u.id)}>
                <span className="avatar">{u.name.trim()[0]}</span>
                <span className="grow" style={{ textAlign: 'start', fontWeight: 700 }}>
                  {u.name}
                  <div className="small muted">{u.role === 'admin' ? t('role_admin') : t('role_sup')}</div>
                </span>
              </button>
            ))}
          </>
        ) : (
          <>
            <div className="row">
              <span className="avatar">{selected.name.trim()[0]}</span>
              <b className="grow">{selected.name}</b>
              {users.length > 1 && (
                <button className="btn sm ghost" onClick={() => (setSel(null), setAuto(false), setPin(''), setErr(''))}>
                  {t('change')}
                </button>
              )}
            </div>
            <p className="center muted small" style={{ marginBottom: 0 }}>
              {t('enter_pin')}
            </p>
            {err && <p className="center small" style={{ color: 'var(--bad)', margin: 4 }}>{err}</p>}
            <PinPad value={pin} onChange={(v) => (setErr(''), setPin(v))} />
          </>
        )}
      </div>
    </div>
  );
}
