import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../state';
import { IPlan, ISettings } from './Icons';
import { Sheet } from './ui';

/** Journey header: title, journey switcher, plan and preferences shortcuts. */
export function TopBar({ journeyId, title, subtitle }: { journeyId: string; title: string; subtitle?: string }) {
  const { t, me } = useApp();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="topbar">
        <button className="title" style={{ background: 'none', border: 0, textAlign: 'start', padding: 0 }} onClick={() => setOpen(true)} aria-haspopup="dialog">
          {subtitle && <span className="faint">{subtitle}</span>}
          <b>{title} ▾</b>
        </button>
        <Link to={`/j/${journeyId}/plan`} className="icon-btn" aria-label={t('plan_page')} title={t('plan_page')}><IPlan /></Link>
        <Link to="/prefs" className="icon-btn" aria-label={t('prefs')} title={t('prefs')}><ISettings /></Link>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} label={t('my_journeys')}>
        <h3>{t('my_journeys')}</h3>
        {me?.journeys.map((j) => (
          <button key={j.id} className="list-item" style={{ width: '100%', textAlign: 'start', background: 'none', border: 0, borderBottom: '1px solid var(--line)' }} onClick={() => { setOpen(false); nav(['active', 'paused'].includes(j.status) ? `/j/${j.id}` : `/j/${j.id}/setup`); }}>
            <div className="spread"><b>{j.title || j.topic || '…'}</b>{j.progress !== null && <span className="tag">{j.progress}%</span>}</div>
          </button>
        ))}
        <Link to="/new" className="btn primary block" style={{ marginTop: 12 }} onClick={() => setOpen(false)}>+ {t('new_journey')}</Link>
        <Link to="/account" className="btn ghost block" style={{ marginTop: 6 }} onClick={() => setOpen(false)}>{t('account')}</Link>
      </Sheet>
    </>
  );
}
