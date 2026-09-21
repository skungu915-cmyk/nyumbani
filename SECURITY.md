# Security

This document lists the security-relevant design decisions in this codebase, organized around
the concrete vulnerabilities present in the original static mockup this project replaces.

## 1. The core flaw: contact data was never actually protected

**Before:** listings (`SEED_PROPS`) were a hardcoded JS array shipped in full to every browser,
`exactAddress`/`owner`/`phone` included. "Unlocking" a property (`markUnlocked`) just pushed the
property's ID into a `localStorage` array — a plain client-side flag with no correlation to any
payment. Opening DevTools and running
`localStorage.setItem('mh_unlocked', JSON.stringify(['1','2','3','4','5','6','7','8']))` unlocked
every listing on the platform for free. There was also no real M-Pesa API call — `doStk()` was a
`setTimeout` that unconditionally "succeeded" after 6.8 seconds and fabricated a fake M-Pesa
receipt code with `Math.random()`.

**Now:** `backend/src/services/property.service.js`'s `serializeProperty()` is the single place
that decides whether `exactAddress`/`ownerName`/`ownerPhone`/`geoLat`/`geoLng` are included in an
API response. It checks, server-side, whether the caller is the property's owner, an admin, or has
a real `Unlock` database row for that exact property — and an `Unlock` row is only ever created by
`payments.service.js`'s `handleStkCallback()`, which only runs from a genuine Safaricom Daraja
webhook. An unauthenticated or unpaid caller's API response has those fields explicitly `null` —
the data never reaches the browser in the first place, so there is nothing to "unlock" in
DevTools. This is asserted directly by `backend/test/redaction.test.js`.

## 2. Real M-Pesa integration, not a simulated timer

`backend/src/services/mpesa.service.js` performs actual Daraja OAuth + STK Push API calls.
`payments.service.js`:
- Creates a `Payment` row with Safaricom's real `CheckoutRequestID` before anything is granted.
- `POST /api/payments/mpesa/callback` is the only thing that can mark a payment `SUCCESS` and
  create the corresponding `Unlock` row. It's idempotent (replays/duplicate callbacks are
  no-ops), it verifies the callback's `CheckoutRequestID` matches a payment *we* initiated and
  that is still `PENDING` (an attacker can't forge a state change without already knowing a live,
  Safaricom-issued, unguessable `CheckoutRequestID`), and it optionally supports an IP allowlist
  for Safaricom's published callback source ranges (`MPESA_CALLBACK_IP_ALLOWLIST`).
- Consumer key/secret/passkey live only in server environment variables — never in the database,
  never serialized to any API response (`GET /api/admin/mpesa-status` returns booleans like
  `consumerKeyConfigured: true`, never the value itself), and never rendered into the frontend
  (contrast with the mockup's admin "M-Pesa Config" page, which had literal `<input>` fields for
  these secrets sitting in client-servable HTML).
- Admin has a narrow, fully-audited manual-override path (`POST /api/admin/transactions/:id/mark-paid`)
  for the rare case a callback never arrives, requiring a written reason and writing an `AuditLog`
  entry — it can only move an existing `PENDING` payment to `SUCCESS`, never fabricate one.

## 3. Authentication & session management

- Passwords hashed with bcrypt (cost 12, configurable). Minimum strength enforced
  (`isStrongPassword`: 10+ chars, 3+ character classes).
- Access tokens are short-lived JWTs (default 15 min) sent as `Authorization: Bearer` headers,
  kept only in an in-memory JS variable on the frontend (never `localStorage`) — an XSS bug can't
  read a persisted token out of storage.
- Refresh tokens are opaque random values, stored as a SHA-256 hash (never the raw token) in the
  `RefreshToken` table, set as an `httpOnly`, `Secure` (in prod), `SameSite=Strict` cookie scoped
  to `/api/auth`. Every refresh **rotates** the token; presenting an already-used/revoked token
  triggers reuse detection that revokes *every* session for that user (a signal of token theft).
- Login failures are rate-limited (`express-rate-limit`) **and** tracked per-account
  (`failedLoginAttempts`/`lockedUntil`), locking an account for `ACCOUNT_LOCK_MINUTES` after
  `MAX_FAILED_LOGIN_ATTEMPTS`. Verified live in this build (see below).
- Login/signup error messages are deliberately generic ("Invalid email/phone or password") and a
  non-existent account burns roughly the same time as a real bcrypt compare, to resist user
  enumeration and timing attacks.
- A password reset revokes all of the user's existing sessions.
- The mockup's `doLogin()`/`doSignUp()` did none of this — they were client-only functions that
  checked non-empty fields, showed a toast, and never created or checked any real account.

## 4. CSRF

