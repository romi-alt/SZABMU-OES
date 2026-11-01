# 05 — Content-Security-Policy review

## Requirements found in the real application (SOURCE + TODAY)

| Need | Finding |
|---|---|
| Scripts | Next.js framework/page bundles only; no third-party scripts, no `<script>` tags authored in the app, no `dangerouslySetInnerHTML` |
| Styles | one global stylesheet; **63 inline `style={{…}}` attributes** (progress bars, palette cells, layout) |
| Images | `next/image` for the logo (`/_next/image?url=…logo.png`, same origin); `data:`/`blob:` allowed for generated images |
| Fonts | system font stack only (`Inter, "Segoe UI", system-ui…`), none downloaded |
| API | same-origin `/api/*` (Next rewrite); the browser never contacts the API host directly |
| SSE | none today; a future same-origin stream is covered by `connect-src 'self'` |
| Object storage media | none today (no uploads); the policy has a validated hook (`CSP_MEDIA_ORIGIN`) |
| Charts | none are third-party; they are CSS/inline-style |
| Dev | React needs `eval` for debugging; HMR uses a websocket |

## Policy (production)

```
default-src 'self'; script-src 'self' 'nonce-<per request>' 'strict-dynamic';
style-src 'self' 'nonce-<per request>'; style-src-attr 'unsafe-inline';
img-src 'self' data: blob: [CSP_MEDIA_ORIGIN]; media-src 'self' [CSP_MEDIA_ORIGIN]; font-src 'self';
connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
[; upgrade-insecure-requests  — only when CSP_UPGRADE_INSECURE=true]
```

Built per request in `apps/web/src/proxy.ts` from `apps/web/src/csp.ts` (Next 16 `proxy`, the documented nonce mechanism). The root layout calls `await connection()` so every page renders per request, which is what lets Next attach the nonce to its own scripts. The matcher excludes `/api`, `/_next/static`, `/_next/image`, `favicon.ico`, `icon.png`, `logo.png` and prefetches. Also added: `Strict-Transport-Security: max-age=31536000` on the web tier in production (the API already sent HSTS). Existing `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` kept.

## Intentionally relaxed directives (documented, not hidden)

| Directive | Why | Risk accepted |
|---|---|---|
| `style-src-attr 'unsafe-inline'` | inline `style="…"` attributes cannot carry a nonce; the UI has 63 of them | attribute styles cannot execute script; they permit UI redressing/CSS-based exfiltration only if an attacker could already inject markup, which the script policy and React escaping prevent. Removing it means moving those styles to classes (tracked in `07`). |
| Development only: `script-src 'unsafe-eval'`, `style-src 'unsafe-inline'`, `connect-src ws://localhost:*` | React debugging and HMR | never emitted when `NODE_ENV` is not `development`; asserted by `csp.spec.ts` against the production build |
| `upgrade-insecure-requests` omitted by default | on a plain-http localhost run it would upgrade same-origin sub-requests to https and break the app | set `CSP_UPGRADE_INSECURE=true` behind TLS |

Not used: `script-src 'unsafe-inline' 'unsafe-eval'` as a blanket workaround. No wildcard sources (asserted).

## Verification (TODAY)

- Header present on real responses: `/login`, `/dashboard` (authenticated), `/no-such-page` (404); absent on `/api/health` (the API has its own helmet policy). Nonce differs between two requests and appears as `nonce="…"` on the real script tags.
- **No violation** across the flows listed in `04`, including the exam player in both layouts and the MFA page. The detector (`securitypolicyviolation` + console) found real problems on the first run — 20 `script-src eval` reports — which led to the shared-package fix (`03`); after it, zero.
- Production build: all routes `ƒ` (dynamic), `Proxy (Middleware)` registered.

## Limits

Not tested in Firefox/Safari (Chromium only). No CSP violation reporting endpoint (`report-to`) yet. Third-party origins (analytics, CDN, object storage) are not in use; adding any requires a policy change reviewed with this document. The nonce policy relies on `strict-dynamic`, which very old browsers ignore (they fall back to `'self'` + nonce).

## Favicon

`/favicon.ico` and `/icon.png` served (200, `image/*`); no 404 on any page (asserted). Source: the seal region **cropped, pixels unchanged,** from the existing approved logo lockup (`apps/web/public/logo.png`, identical to `design/reference/IMG_0586.png`) onto white. **No new seal was drawn.** An official university-supplied favicon should replace it when available.
