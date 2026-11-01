'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SESSION_EXPIRED_EVENT, get, post } from './api';
import type { Role } from '@oes/shared';

export interface Me { id: string; email: string; fullName: string; role: Role; permissions: string[]; mustChangePw: boolean; mfa?: { enabled: boolean; state: 'ok' | 'pending' | 'enroll'; required: boolean }; studentId: string | null; phone?: string; lastLoginAt?: string; institutions: { id: string; code: string; name: string }[]; student?: { id: string; regNo: string; semester: number; program: string; programName: string; institution: { id: string; name: string; code: string }; address?: string; dateOfBirth?: string; guardianPhone?: string } | null }
interface Ctx { me: Me | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void>; can: (p: string) => boolean }
const C = createContext<Ctx>({ me: null, loading: true, refresh: async () => undefined, logout: async () => undefined, can: () => false });
export const useMe = () => useContext(C);

/** Rendered by pages that must stay visible to signed-out visitors (e.g. the 404 page); the provider will not redirect from them. */
export function PublicPage() {
  useEffect(() => { document.documentElement.dataset.publicPage = '1'; return () => { delete document.documentElement.dataset.publicPage; }; }, []);
  return null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null); const [loading, setLoading] = useState(true);
  const router = useRouter(); const path = usePathname();
  const refresh = useCallback(async () => { try { setMe(await get<Me>('/auth/me')); } catch { setMe(null); } finally { setLoading(false); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  // The API said our session is no longer valid: forget the user, remember why, and let the redirect below return us to sign-in.
  useEffect(() => {
    const onExpired = () => { try { sessionStorage.setItem('oes:expired', '1'); } catch { /* storage unavailable */ } setMe(null); };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired); return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);
  const publicPath = path === '/login' || path === '/forgot' || path === '/register' || path === '/verify';
  useEffect(() => { if (!loading && !me && !publicPath && !document.documentElement.dataset.publicPage) router.replace('/login'); }, [loading, me, publicPath, router]);
  // A signed-in user whose second factor is outstanding can only be on /mfa (the API enforces this regardless).
  useEffect(() => { if (me && me.mfa && me.mfa.state !== 'ok' && path !== '/mfa') router.replace('/mfa'); }, [me, path, router]);
  const logout = useCallback(async () => { try { await post('/auth/logout'); } finally { setMe(null); router.replace('/login'); } }, [router]);
  const can = useCallback((p: string) => !!me?.permissions.includes(p), [me]);
  return <C.Provider value={{ me, loading, refresh, logout, can }}>{children}</C.Provider>;
}