Every authenticated API call other than `/api/auth/refresh` and `/api/auth/logout` uses a bearer
token in an `Authorization` header, which a cross-site request cannot attach — this is immune to
CSRF by construction, no token needed. The two cookie-authenticated endpoints are protected by
`requireSameOrigin` (`backend/src/middleware/csrf.js`): the refresh cookie is `SameSite=Strict`,
and the endpoint additionally requires a custom header (`x-livehere-csrf`) that only same-origin
JS could attach, plus an `Origin`/`Referer` allowlist check.

## 5. Authorization / IDOR

Every mutating endpoint checks resource ownership server-side, never trusting a client-supplied
ID to imply permission:
- `property.service.assertOwnerOrAdmin` — a landlord can only edit/delete/upload photos to their
  own properties.
- `landlord.routes.js` is entirely scoped to `req.user.id` — no `landlordId` is ever accepted from
  the client, so one landlord can never view or modify another's tenants/units/maintenance/notices.
- `payments.service.getPaymentStatus` only returns a payment to the user who made it (or an admin).
- Role-gating (`requireRole('ADMIN')`, `requireRole('LANDLORD', 'ADMIN')`) on every
  landlord/admin route, in addition to the frontend's portal-switch UI gating (which is a UX
  convenience only — the real enforcement is server-side).

## 6. Input validation & injection

- Every request body/query/params is validated with `zod` schemas (`validate` middleware) before
  it reaches any business logic — type coercion, length limits, enum/regex constraints.
- All database access goes through Prisma's query builder, which parameterizes every query —
  no raw SQL string concatenation anywhere in this codebase, so SQL injection isn't reachable
  through user input.
- `backend/src/utils/sanitize.js` strips control characters from free-text fields server-side as
  defense-in-depth; the primary XSS defense is output encoding (`escapeHtml`, see below).

## 7. XSS

- The frontend never uses `innerHTML` with unescaped user content. `frontend/js/utils.js`'s
  `escapeHtml()` is applied to every review, property description, user name, enquiry, etc.
  before it's templated into the DOM.
- The backend sends a strict Content-Security-Policy (`helmet`) with `script-src 'self'` and
  **no** `'unsafe-inline'` — this is only possible because the frontend was rewritten to use
  `addEventListener` with `data-action` attributes and event delegation instead of the mockup's
  ~80 inline `onclick="..."` handlers, which a strict CSP would otherwise block outright (and
  which are themselves a standing XSS-amplification risk).
- `frame-ancestors 'none'` blocks the app being iframed (clickjacking protection), notably
  relevant for the payment modal.

## 8. File uploads

