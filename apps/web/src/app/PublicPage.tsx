'use client';
import { useEffect } from 'react';
import { useMe } from '@/session';

/** Renders nothing; while mounted, an anonymous visitor on this page is NOT redirected to sign-in (used by the 404 page). */
export function PublicPage() {
  const { allowAnonymous } = useMe();
  useEffect(() => allowAnonymous(), [allowAnonymous]);   // child effects run before the provider's redirect effect; the cleanup releases it
  return null;
}
