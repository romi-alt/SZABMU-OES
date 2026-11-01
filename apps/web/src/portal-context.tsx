'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { Portal } from '@oes/shared';

/** Which portal served this request (resolved on the server from the host name; null on single-portal or development hosts). */
const C = createContext<Portal | null>(null);
export const PortalProvider = ({ portal, children }: { portal: Portal | null; children: ReactNode }) => <C.Provider value={portal}>{children}</C.Provider>;
export const usePortal = () => useContext(C);
