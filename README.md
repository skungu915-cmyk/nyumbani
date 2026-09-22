# LiveHere Homes

A property-rental marketplace for Kenya: browse verified listings for free, pay a one-off M-Pesa
fee to unlock a property's exact address and owner contact, list your own property as a landlord,
and manage everything from a landlord or admin dashboard.

This repository is a full-stack rebuild of an earlier static HTML/CSS/JS mockup. The mockup had
**no backend at all** — every listing's exact address and owner phone number shipped to every
browser regardless of payment status, "unlocking" a property was a client-side `localStorage` flag
anyone could flip in DevTools, and there was no real M-Pesa integration, authentication, or
input validation anywhere. This project keeps the mockup's visual design but replaces all of that
with a real Node.js/Express/PostgreSQL API that enforces every access-control and payment decision
server-side. See [`SECURITY.md`](./SECURITY.md) for a full list of what changed and why.

## Architecture

```
/backend    Node.js + Express + PostgreSQL (Prisma) REST API
/frontend   Static HTML/CSS + vanilla JS (ES modules), no build step
```

The frontend is a static site that talks to the backend purely over its REST API (`fetch`). It can
be hosted anywhere that serves static files (S3+CloudFront, Netlify, nginx, etc.) — it does not
need to run on the same server as the API, as long as CORS (`FRONTEND_ORIGINS`) is configured.

## Prerequisites

- Node.js 18.18+ (uses the built-in `fetch` and `node:test`)
- PostgreSQL 14+
- A Safaricom Daraja account (sandbox is free) for M-Pesa STK Push — https://developer.safaricom.co.ke

## Backend setup

```bash
cd backend
npm install
cp .env.example .env
# edit .env: set DATABASE_URL, JWT_ACCESS_SECRET / JWT_REFRESH_SECRET (generate with
# `openssl rand -base64 48`), MPESA_* credentials, FRONTEND_ORIGINS, etc.

npx prisma migrate dev --name init   # creates the schema in your database
node prisma/seed.js                  # creates the initial admin account + platform settings row
                                      # (prints a one-time admin password — save it)

npm run dev    # starts on http://localhost:4000 (or `npm start` for production)
npm test       # runs the unit test suite (node:test, no DB required)
```

### Try it with demo data (recommended the first time)

Re-run the seed with `SEED_DEMO_DATA=true` to also create a demo landlord, a demo tenant, and
three demo properties (two live, one `PENDING_REVIEW` so you can see the admin moderation queue in
action) — including a real photo for each, generated locally and pushed through the actual
upload/re-encode pipeline, so nothing depends on external image hosts. The demo tenant is also
given one already-paid `Unlock` (a fabricated Payment/Unlock row inserted directly by the seed
script — not reachable through any real code path) so you can see the "before payment" and "after
payment" contact views side by side without needing real M-Pesa sandbox credentials configured yet:

```bash
SEED_DEMO_DATA=true node prisma/seed.js
```

This prints three accounts you can log into once the frontend is running:

| Role | Email | Password |
|---|---|---|
| Admin | (from `SEED_ADMIN_EMAIL`, default `admin@example.com`) | printed by the seed script |
| Landlord | `demo.landlord@example.com` | `DemoPass123!` |
| Tenant | `demo.tenant@example.com` | `DemoPass123!` |

Log in as the tenant and open "Modern 2 Bedroom Apartment" to see the unlocked contact view
immediately; log in as the admin and open Listings to approve the pending "3 Bedroom Family Home".
Running the seed again is safe — it skips demo data it already created.

## Frontend setup

The frontend has no build step. For local development, serve it with any static file server:

```bash
cd frontend
python3 -m http.server 8080
# or: npx serve .
```

Then open `http://localhost:8080`. Edit `frontend/js/config.js` to point `API_BASE` at your
backend if it isn't on `http://localhost:4000` (see the comment in that file — this can't be
injected at runtime without a bundler, and is deliberately not done via an inline `<script>` tag
since the backend's Content-Security-Policy blocks inline scripts).

Make sure the backend's `FRONTEND_ORIGINS` env var includes whatever origin you're serving the
frontend from (`http://localhost:8080` by default in `.env.example`).

## Using the app

Three portals share one page, switched via the top bar:

- **Find a Home** (public) — search/browse listings, pay to unlock a property's contact details,
  self-list a property, leave reviews, refer friends.
- **Landlord** — requires a `LANDLORD` (or `ADMIN`) account. Manage your properties, tenants, rent
  records, maintenance requests and notices.
- **Admin** — requires an `ADMIN` account. Moderate listings and reviews, view transactions,
  manage users, adjust platform settings, and check M-Pesa configuration status.

Sign up as a **Tenant** or **Landlord** from the "Sign Up" button. There is no self-serve admin
signup by design — the first admin account comes from `prisma/seed.js`, and that admin can create
further staff accounts via `POST /api/admin/users`.

## M-Pesa (Daraja) setup

1. Register an app at https://developer.safaricom.co.ke and get sandbox Consumer Key/Secret.
2. Set `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE` (sandbox default:
   `174379`), `MPESA_PASSKEY` in `backend/.env`.
3. `MPESA_CALLBACK_URL` must be a **public HTTPS URL** Safaricom's servers can reach — `localhost`
   will not work. For local development, tunnel your backend with something like `ngrok http 4000`
   and set the callback URL to the tunnel's HTTPS URL + `/api/payments/mpesa/callback`.
