# 12 — Student registration (new feature)

**Model chosen by the product owner:** match against an official register; no-match is not auto-approved.

## Flow
1. A Campus Admin (own campus) or Super Admin imports the **Student register** at `/roster` (CSV: `regNo,fullName,dateOfBirth,programCode,semester,batchYear`, all-or-nothing; line-level errors shown before anything is sent; dates of birth are never shown back).
2. The student opens **Create your account** on the sign-in page → `/register`: registration number, date of birth, email, password (policy P-03, inline errors, required markers, no layout shift on blur).
3. If the details match an **unclaimed** entry and the email is free, a 6-digit code is emailed (15 min, 5 wrong tries, then the pending registration is destroyed). **The response is identical for every outcome** (match, wrong date of birth, unknown number, already claimed, email in use), so the endpoint cannot be used to discover who is on the register.
4. Entering the code creates the `STUDENT` account (name, institution, programme, semester, batch from the register; DOB from the register) and claims the entry exactly once inside a transaction. Two simultaneous claims: one succeeds, one is refused.
5. Registering grants **no** enrolment, eligibility or exam access; existing rules are unchanged.

## Backend (additive)
New table `roster_entries` (migration `*_student_roster`, no changes to existing tables). New routes: `POST /auth/register`, `POST /auth/register/verify` (public, rate limited per IP and per registration number, audited), `POST /roster/import`, `GET /roster` (`student.manage`, campus-scoped). Route manifest regenerated; the reviewed public-route list now includes the two new routes.

## Tests
`apps/api/test/registration.test.ts` (9): import authorization/scope/validation, claim, identical answers, attempt limit, single-claim race, password policy, rate limit. `tests/e2e/student-registration.spec.ts` (7): admin import in the browser, inline validation, full code flow, sign-in, no-exam access, indistinguishable outcomes, phone layout, forbidden for lecturers, UI-039 overflow.

## Not built / limits
- **No request-and-approve queue** for students who are not on the register (they are told to contact the examination office). Needs a decision (P-31).
- Email is **not restricted to an institutional domain**; the code proves control of the address only.
- Mail delivery uses the existing queue; end-to-end delivery to a real mailbox was not tested here (development shows the code on screen only when `DEV_EXPOSE_CODES=true`).
- No CAPTCHA; protection is rate limiting + identical responses.
- Register rows are never deleted by the application (retention is undecided, P-18/P-31).
