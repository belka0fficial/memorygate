import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, clearKey, getStoredKey, storeKey, UnauthorizedError } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');

  const verify = useCallback(async () => {
    if (!getStoredKey()) {
      setAuthed(false);
      setChecking(false);
      return false;
    }
    try {
      await api.get('/auth/check');
      setAuthed(true);
      setChecking(false);
      return true;
    } catch {
      clearKey();
      setAuthed(false);
      setChecking(false);
      return false;
    }
  }, []);

  useEffect(() => {
    verify();
  }, [verify]);

  useEffect(() => {
    const onUnauthorized = () => setAuthed(false);
    window.addEventListener('memorygate:unauthorized', onUnauthorized);
    return () => window.removeEventListener('memorygate:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (key) => {
    setError('');
    storeKey(key);
    const ok = await verify();
    if (!ok) setError('Invalid key');
    return ok;
  }, [verify]);

  const logout = useCallback(() => {
    clearKey();
    setAuthed(false);
  }, []);

  return (
    <AuthContext.Provider value={{ authed, checking, error, login, logout, refreshAuth: verify }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { UnauthorizedError };
