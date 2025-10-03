import React, { createContext, useContext, useEffect, useState } from 'react';

type User = { id: number; email: string; role: 'admin' | 'viewer' } | null;

type AuthShape = {
  user: User;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthCtx = createContext<AuthShape>({
  user: null,
  refresh: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);

  const refresh = async () => {
    const res = await fetch('/auth/me', { credentials: 'include' });
    setUser(res.ok ? await res.json() : null);
  };

  const logout = async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
  };

  useEffect(() => { refresh(); }, []);

  return (
    <AuthCtx.Provider value={{ user, refresh, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
