'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { get, post } from './api';
import type { Role } from '@oes/shared';

export interface Me { id: string; email: string; fullName: string; role: Role; permissions: string[]; mustChangePw: boolean; studentId: string | null; phone?: string; lastLoginAt?: string; institutions: { id: string; code: string; name: string }[]; student?: { id: string; regNo: string; semester: number; program: string; programName: string; institution: { id: string; name: string; code: string }; address?: string; dateOfBirth?: string; guardianPhone?: string } | null }
interface Ctx { me: Me | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void>; can: (p: string) => boolean }
const C = createContext<Ctx>({ me: null, loading: true, refresh: async () => undefined, logout: async () => undefined, can: () => false });
export const useMe = () => useContext(C);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null); const [loading, setLoading] = useState(true);
  const router = useRouter(); const path = usePathname();
  const refresh = useCallback(async () => { try { setMe(await get<Me>('/auth/me')); } catch { setMe(null); } finally { setLoading(false); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const publicPath = path === '/login' || path === '/forgot' || path === '/verify';
  useEffect(() => { if (!loading && !me && !publicPath) router.replace('/login'); }, [loading, me, publicPath, router]);
  const logout = useCallback(async () => { try { await post('/auth/logout'); } finally { setMe(null); router.replace('/login'); } }, [router]);
  const can = useCallback((p: string) => !!me?.permissions.includes(p), [me]);
  return <C.Provider value={{ me, loading, refresh, logout, can }}>{children}</C.Provider>;
}
