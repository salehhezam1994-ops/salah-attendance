import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useParams, Link, useLocation } from 'react-router-dom';
import '@fontsource/tajawal/400.css';
import '@fontsource/tajawal/500.css';
import '@fontsource/tajawal/700.css';
import './styles.css';
import { AppProvider, useApp } from './state';
import { IBook, IChart, IChat, IHome, IMap } from './components/Icons';
import { Loading } from './components/ui';
import { useReminders } from './reminders';
import Welcome from './pages/Welcome';
import Account from './pages/Account';
import NewJourney from './pages/NewJourney';
import Setup from './pages/Setup';
import Home from './pages/Home';
import Lesson from './pages/Lesson';
import MapPage from './pages/MapPage';
import Companion from './pages/Companion';
import Library from './pages/Library';
import Progress from './pages/Progress';
import Review from './pages/Review';
import PlanPage from './pages/PlanPage';
import Prefs from './pages/Prefs';
import Share from './pages/Share';

function JourneyShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  const { id } = useParams();
  const { t } = useApp();
  const mini = new URLSearchParams(useLocation().search).get('mini') === '1';
  useReminders(id);
  return (
    <div className={`app${mini ? ' mini-mode' : ''}`}>
      <nav className="nav" aria-label="main">
        <Link to="/" className="brand">
          <img src="/icon.svg" alt="" /> {t('app')}
        </Link>
        <NavLink to={`/j/${id}`} end><IHome />{t('nav_home')}</NavLink>
        <NavLink to={`/j/${id}/map`}><IMap />{t('nav_map')}</NavLink>
        <NavLink to={`/j/${id}/companion`}><IChat />{t('nav_companion')}</NavLink>
        <NavLink to={`/j/${id}/library`}><IBook />{t('nav_library')}</NavLink>
        <NavLink to={`/j/${id}/progress`}><IChart />{t('nav_progress')}</NavLink>
      </nav>
      <main className={`main${wide ? ' wide' : ''}`}>{children}</main>
    </div>
  );
}

function Root() {
  const { me, loading } = useApp();
  if (loading) return <div className="welcome"><Loading /></div>;
  if (!me) return <Navigate to="/welcome" replace />;
  const active = me.journeys.find((j) => ['active', 'paused'].includes(j.status)) ?? me.journeys[0];
  if (!active) return <Navigate to="/new" replace />;
  if (['interviewing', 'confirming', 'planning', 'proposed', 'plan_failed'].includes(active.status)) return <Navigate to={`/j/${active.id}/setup`} replace />;
  return <Navigate to={`/j/${active.id}`} replace />;
}

function Guard({ children }: { children: React.ReactNode }) {
  const { me, loading } = useApp();
  if (loading) return <div className="welcome"><Loading /></div>;
  if (!me) return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Root />} />
      <Route path="/welcome" element={<Welcome />} />
      <Route path="/account" element={<Account />} />
      <Route path="/share" element={<Guard><Share /></Guard>} />
      <Route path="/new" element={<Guard><NewJourney /></Guard>} />
      <Route path="/prefs" element={<Guard><Prefs /></Guard>} />
      <Route path="/j/:id/setup" element={<Guard><Setup /></Guard>} />
      <Route path="/j/:id" element={<Guard><JourneyShell><Home /></JourneyShell></Guard>} />
      <Route path="/j/:id/lesson/:lid" element={<Guard><JourneyShell><Lesson /></JourneyShell></Guard>} />
      <Route path="/j/:id/map" element={<Guard><JourneyShell wide><MapPage /></JourneyShell></Guard>} />
      <Route path="/j/:id/companion" element={<Guard><JourneyShell><Companion /></JourneyShell></Guard>} />
      <Route path="/j/:id/library" element={<Guard><JourneyShell><Library /></JourneyShell></Guard>} />
      <Route path="/j/:id/progress" element={<Guard><JourneyShell><Progress /></JourneyShell></Guard>} />
      <Route path="/j/:id/review" element={<Guard><JourneyShell><Review /></JourneyShell></Guard>} />
      <Route path="/j/:id/plan" element={<Guard><JourneyShell><PlanPage /></JourneyShell></Guard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