`backend/src/services/upload.service.js`:
- Multer buffers uploads in memory (never writes a user-controlled filename to disk).
- Files are validated by **content** (`file-type`'s magic-byte sniffing), not by the
  client-supplied `Content-Type` or filename extension, which are trivially spoofable.
- Images are re-encoded through `sharp` (resized, re-compressed to JPEG) — this **strips EXIF/GPS
  metadata**, which is a real privacy leak the mockup didn't address: a phone photo's embedded
  GPS coordinates would otherwise reveal a property's exact location regardless of the paywall.
- Output files are written under server-generated random UUID-style filenames into a directory
  that isn't executable, served with `X-Content-Type-Options: nosniff`.
- Separate, size-appropriate multer limits for photos vs. video bound the worst-case memory
  footprint of concurrent uploads.
- Verified live: an uploaded JPEG round-trips through this pipeline and is served back with
  `Content-Type: image/jpeg` at a fresh randomized URL (see "What was actually tested" below).

## 9. Rate limiting & abuse prevention

Tiered `express-rate-limit` policies: tight limits on auth endpoints (credential stuffing),
payment initiation (STK-push spam — each call is a real Daraja API request and an unsolicited
prompt to a real phone number), and write endpoints (reviews/enquiries/notices spam). Backed by a
generous global API limiter as a backstop.

## 10. Referral integrity

**Before:** referral rewards were credited at signup time based on a client-typed code, with no
verification the referred account ever did anything — trivially farmable with disposable emails.

**Now:** `referrals.service.creditReferralIfEligible()` only runs from the M-Pesa callback
handler, after a referred user's **first successful, Safaricom-verified payment** — never at
signup. It's idempotent per referred user (a `Referral` row is unique on `referredUserId`), so a
second payment never double-pays a referrer, and self-referral is structurally impossible (a user
can't be their own `referredByUserId` through the normal signup flow).

## 11. Review integrity

**Before:** anonymous, unauthenticated, instantly-public reviews with only a non-empty-string
check — an open spam/defamation vector on a public page.

**Now:** reviews require authentication, are rate-limited, are capped at one per user per
property (DB-enforced unique constraint), and are created `PENDING` — only visible publicly once
an admin approves them via the moderation queue (`GET/PATCH /api/admin/reviews`).

## 12. Logging & error handling

- `backend/src/middleware/errorHandler.js` never leaks stack traces, internal error messages, or
  Prisma error details to the client in production — generic messages only, with the real error
  logged server-side.
- `backend/src/lib/logger.js` (pino) redacts `Authorization`/cookie headers and any
  password/token/secret-shaped fields from logs.

## 13. Secrets & configuration

- `backend/src/config/env.js` validates all required environment variables at startup with zod
  and **refuses to boot in production** if `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are missing,
  too short, identical to each other, or still contain an obvious placeholder marker
  (`changeme`, `replace-with`).
- `.env` is gitignored; `.env.example` documents every variable with no real secrets committed.
- `npm audit` is clean (0 vulnerabilities) as of this build — `multer` was bumped from the
  1.x line (which `npm install` itself warned carries known CVEs) to 2.x, and `nodemailer`,
  `sharp`, `file-type`, and `uuid` (ultimately removed as an unused dependency) were bumped past
  advisories `npm audit` flagged during setup.

## 14. Transport security

`helmet` sets HSTS (production only), `X-Content-Type-Options: nosniff`,
`X-Frame-Options`/`frame-ancestors 'none'`, and a `Referrer-Policy`. CORS is an explicit origin
allowlist (`FRONTEND_ORIGINS`) with credentials only permitted for those exact origins — not a
wildcard.

## What was actually tested (not just written)

This isn't just a design document — the following was exercised against a real PostgreSQL
database and a real Chromium browser during development, not just reasoned about:

- `npm test` — 17 unit tests covering the redaction logic (7 cases: anonymous, wrong-user,
  correct-unlock, unlock-for-a-different-property, owner, admin, other-landlord), password
  hashing/strength, and M-Pesa phone-number normalization. All passing.
- End-to-end via `curl` against a live server + Postgres: signup, property creation, admin
  approval, and a direct comparison of the same property's JSON as seen by its owner (full
  contact fields) vs. an anonymous caller (all four restricted fields `null`) — see the
  "anonymous caller" test's origin. Also verified: wrong-password login returns a generic 401,
  five failed logins lock the account, refresh without the CSRF header is rejected with 403,
  refresh with it succeeds, and malformed property-creation input is rejected with field-level
  validation errors.
- End-to-end via a scripted Chromium browser (Playwright) against the real frontend + backend:
  signup/login for tenant, landlord and admin roles; RBAC portal gating (a tenant cannot open the
  landlord or admin portal at all); the pay-gate correctly hides contact details before payment
  and the unlocked box correctly shows them after a verified `Unlock`; self-listing a property as
  a landlord; an admin approving a pending listing and seeing it go live; **a real JPEG uploaded
  through the browser, round-tripped through the multer → file-type → sharp pipeline, and served
  back** at a randomized `/media/properties/...` URL with the correct re-encoded content-type;
  submitting a review and an admin approving it into public visibility; and the STK-push flow
  failing gracefully (a clean error message, no crash, no stack trace) when M-Pesa credentials
  aren't configured, exactly as it should for anyone who clones this repo without Daraja
  sandbox credentials yet.
- This process caught and fixed two real bugs before they shipped: `/api/auth/logout` was
  rejected with 403 because the frontend wasn't sending the CSRF header that endpoint requires
  (fixed in `api.js`/`auth.js` — logout now actually revokes the server-side session instead of
  only clearing local state), and the admin listings view was silently filtering out
  `PENDING_REVIEW` listings by default, which would have made the moderation queue invisible
  (fixed in `property.service.listProperties`). A landlord's "My Units" view was also found to be
  querying the public endpoint with no owner filter (showing every landlord's properties instead
  of just their own) and was fixed to scope by `ownerId`.

## Known gaps / explicitly out of scope

Being transparent about what this build does *not* cover, so it isn't mistaken for exhaustive:

- No virus/malware scanning hook on uploaded files (recommended: ClamAV or a cloud provider's
  scanning API in front of the upload pipeline before serving files publicly in production).
- No 2FA/MFA (recommended for admin accounts especially, before a real production launch).
- No WAF/DDoS layer — expected to sit in front of this app (e.g. Cloudflare) in production.
- Email delivery falls back to server-side logging if `SMTP_*` isn't configured — fine for local
  dev, must be set for real email verification/password reset in production.
- The "Agent" portal/role present in the original mockup's markup (but unreachable through its
  own UI — see the design notes) was not carried over, to keep the role model to the three roles
  actually reachable in the mockup's top navigation (Tenant/Landlord/Admin).
- Rate limits and lockout windows are sensible defaults, not tuned against real production traffic
  — revisit `backend/src/middleware/rateLimit.js` and `MAX_FAILED_LOGIN_ATTEMPTS`/
  `ACCOUNT_LOCK_MINUTES` once you have real usage data.
