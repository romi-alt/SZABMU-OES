import Link from 'next/link';
import { AuthFrame } from './AuthFrame';
import { PublicPage } from './PublicPage';

export default function NotFound() {
  return (
    <AuthFrame headline="We could not find that page." body="The address may be mistyped, or the page may have moved. Nothing has been changed.">
      <PublicPage />
      <div><h1>Page not found</h1><p className="muted" style={{ margin: '4px 0 0' }}>The page you asked for does not exist in the Examination Portal.</p></div>
      <div className="row"><Link className="btn btn-primary" href="/dashboard">Go to dashboard</Link><Link className="btn" href="/login">Sign in</Link></div>
      <div className="small faint">If you followed a link inside the portal and ended up here, please tell the examination office which one.</div>
    </AuthFrame>
  );
}
