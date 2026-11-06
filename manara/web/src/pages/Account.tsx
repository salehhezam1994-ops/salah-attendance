import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { post } from '../api';
import { useApp } from '../state';
import { ErrorBox } from '../components/ui';
import { IBack } from '../components/Icons';

export default function Account() {
  const { t, me, refresh, locale } = useApp();
  const nav = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>(me?.user.is_guest ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await post(`/auth/${mode}`, mode === 'register' ? { email, password, name: name || undefined, locale } : { email, password });
      await refresh();
      nav('/');
    } catch (e: any) {
      setErr(e.code === 'invalid_input' ? 'default' : e.code);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await post('/auth/logout');
    try {
      await caches.delete('manara-data-v1');
    } catch {
      /* ignore */
    }
    await refresh();
    nav('/welcome');
  };

  return (
    <div className="welcome">
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav(-1)} aria-label={t('back')}><IBack style={{ transform: locale === 'ar' ? 'scaleX(-1)' : undefined }} /></button>
        <h1 className="title" style={{ margin: 0 }}>{t('account')}</h1>
      </div>
      {me && !me.user.is_guest ? (
        <div className="card">
          <p><b>{me.user.name || me.user.email}</b></p>
          <p className="muted">{me.user.email}</p>
          <button className="btn" onClick={logout}>{t('logout')}</button>
        </div>
      ) : (
        <form className="card" onSubmit={submit}>
          {me?.user.is_guest ? <p className="banner info">{t('guest_note')}</p> : null}
          <div className="tabs" role="tablist">
            <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>{t('create_account')}</button>
            <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>{t('login')}</button>
          </div>
          {mode === 'register' && (
            <label className="field"><span>{t('name')}</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          )}
          <label className="field"><span>{t('email')}</span><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" dir="ltr" /></label>
          <label className="field"><span>{t('password')}</span><input className="input" type="password" required minLength={mode === 'register' ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} dir="ltr" /></label>
          {err && <ErrorBox code={err} />}
          <button className="btn primary block" disabled={busy}>{mode === 'register' ? t('create_account') : t('login')}</button>
          {!me && <Link to="/welcome" className="btn ghost block" style={{ marginTop: 8 }}>{t('start')}</Link>}
        </form>
      )}
    </div>
  );
}
