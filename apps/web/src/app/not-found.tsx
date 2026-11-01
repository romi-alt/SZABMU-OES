import Link from 'next/link';
import { AuthFrame, AuthHeading, Icon } from './AuthFrame';
import { PublicPage } from '../session';

export default function NotFound() {
  return (
    <AuthFrame>
      <AuthHeading icon="fileX" title="Page not found" lead="The page you asked for does not exist in the Examination Portal." />
      <Link className="auth-btn" href="/dashboard" style={{ textDecoration: 'none' }}>Go to dashboard<Icon name="arrow" size={18} /></Link>
      <Link className="auth-btn auth-btn-ghost" href="/login" style={{ textDecoration: 'none' }}>Sign in</Link>
      <p className="small faint" style={{ margin: 0, textAlign: 'center' }}>If you followed a link inside the portal and ended up here, please tell the examination office which one.</p>
      <PublicPage />
    </AuthFrame>
  );
}