4. Go live by switching `MPESA_ENV=production` and using production credentials/shortcode once
   Safaricom approves your Paybill/Till for production use.

The admin portal's "M-Pesa Status" page shows whether credentials are configured — it never reads
or displays the actual secret values, which live only in the server's environment.

## Netlify demo deployment

A live demo runs at **https://liveherehomes.netlify.app** (frontend + backend + database, all on
Netlify). This is an *optional* alternative to the primary Node/Express + PostgreSQL setup above —
useful for quickly showing the app running without provisioning your own server, at the cost of a
couple of features (see limitations below).

**How it's wired up** (see `netlify.toml`, `netlify/functions/api.js`,
`backend/src/routes/bootstrap.routes.js`):
- The existing Express app runs unchanged inside a single Netlify Function
  (`serverless-http`) — `/api/*`, `/media/*` and `/health` are redirected to it, and `frontend/` is
  published as the static site on the same origin, so there's no separate CORS setup to manage.
- The database is a plain external PostgreSQL instance, set as a normal `DATABASE_URL` env var —
  same as the primary deployment path. (Netlify's own "Netlify DB" auto-provisioning integration
  was tried first here and turned out to be deprecated — its extension page states new database
  creation is no longer available through it — so the live demo's database is instead a small
  Postgres instance on Railway, reachable from Netlify's function but not from whoever's deploying
  it, which is exactly why the next point exists.)
- Since this deployment's operator has no direct network path to that database, schema + demo data
  aren't applied with `prisma migrate deploy` — instead, a one-time, secret-protected route
  (`POST /api/_bootstrap/migrate`, guarded by a `BOOTSTRAP_SECRET` env var and only mounted when
  that var is set) reads `backend/prisma/migrations/20260921193359_init/migration.sql` and
  `backend/prisma/seed-demo.sql` and applies them statement-by-statement via Prisma from inside the
  running function, which — unlike its operator — does have a normal network path to the database.
  Call it once after the database exists and before using the app; it's idempotent (safe to call
  again) and the response reports how many statements succeeded/failed.

**Demo accounts** (same three roles as the local `SEED_DEMO_DATA=true` seed):

| Role | Email | Password |
|---|---|---|
| Admin | `admin@example.com` | `AdminDemo123!` |
| Landlord | `demo.landlord@example.com` | `DemoPass123!` |
| Tenant | `demo.tenant@example.com` | `DemoPass123!` |

**Known limitations of this deployment path only** (the primary Node/Express deployment above
doesn't have these):
- Serverless functions have an ephemeral filesystem, so uploaded property photos don't persist
  between invocations — listings without a photo already fall back to a placeholder image, so
  this doesn't break anything, it just means newly-uploaded photos won't stick around.
  M-Pesa STK Push still needs real Safaricom Daraja credentials set as env vars; without them,
  clicking "Pay & Unlock" fails with a clean error, same as any deployment that hasn't configured
  M-Pesa yet.
- If you fork/redeploy this to your own Netlify site, set the same env vars documented in
  `backend/.env.example` (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `NODE_ENV=production`,
  `COOKIE_SECURE=true`, `FRONTEND_ORIGINS`/`BACKEND_PUBLIC_URL` set to your site's URL,
  `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PHONE`/`SEED_ADMIN_PASSWORD`) via Site settings → Environment
  variables — `DATABASE_URL` is the one exception, handled automatically as described above.

## Deployment notes

- Set `NODE_ENV=production`, `COOKIE_SECURE=true`, and real (32+ byte) `JWT_*_SECRET` values —
  the app refuses to boot in production with placeholder secrets.
- Put the backend behind HTTPS (a reverse proxy like nginx/Caddy, or your platform's TLS
  termination) — cookies are set `Secure` in production and won't be sent over plain HTTP.
- `FRONTEND_ORIGINS` must be an exact match of your deployed frontend's origin(s) — CORS and the
  CSRF same-origin check both key off this list.
- Configure `SMTP_*` so email verification and password reset emails actually send (without it,
  the backend just logs the email content server-side, which is fine for local dev only).
- Run `npx prisma migrate deploy` (not `migrate dev`) in production/CI.
- Point `UPLOAD_DIR` at persistent storage, or swap `backend/src/services/upload.service.js` for
  an S3-compatible object store if running on ephemeral infrastructure (e.g. containers that don't
  persist disk between deploys).

## Project structure

```
backend/
  prisma/schema.prisma     Data model (see comments — the redaction rule lives in the service layer)
  prisma/seed.js           Creates the initial admin account + platform settings
  src/config/env.js        Startup env validation (fails fast on missing/weak secrets in prod)
  src/middleware/          auth (JWT), RBAC, rate limiting, CSRF, validation, error handling
  src/services/            business logic — property redaction, M-Pesa, uploads, auth, etc.
  src/routes/               HTTP layer — thin, delegates to services
  test/                    node:test unit tests for the security-critical pure functions
frontend/
  index.html               all three portals + modals, no inline scripts/handlers (CSP-clean)
  css/styles.css            visual design, carried over from the original mockup
  js/                       ES modules — api client, auth, properties, payments, admin, landlord…
```
