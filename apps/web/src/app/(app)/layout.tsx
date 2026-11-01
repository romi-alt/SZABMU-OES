'use client';
import Link from 'next/link';
import { BrandLogo } from '@/brand';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useMe } from '@/session';
import { NAV, crumbFor, ruleFor } from '@/nav';
import { get, post, fmtDT } from '@/api';
import { Loading } from '@/ui';
import { Icon, iconForRoute } from '@/icons';
import { PERMISSIONS, ROLE_LABEL, isSafeAppLink, type Permission, type Role, type NotificationDto, type NotificationsDto } from '@oes/shared';

function Bell() {
  const [open, setOpen] = useState(false); const [unreadOnly, setUnreadOnly] = useState(false); const [data, setData] = useState<NotificationsDto | null>(null);
  const root = useRef<HTMLDivElement>(null); const btn = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const load = useCallback(() => get<NotificationsDto>('/notifications').then(setData).catch(() => undefined), []);
  useEffect(() => { void load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  // Disclosure-menu behaviour: Escape closes and returns focus to the button; a click or focus outside closes without stealing focus.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const away = (e: Event) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', key); document.addEventListener('mousedown', away); document.addEventListener('focusin', away);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', away); document.removeEventListener('focusin', away); };
  }, [open]);
  const markRead = async (n: NotificationDto) => { if (!n.readAt) { await post(`/notifications/${n.id}/read`); await load(); } };
  return (
    <div className="bell" ref={root} style={{ position: 'relative' }}>
      <button ref={btn} className="btn btn-sm icon-btn bell-btn" aria-label={`Notifications, ${data?.unread ?? 0} unread`} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        <Icon name="bell" size={18} />{data?.unread ? <span className="pill-count" aria-hidden>{data.unread}</span> : null}
      </button>
      {open && (
        <section id={panelId} className="card bell-pop" aria-label="Notifications">
          <div className="card-h"><h3>Notifications</h3>{!!data?.unread && <button className="btn-link small" onClick={async () => { await post('/notifications/read-all'); await load(); }}>Mark all read</button>}</div>
          {!!data?.items.length && (
            <div className="row between small muted" style={{ padding: '8px 16px', borderBottom: '1px solid #F0E7E3' }}>
              <span data-testid="bell-summary">{data.unread > data.items.length ? `Showing the latest ${data.items.length} of ${data.unread} unread` : `${data.unread} unread of ${data.items.length}`}</span>
              <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only</label>
            </div>)}
          {!data?.items.length ? <div className="empty">No notifications.</div> : (
            <ul className="bell-list">{data.items.filter((n) => !unreadOnly || !n.readAt).map((n) => (
              <li key={n.id} className={n.readAt ? '' : 'unread'}>
                <div className="bell-title">{!n.readAt && <span className="sr-only">Unread: </span>}{isSafeAppLink(n.link) ? <Link href={n.link} data-testid="notification-link" onClick={() => { setOpen(false); void markRead(n); }}>{n.title}</Link> : n.title}</div>
                <div className="small muted">{n.body}</div>
                <div className="row small faint"><span>{fmtDT(n.createdAt)}</span>{!n.readAt && <button className="btn-link small" onClick={() => void markRead(n)}>Mark read</button>}</div>
              </li>))}
            </ul>)}
        </section>)}
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
  const crumb = nav.items.find((i) => path.startsWith(i.href))?.label ?? crumbFor(path);
  return (
    <div className="shell">
        <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); const m = document.getElementById('main'); m?.focus(); m?.scrollIntoView(); }}>Skip to main content</a>
      <aside className={`sidebar ${navOpen ? 'open' : ''}`} id="primary-nav" aria-label="Site navigation">
        <button className="btn btn-sm nav-close" onClick={() => { setNavOpen(false); menuBtn.current?.focus(); }} aria-label="Close menu">Close ✕</button>
        <BrandLogo white priority className="brand" />
        <div className="brand-name"><i className="auth-bar" aria-hidden />OES Portal</div>
        <nav className="nav" aria-label="Primary"><div className="nav-label">{nav.label}</div>
          {nav.items.map((i) => <Link key={i.href} href={i.href} aria-current={path === i.href || (i.href !== '/dashboard' && path.startsWith(i.href)) ? 'page' : undefined}><Icon name={iconForRoute(i.href)} size={18} /><span>{i.label}</span></Link>)}
        </nav>
        <div className="sidebar-foot">{me.institutions.map((i) => i.code).join(' · ') || 'University-wide'}</div>
      </aside>
      {navOpen && <div className="nav-scrim" data-testid="nav-scrim" onClick={() => setNavOpen(false)} aria-hidden />}
      <div className="main">
        <header className="topbar">
          <button ref={menuBtn} className="btn btn-sm menu-btn" data-testid="menu-button" aria-label="Menu" aria-controls="primary-nav" aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}><Icon name="menu" size={18} /> Menu</button>
          <div className="crumbs">{ROLE_LABEL[me.role]} › <b>{crumb}</b></div>
          <div className="row topbar-r"><Bell /><span className="user-chip" title={me.email}><span className="user-av" aria-hidden><Icon name="user" size={16} /></span><span className="user-name">{me.fullName}</span></span><button className="btn btn-sm icon-btn" onClick={logout} aria-label="Sign out" title="Sign out"><Icon name="logout" size={18} /></button></div>
        </header>
        <main className="content" id="main" tabIndex={-1}>{me.mustChangePw && path !== '/profile' ? <ForceChange /> : denied && rule ? <NoAccess name={rule.name} perm={rule.perm} /> : children}</main>
      </div>
    </div>
  );
}

function ForceChange() {
  return <div className="notice warn"><b>Password change required.</b> Your account uses a temporary password. <Link href="/profile">Set a new password</Link> to continue.</div>;
}
