# Indiantown Board

A standalone community board for **Indiantown, Florida (34956)**. Neighbors can post classifieds, add a company with contact information, share news, request topic chat rooms, and open a list of local resources.

This project is only the Indiantown board. It does not share code, data, branding, or accounts with any other product.

## What is here

- **Board** — Craigslist-style listings: for sale, wanted, jobs, housing, services, community
- **Directory** — add a local company (name, owner, phone, email, address, optional website)
- **News** — short town notes anyone can post
- **Help** — Police, fire, library, Village Council, utilities, schools, clinic, and other local contacts
- **About town** — a short Indiantown primer
- English / Spanish toggle
- Search across listings, businesses, news, chat rooms, and help contacts
- Contact details stay hidden until someone taps **Show contact**
- **Chat rooms** by topic. Anyone can request a room; it stays closed until an admin approves it. Admins can hide messages and close rooms.

## Security

Posts require a same-origin CSRF token, a local-post confirmation, and a honeypot check. The server also applies security headers, limits body size, and rate-limits posting. List cards do not include phone or email.

Official Village business still lives at [indiantownfl.gov](https://www.indiantownfl.gov/). This board is independent of Village government.

## Requirements

Node.js 22.13 or newer (uses built-in `node:sqlite`). No npm runtime dependencies.

## Open the site

```bash
npm start
```

Then open **http://localhost:3000** in a browser. That is the direct address for this board. It is not deployed to a public domain yet.

## Commands

```bash
npm start          # http://localhost:3000 — seeds on first run
npm run seed       # load sample Indiantown listings if the database is empty
npm test
```

The header and footer use the official Village of Indiantown seal.

Data is stored in `data/indiantown.db`. Sample businesses and listings are fictional. Civic resource links are public Village and county pages.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_FILE` | `data/indiantown.db` | SQLite file |
| `RATE_LIMIT_MAX` | `8` | Posts allowed per client in 10 minutes |
| `ADMIN_EMAIL` | `admin@indiantown.example` | Admin sign-in email |
| `ADMIN_PASSWORD` | `indiantown-admin` | Admin sign-in password (change this before any public use) |

Admin review is at **http://localhost:3000/#/admin**.
