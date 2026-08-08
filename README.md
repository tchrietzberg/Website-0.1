# Firm Billing System (Prototype)

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

## Demo logins (prototype auth: email only)

| Email | Role |
|---|---|
| avery@firm.example | admin |
| jordan@firm.example | attorney (responsible on both litigation matters) |
| riley@firm.example | attorney |
| sam@firm.example | paralegal |
| billie@firm.example | billing clerk |

## Demo flow (Definition of Done walkthrough)

1. Sign in as **avery** → **Matters** → create a matter (indexed automatically) → Matter Search → open record → add fields.
2. Sign in as **sam** → Time Entry → log time (watch rounding from Settings; try 0 minutes → blocked;
   try a N.D. Cal matter without category → blocked).
3. Submit the entry, sign in as **billie** → approve via API/queue (nav hidden) or continue billing.
4. Billing → Generate pre-bill → Write-down → To review → Approve → Send.
5. Record a payment (partial payments and oldest-first application supported; overpayment stays unapplied).
6. Reports → Lodestar Summary/Detail → Export CSV/Excel.
7. Settings → Time & Billing, Timekeepers & Rates; admin audit log.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `DB_FILE` | `data/billing.db` | SQLite database path |
| `PORT` | `3000` | HTTP port |

## Architecture

- `db/schema.sql` — full schema: FK + CHECK constraints, append-only triggers on the audit log,
  immutability triggers on sent invoices, no-delete triggers on payments/invoices.
- `src/money.js` — ALL currency/rounding math (integer cents, integer minutes; no floats anywhere).
- `src/rates.js` — effective-dated rate resolution: matter → client → timekeeper default.
- `src/services/` — time (rules engine + approvals), matters (field history, custom fields),
  invoices (pre-bill → review → approve → send; write-downs; credit notes), payments (oldest-first), reports.
- `src/web/` — dependency-free HTTP server + single-page UI.
- `test/` — 32 tests covering rounding edges, rate precedence and effective dating, billing rules,
  approval gates, invoice immutability, payment application, and report totals.

## Firm-specific rules implemented

- Time & Billing settings: duration format (hh:mm:ss, hh:mm, Hour Decimal) and rounding (up / nearest / down / none) with intervals 6 / 10 / 12 / 15 / 30 min — configure under Settings.
- Zero-duration entries blocked (service layer **and** DB CHECK constraint).
- Category/subcategory required for N.D. Cal matters (data-driven rule in `billing_rules`).
- Default billable status by matter type: litigation billable, SW Admin non-billable.
- Matter field history: every matter-level change logged with user and timestamp.
- Lodestar summary and detail reports; all reports export to native Excel (.xlsx) and CSV.
  Dollar amounts export as real numbers with currency formatting, so Excel formulas work on them.

## Security notes (prototype-grade — read before any real use)

- Auth is email-only with in-memory sessions: **demo only**. Real deployment needs credentials/SSO,
  TLS, CSRF protection, and persistent session management.
- Role-based access control is enforced on API routes; matter-level visibility scoping is not yet implemented.
- No client PII is written to logs; audit snapshots live only in the database.
- SQLite is appropriate for a single-office prototype; the schema is written to port to PostgreSQL
  for multi-user production use.
- Trust/IOLTA accounting is intentionally out of scope (see DECISIONS.md D2).

Not legal or bar-compliance advice — have billing counsel review rules before production use.
