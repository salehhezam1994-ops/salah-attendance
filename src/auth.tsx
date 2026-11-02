import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ClassRoom, type User } from './db/schema';

interface Auth {
  user: User;
  isAdmin: boolean;
  logout: () => void;
  canClass: (classId: string) => boolean;
  allowedClasses: (classes: ClassRoom[]) => ClassRoom[];
}
const AuthCtx = createContext<Auth>(null as never);
export const useAuth = () => useContext(AuthCtx);

const KEY = 'salah.session';
export function getSessionUserId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function setSessionUserId(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ userId, onLogout, children }: { userId: string; onLogout: () => void; children: ReactNode }) {
  const user = useLiveQuery(() => db.users.get(userId), [userId]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (user !== undefined) setReady(true);
  }, [user]);
  useEffect(() => {
    if (ready && (!user || !user.active)) onLogout();
  }, [ready, user, onLogout]);
  if (!user) return null;
  const isAdmin = user.role === 'admin';
  const canClass = (id: string) => isAdmin || user.perms.allClasses || user.perms.classIds.includes(id);
  const value: Auth = {
    user,
    isAdmin,
    logout: onLogout,
    canClass,
    allowedClasses: (cs) => cs.filter((c) => canClass(c.id)),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
