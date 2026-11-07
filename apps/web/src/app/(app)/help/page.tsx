'use client';
import Link from 'next/link';
import { Card, PageHead } from '@/ui';

/** UI-050: a short static help page. It gives no phone numbers or addresses of its own: contact details come from the person's campus examination office. */
export default function Help() {
  return (
    <>
      <PageHead title="Help" sub="Quick answers about signing in, examinations and who to ask." />
      <div className="stack-lg" data-testid="help-page">
        <Card title="Signing in">
          <div className="card-b stack">
            <p style={{ margin: 0 }}>Use the university email address and password for your account. Candidates and staff use different portals; if your details are rejected on one, check you are on the portal for your role.</p>
            <p style={{ margin: 0 }}>Staff accounts may also ask for a code from an authenticator app. If a temporary password was given to you, you will be asked to choose a new one first.</p>
          </div>
        </Card>
        <Card title="Forgot your password">
          <div className="card-b"><p style={{ margin: 0 }}>You can <Link href="/forgot">reset your password</Link> using your registered email address. If the email does not arrive, check your spam folder, then ask your campus administrator to confirm which address is on your account.</p></div>
        </Card>
        <Card title="Examinations">
          <div className="card-b stack">
            <p style={{ margin: 0 }}>An examination opens only for candidates who are eligible and on its roster, and only within its scheduled time. Candidates find theirs under <b>My Examinations</b>; staff find them under <b>Examinations</b> and <b>Live monitor</b>.</p>
            <p style={{ margin: 0 }}>If an examination you expect is missing, or says you are not eligible, ask your campus examination office to check your enrolment. Do not share your sign-in details with anyone.</p>
          </div>
        </Card>
        <Card title="Who to ask">
          <div className="card-b stack">
            <p style={{ margin: 0 }}>Your <b>campus examination office</b> handles accounts, enrolment and eligibility for your campus, and publishes how to reach it. Staff can also ask their campus administrator.</p>
            <p style={{ margin: 0 }}>If you followed a link inside the portal and ended up on a page that does not exist, tell the examination office which link it was.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
