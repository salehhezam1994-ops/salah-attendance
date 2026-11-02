import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { HashRouter, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { App as CapApp } from '@capacitor/app';
import { db, type Prayer } from './db/schema';
import { AuthProvider, getSessionUserId, setSessionUserId, useAuth } from './auth';
import { UIProvider } from './components/ui';
import { IChart, IChecklist, IMore, IReport, IUsers } from './components/Icons';
import { Login, Setup } from './pages/Login';
import AttendancePage from './pages/Attendance';
import DashboardPage from './pages/Dashboard';
import StudentsPage from './pages/Students';
import StudentProfile from './pages/StudentProfile';
import ReportsPage from './pages/Reports';
import MorePage from './pages/More';
import { guessPrayer, todayISO } from './lib/dates';

// حالة مشتركة بين الشاشات: التاريخ والصلاة والصف المختار
interface Sel {
  date: string;
  prayer: Prayer;
  classId: string | null;
  set: (p: Partial<Omit<Sel, 'set'>>) => void;
}
const SelCtx = createContext<Sel>(null as never);
export const useSel = () => useContext(SelCtx);

function SelProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState({ date: todayISO(), prayer: guessPrayer(), classId: null as string | null });
  const set = useCallback((p: Partial<typeof s>) => setS((o) => ({ ...o, ...p })), []);
  return <SelCtx.Provider value={{ ...s, set }}>{children}</SelCtx.Provider>;
}

function BackButtonHandler() {
  const nav = useNavigate();
  useEffect(() => {
    const h = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (document.querySelector('.overlay')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        return;
      }
      if (canGoBack && location.hash !== '#/' && location.hash !== '') nav(-1);
      else CapApp.exitApp();
    });
    return () => {
      h.then((x) => x.remove());
    };
  }, [nav]);
  return null;
}

function Shell() {
  const { user } = useAuth();
  const canReports = user.role === 'admin' || user.perms.viewReports;
  return (
    <div className="app">
      <BackButtonHandler />
      <Routes>
        <Route path="/" element={<AttendancePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/students" element={<StudentsPage />} />
        <Route path="/student/:id" element={<StudentProfile />} />
        {canReports && <Route path="/reports" element={<ReportsPage />} />}
        <Route path="/more" element={<MorePage />} />
      </Routes>
      <nav className="bottomnav">
        <NavLink to="/" end>
          <IChecklist />
          التسجيل
        </NavLink>
        <NavLink to="/dashboard">
          <IChart />
          المتابعة
        </NavLink>
        <NavLink to="/students">
          <IUsers />
          الطلاب
        </NavLink>
        {canReports && (
          <NavLink to="/reports">
            <IReport />
            التقارير
          </NavLink>
        )}
        <NavLink to="/more">
          <IMore />
          المزيد
        </NavLink>
      </nav>
    </div>
  );
}

export default function App() {
  const userCount = useLiveQuery(() => db.users.count(), []);
  const [uid, setUid] = useState<string | null>(getSessionUserId());
  const login = useCallback((id: string) => {
    setSessionUserId(id);
    setUid(id);
  }, []);
  const logout = useCallback(() => {
    setSessionUserId(null);
    setUid(null);
    location.hash = '#/';
  }, []);

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
  }, []);

  if (userCount === undefined) return null;
  return (
    <UIProvider>
      {userCount === 0 ? (
        <Setup onDone={login} />
      ) : !uid ? (
        <Login onLogin={login} />
      ) : (
        <AuthProvider userId={uid} onLogout={logout}>
          <SelProvider>
            <HashRouter>
              <Shell />
            </HashRouter>
          </SelProvider>
        </AuthProvider>
      )}
    </UIProvider>
  );
}
