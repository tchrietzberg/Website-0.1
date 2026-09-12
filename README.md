# Chrono (Prototype)

Time capture with approval workflow, effective-dated rates, invoicing with write-downs and an
immutable post-send lifecycle, payments/AR, and lodestar reporting — built for a contingency
litigation practice. Zero runtime dependencies (Node built-ins only, including `node:sqlite`).

## Requirements

Node.js ≥ 22.13 (for built-in SQLite), or Docker.

## Quick start (local)

```bash
npm run seed     # creates data/billing.db with realistic demo data
npm start        # serves http://localhost:3000
npm test         # runs the money-path test suite (32 tests)
```

## Quick start (Docker)

```bash
docker compose up --build
# seed the containerized DB once:
docker compose exec billing node seed/seed.js
```

Then open http://localhost:3000.

## Demo logins

Password for all seeded users (override with `DEMO_PASSWORD` when seeding): **`demo-change-me`**

| Email | Role |
|---|---|
| avery@firm.example | admin |
| jordan@firm.example | attorney |
| riley@firm.example | attorney |
| sam@firm.example | paralegal |
| billie@firm.example | billing clerk |

## Demo flow (Definition of Done walkthrough)

1. Sign in as **avery** / `demo-change-me` → **Places** → check in at Ferry Building → chat with colleagues who were there.
2. Sign in as **avery** / `demo-change-me` → **Matters** → create a matter → Matter Search → open record → add fields.
3. Sign in as **sam** → Time Entry → log time (watch rounding from Settings; try 0 minutes → blocked).
4. Reports → **Matters** (list/export) or Lodestar Summary/Detail → CSV/Excel.
5. Admin: Navigate → Add a user to invite people. Settings → Time & Billing and Default fields (billing clerks manage rates in Settings).

WIP / pre-bill / invoice approval UI is paused for now (APIs remain for later).

## Environment variables

See `.env.example` for a full public-deploy checklist. Important:

| Var | Default | Purpose |
|---|---|---|
| `DB_FILE` | `data/billing.db` | SQLite database path |
| `PORT` | `3000` | HTTP port |
| `SESSION_SECRET` | (dev auto) | **Required in production** — signs/derives session crypto material |
| `NODE_ENV` | — | Set `production` for Secure cookies / stricter checks |
| `ALLOWED_ORIGINS` | — | Comma-separated origins for CSRF/OAuth host checks |
| `PUBLIC_ORIGIN` | — | Canonical https origin; enables live-domain hardening when `https://` |
| `COOKIE_ONLY_AUTH` | auto | `1`/`0`; default on in production or with https `PUBLIC_ORIGIN` |
| `TRUST_PROXY` | — | `1` when behind TLS-terminating proxy |
| `MS_CLIENT_ID` | — | Azure app id for OneDrive (server-owned) |

On a live domain, set `NODE_ENV=production`, `SESSION_SECRET`, `PUBLIC_ORIGIN`, `ALLOWED_ORIGINS`, `TRUST_PROXY=1`, `FORCE_SECURE_COOKIES=1`, and `FORCE_HSTS=1`. Users can enroll authenticator MFA under **Settings → Sign-in security**.

## Architecture

- `db/schema.sql` — full schema: FK + CHECK constraints, append-only triggers on the audit log,
  immutability triggers on sent invoices, no-delete triggers on payments/invoices.
- `src/money.js` — ALL currency/rounding math (integer cents, integer minutes; no floats anywhere).
- `src/rates.js` — effective-dated rate resolution: matter → client → timekeeper default.
- `src/services/` — time (rules engine + approvals), matters (field history, custom fields),
  invoices / payments (APIs; WIP–pre-bill UI paused), reports (Matters + lodestar).
- `src/web/` — dependency-free HTTP server + single-page UI.
- `src/services/places.js` — location pins (integer microdegrees) + 100m same-place chat rooms.
- `test/` — 32 tests covering rounding edges, rate precedence and effective dating, billing rules,
  approval gates, invoice immutability, payment application, and report totals.

## Firm-specific rules implemented

- Time & Billing settings: duration format (hh:mm:ss, hh:mm, Hour Decimal) and rounding (up / nearest / down / none) with intervals 6 / 10 / 12 / 15 / 30 min — configure under Settings.
- Zero-duration entries blocked (service layer **and** DB CHECK constraint).
- Category/subcategory required for N.D. Cal matters (data-driven rule in `billing_rules`).
- Default billable status for new time entries is billable (override per entry).
- Matter field history: every matter-level change logged with user and timestamp.
- Matter-level OneDrive: link a folder, browse files in-app, embed the live library, and **Sign in with Microsoft** in Settings (browser OAuth or device code — no Graph Explorer tokens).
  Microsoft always requires an Application (client) ID at the protocol level; put it on the **server once** as `MS_CLIENT_ID` (see `.env.example`) so end users never type it. Optional: `MS_TENANT_ID`, `MS_CLIENT_SECRET`.
- Lodestar summary and detail reports; all reports export to native Excel (.xlsx) and CSV.
  Dollar amounts export as real numbers with currency formatting, so Excel formulas work on them.
- **Places:** pin where you were (GPS, map click, or landmark check-in). Pins within ~100 meters share a chat room. Other users never receive your exact coordinates; audit logs store place ids only.

## Security (before going public)

Built-in controls (zero npm deps):

- **Password auth** (scrypt) — email-only login removed
- **Persistent DB sessions** with sliding expiry, HttpOnly cookies (Secure in production)
- **CSRF** (`X-CSRF-Token`) + same-origin checks on mutating API calls
- **Login / auth-email rate limiting**, request body size limits
- **Security headers**: CSP, nosniff, frame deny, Referrer-Policy, Permissions-Policy, HSTS (prod/proxy)
- **Static path hardening**, OAuth redirect host allowlist (`ALLOWED_ORIGINS` / `PUBLIC_ORIGIN`)
- **Invite / password reset / magic-link login** via one-time hashed tokens + SMTP (or local mail log in dev)
- Timekeepers can only create/submit **their own** time entries (admins/clerks may proxy)

Public deploy checklist:

1. Put TLS in front (Caddy/nginx/Cloudflare) and set `TRUST_PROXY=1`, `FORCE_SECURE_COOKIES=1`, `FORCE_HSTS=1`
2. Set a long random `SESSION_SECRET` and `NODE_ENV=production`
3. Set `ALLOWED_ORIGINS` / `PUBLIC_ORIGIN` to your https origin
4. Re-seed or reset demo passwords — never ship `demo-change-me`
5. Configure SMTP (`SMTP_HOST`, `SMTP_FROM`, …) for invite / reset / magic-link email
6. Set `MS_CLIENT_ID` for OneDrive; prefer env secrets over DB storage
7. Bind to localhost behind the proxy (`BIND_HOST=127.0.0.1`) when possible

Still deferred / not full firm compliance:

- Matter-level visibility scoping (any signed-in firm user can list firm matters)
- SSO/OIDC, DB encryption at rest, Postgres multi-writer HA
- Independent pen-test / bar-counsel review

Not legal or bar-compliance advice — have billing counsel review rules before production use.
