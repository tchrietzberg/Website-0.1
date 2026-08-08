# DECISIONS.md — assumptions, tradeoffs, deferred items

Filled-in profile for the master build brief (Section 2):
- **Firm:** small contingency securities-litigation practice; lodestar fee-petition reporting is primary
- **Billing models (v1):** hourly/lodestar time billing + invoicing; contingency context only (no trust retainers)
- **Roles:** admin, attorney, paralegal, billing_clerk (no client portal)
- **Stack:** Node ≥22.13 built-ins only (`node:sqlite`, `node:http`, `node:test`); zero npm deps
- **Deploy:** local prototype / Docker; not production
- **Integrations deferred:** QuickBooks API, LEDES 1998B, LawPay/Stripe
- **Trust/IOLTA:** explicitly out of scope for v1 (see D2) — VERIFY WITH BAR RULES before any production use if trust funds are ever held

| # | Decision | Rationale / Notes |
|---|----------|-------------------|
| D1 | Lodestar-first design; full invoice lifecycle also built | Firm docs emphasize lodestar summary/detail for fee petitions; user confirmed invoicing in scope (2026-08-08). |
| D2 | **Trust/IOLTA out of scope** | Never appears in firm requirements; contingency securities practice. Schema keeps money in one clearly-typed place so a separate constraint-enforced trust ledger can be added without redesign. VERIFY WITH BAR RULES before any production use if trust funds are ever held. |
| D3 | Node 22 built-ins only (node:sqlite, node:http, node:test); zero npm dependencies | npm registry unavailable in build sandbox; also removes supply-chain surface. node:sqlite is marked experimental by Node but wraps stable SQLite 3.51; acceptable for a prototype. |
| D4 | SQLite, not PostgreSQL | Docker unavailable in build sandbox (available on user's machine — compose file ships with a volume-backed SQLite instead of a Postgres service to keep one tested code path). Schema uses portable SQL; production migration path is Postgres. |
| D5 | Money = integer cents; time = integer minutes; division rounds half-up on the residual; all in `src/money.js` | Project rule: no floats, centralized rounding. |
| D6 | Time & Billing settings: duration format (`hh:mm:ss` / `hh:mm` / Hour Decimal) + rounding mode (up / nearest / down / none) + interval 6/10/12/15/30 min | Firm-wide via Settings (admin/billing_clerk). Nearest uses half-up at midpoint. Nearest/down may bill 0.0 hr (e.g. 14 min @ 30). Do Not Round bills raw time (14 min → 0.23 hr). Default: decimal display, 15-min round up. |
| D7 | Rate precedence matter → client → timekeeper, effective-dated; latest effective_date ≤ service_date wins; same-date tie → most recently entered | Tie-break assumption — confirm with billing admin. |
| D8 | Invoice lines snapshot the resolved rate at pre-bill generation | Guarantees historical invoices never change when rates do (tested). |
| D9 | Sent invoices immutable at DB level (triggers), corrections via credit notes; void allowed only pre-send and releases entries back to WIP | Project rule §3.4/§7. |
| D10 | Payment application default oldest-first; user-directed supported; overpayment stays unapplied rather than auto-credited | Unapplied cash is visible in its own report; applying it is a human decision. |
| D11 | Matter numbering YYYY-NNNN; invoice numbering INV-YYYY-NNNN; per-year gap-free counters allocated in-transaction | Format confirmed by user 2026-08-08. |
| D12 | N.D. Cal category/subcategory rule implemented as data-driven `billing_rules` row, not hard-code | Any court/jurisdiction condition can be added without code changes. |
| D13 | Approval permissions: billing_clerk/admin approve anything; attorneys approve entries on matters they lead; paralegals cannot approve. Attorney self-approval on own matters allowed | Assumption — flag for firm policy review. |
| D14 | Duplicate detection = same timekeeper+matter+date+duration, surfaced as warning, never a block | Legitimate duplicates exist (e.g., two same-length calls). |
| D15 | Prototype auth: email-only login, in-memory sessions | Demo only. Documented in README security notes. |
| D16 | UTC storage; service_date (date of work) distinct from entered_at (timestamp of entry) | Project rule §4. Firm-local display assumed America/New_York. |
| D17 | Native .xlsx export written from scratch (`src/xlsx.js`: minimal ZIP + SpreadsheetML) | Keeps zero-dependency principle. Currency strings exported as numeric cells with currency format so Excel can sum them. Added 2026-08-08. |

## Deferred

- QuickBooks two-way sync (CSV export ships now; API integration later).
- LEDES 1998B export (UTBMS task/activity code fields already captured per entry).
- Split billing across payers (allocation table can be added; irrelevant to lodestar practice).
- Timers in the UI (manual duration entry ships now).
- Matter-level visibility scoping (role-based route gating ships now).
- Scheduled report delivery (all reports have stable CSV URLs to automate against).
- Interest/late fees on AR.
