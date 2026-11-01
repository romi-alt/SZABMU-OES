'use client';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMe } from '@/session';
import { NAV } from '@/nav';
import { get, post, fmtDT } from '@/api';
import { Loading } from '@/ui';
import { ROLE_LABEL, isSafeAppLink } from '@oes/shared';

function Bell() {
  const [open, setOpen] = useState(false); const [data, setData] = useState<{ unread: number; items: any[] } | null>(null);
  const load = () => get('/notifications').then(setData).catch(() => undefined);
  useEffect(() => { void load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-sm" aria-label={`Notifications, ${data?.unread ?? 0} unread`} aria-expanded={open} onClick={() => setOpen(!open)}>Notifications{data?.unread ? <span className="pill-count">{data.unread}</span> : null}</button>
      {open && (
        <div className="card bell-pop">
          <div className="card-h"><h3>Notifications</h3>{!!data?.unread && <button className="btn-link small" onClick={async () => { await post('/notifications/read-all'); await load(); }}>Mark all read</button>}</div>
          {!data?.items.length ? <div className="empty">No notifications.</div> : data.items.map((n) => (
            <div key={n.id} style={{ padding: '10px 16px', borderBottom: '1px solid #F0E7E3', background: n.readAt ? 'transparent' : '#FDF6F4' }} onClick={async () => { if (!n.readAt) { await post(`/notifications/${n.id}/read`); await load(); } }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{isSafeAppLink(n.link) ? <Link href={n.link} data-testid="notification-link" onClick={() => setOpen(false)}>{n.title}</Link> : n.title}</div><div className="small muted">{n.body}</div><div className="small faint">{fmtDT(n.createdAt)}</div>
            </div>))}
        </div>)}
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { me, loading, logout } = useMe(); const path = usePathname();
  const [navOpen, setNavOpen] = useState(false); const menuBtn = useRef<HTMLButtonElement>(null);
  // The navigation is a drawer below 1024 px: close it on navigation and on Escape, and keep the page behind it still.
  useEffect(() => { setNavOpen(false); }, [path]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setNavOpen(false); menuBtn.current?.focus(); } };
    document.addEventListener('keydown', onKey); document.body.classList.add('nav-locked');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('nav-locked'); };
  }, [navOpen]);
  if (loading || !me) return <div style={{ padding: 40 }}><Loading /></div>;
  const nav = NAV[me.role];
  const crumb = nav.items.find((i) => path.startsWith(i.href))?.label ?? '';
  return (
    <div className="shell">
      <aside className={`sidebar ${navOpen ? 'open' : ''}`} id="primary-nav" aria-label="Site navigation">
        <button className="btn btn-sm nav-close" onClick={() => { setNavOpen(false); menuBtn.current?.focus(); }} aria-label="Close menu">Close ✕</button>
        <div className="brand"><Image src="/logo.png" alt="Shaheed Zulfiqar Ali Bhutto Medical University, Islamabad" width={398} height={100} priority /></div>
        <div className="brand-sub">Examination Portal</div>
        <nav className="nav" aria-label="Primary"><div className="nav-label">{nav.label}</div>
          {nav.items.map((i) => <Link key={i.href} href={i.href} aria-current={path === i.href || (i.href !== '/dashboard' && path.startsWith(i.href)) ? 'page' : undefined}>{i.label}</Link>)}
        </nav>
        <div className="sidebar-foot">{me.institutions.map((i) => i.code).join(' · ') || 'University-wide'}</div>
      </aside>
      {navOpen && <div className="nav-scrim" data-testid="nav-scrim" onClick={() => setNavOpen(false)} aria-hidden />}
      <div className="main">
        <header className="topbar">
          <button ref={menuBtn} className="btn btn-sm menu-btn" data-testid="menu-button" aria-label="Menu" aria-controls="primary-nav" aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}>☰ Menu</button>
          <div className="crumbs">{ROLE_LABEL[me.role]} › <b>{crumb}</b></div>
          <div className="row"><Bell /><span className="small muted user-name" style={{ textAlign: 'right' }}><b style={{ color: 'var(--ink)' }}>{me.fullName}</b></span><button className="btn btn-sm" onClick={logout}>Sign out</button></div>
        </header>
        <main className="content" id="main">{me.mustChangePw && path !== '/profile' ? <ForceChange /> : children}</main>
      </div>
    </div>
  );
}

function ForceChange() {
  return <div className="notice warn"><b>Password change required.</b> Your account uses a temporary password. <Link href="/profile">Set a new password</Link> to continue.</div>;
}
