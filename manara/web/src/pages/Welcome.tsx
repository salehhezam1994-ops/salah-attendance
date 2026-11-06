import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { post } from '../api';
import { useApp } from '../state';
import { ICheck } from '../components/Icons';
import { ErrorBox } from '../components/ui';

export default function Welcome() {
  const { t, locale, setLocale, refresh, me } = useApp();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (me) return <Navigate to="/" replace />;

  const start = async () => {
    setBusy(true);
    try {
      await post('/auth/guest', { locale });
      await refresh();
      nav('/new');
    } catch (e: any) {
      setErr(e.code ?? 'default');
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <div className="spread" style={{ marginBottom: 24 }}>
        <span />
        <button className="btn sm ghost" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>{locale === 'ar' ? 'English' : 'العربية'}</button>
      </div>
      <img src="/icon.svg" alt="" className="lighthouse" />
      <h1 style={{ fontSize: '2rem' }}>{t('app')}</h1>
      <p className="muted" style={{ fontSize: '1.1rem' }}>{t('tagline')}</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: '18px 0 28px' }}>
        {t.d.welcome_points.map((p) => (
          <li key={p} className="row" style={{ marginBottom: 10, alignItems: 'flex-start' }}>
            <ICheck style={{ width: 22, color: 'var(--gold)', flex: 'none', marginTop: 4 }} /> <span>{p}</span>
          </li>
        ))}
      </ul>
      {err && <ErrorBox code={err} />}
      <button className="btn primary block" style={{ minHeight: 54, fontSize: '1.1rem' }} onClick={start} disabled={busy}>
        {t('start')}
      </button>
      <Link to="/account" className="btn ghost block" style={{ marginTop: 8 }}>{t('have_account')}</Link>
    </div>
  );
}
