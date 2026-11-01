'use client';
import Link from 'next/link';
import { BrandLogo } from '@/brand';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMe } from '@/session';
import { NAV, ruleFor } from '@/nav';
import { get, post, fmtDT } from '@/api';
import { Loading } from '@/ui';
import { PERMISSIONS, ROLE_LABEL, isSafeAppLink, type Permission, type Role } from '@oes/shared';

function Bell() {
  const [open, setOpen] = useState(false); const [unreadOnly, setUnreadOnly] = useState(false); const [data, setData] = useState<{ unread: number; items: any[] } | null>(null);
  const load = () => get('/notifications').then(setData).catch(() => undefined);
  useEffect(() => { void load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-sm" aria-label={`Notifications, ${data?.unread ?? 0} unread`} aria-expanded={open} onClick={() => setOpen(!open)}>Notifications{data?.unread ? <span className="pill-count">{data.unread}</span> : null}</button>
      {open && (
        <div className="card bell-pop">
          <div className="card-h"><h3>Notifications</h3>{!!data?.unread && <button className="btn-link small" onClick={async () => { await post('/notifications/read-all'); await load(); }}>Mark all read</button>}</div>
          {!!data?.items.length && (
            <div className="row between small muted" style={{ padding: '8px 16px', borderBottom: '1px solid #F0E7E3' }}>
              <span data-testid="bell-summary">{data.unread > data.items.length ? `Showing the latest ${data.items.length} of ${data.unread} unread` : `${data.unread} unread of ${data.items.length}`}</span>
              <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only</label>
            </div>)}
          {!data?.items.length ? <div className="empty">No notifications.</div> : data.items.filter((n) => !unreadOnly || !n.readAt).map((n) => (
            <div key={n.id} style={{ padding: '10px 16px', borderBottom: '1px solid #F0E7E3', background: n.readAt ? 'transparent' : '#FDF6F4' }} onClick={async () => { if (!n.readAt) { await post(`/notifications/${n.id}/read`); await load(); } }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{isSafeAppLink(n.link) ? <Link href={n.link} data-testid="notification-link" onClick={() => setOpen(false)}>{n.title}</Link> : n.title}</div><div className="small muted">{n.body}</div><div className="small faint">{fmtDT(n.createdAt)}</div>
            </div>))}
        </div>)}
    </div>
  );
}

/** One consistent answer for a page the signed-in role may not use (UI-018). */
function NoAccess({ name, perm }: { name: string; perm: string }) {
  useEffect(() => { document.title = `No access · SZABMU OES`; }, []);
  const roles = (PERMISSIONS[perm as Permission] as readonly Role[] | undefined)?.map((r) => ROLE_LABEL[r]) ?? [];
  return (
    <div className="card" data-testid="error-forbidden"><div className="card-b stack">
      <h1 style={{ fontSize: 20, margin: 0 }}>You do not have access to {name}</h1>
      <p className="muted" style={{ margin: 0 }}>{roles.length ? <>This page is available to: {roles.join(', ')}.</> : 'Your role does not use this page.'} If you think you should have access, contact the examination office.</p>
      <div><Link className="btn btn-primary" href="/dashboard">Go to dashboard</Link></div>
    </div></div>
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
  const rule = ruleFor(path); const denied = !!rule && !me.permissions.includes(rule.perm);
  const crumb = nav.items.find((i) => path.startsWith(i.href))?.label ?? '';
  return (
    <div className="shell">
        <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); const m = document.getElementById('main'); m?.focus(); m?.scrollIntoView(); }}>Skip to main content</a>
      <aside className={`sidebar ${navOpen ? 'open' : ''}`} id="primary-nav" aria-label="Site navigation">
        <button className="btn btn-sm nav-close" onClick={() => { setNavOpen(false); menuBtn.current?.focus(); }} aria-label="Close menu">Close ✕</button>
        <BrandLogo plate priority className="brand" />
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
        <main className="content" id="main" tabIndex={-1}>{me.mustChangePw && path !== '/profile' ? <ForceChange /> : denied && rule ? <NoAccess name={rule.name} perm={rule.perm} /> : children}</main>
      </div>
    </div>
  );
}

function ForceChange() {
  return <div className="notice warn"><b>Password change required.</b> Your account uses a temporary password. <Link href="/profile">Set a new password</Link> to continue.</div>;
}
