# Waymark

Standalone phone app. **Not part of Chrono.** Drop stamps on a street map of places you have been — a private place journal.

Chrono (legal billing) stays at the repository root. This app lives only under `waymark/` and has its own database, users, and server.

## Requirements

Node.js ≥ 22.13 (`node:sqlite`).

## Quick start

```bash
cd waymark
npm run seed
npm start
```

Open http://localhost:3000 — the UI is a **phone app** (home-screen installable PWA). On a desktop it shows in a phone frame; on a real phone it goes full screen.

Cursor Cloud preview forwards **port 3000 only**. This app listens there by default so the preview Open button works. Chrono billing stays at the repo root; start it on another port if you need both locally (`PORT=3001 node src/web/server.js`).

## Install on your phone

1. Open the Waymark URL in Safari (iPhone) or Chrome (Android).
2. iPhone: Share → **Add to Home Screen** → Add.
3. Android: browser menu → **Install app** / **Add to Home Screen**.

The installed app opens standalone (no browser chrome). Sessions stay in HttpOnly cookies; the service worker caches the app shell only and never caches `/api/` responses.

## Demo logins

Password for seeded users: **`waymark-demo-1`**

| Email | Name |
|---|---|
| maya@waymark.test | Maya Chen |
| chris@waymark.test | Chris Alvarez |
| priya@waymark.test | Priya Shah |

Create your own account from the Sign in screen. Maya starts with a few sample stamps.

## What it does

- Stamp a place from GPS or by tapping the map
- Optional note and place name (reverse-geocoded when left blank)
- Map, Stamps, and Stats tabs — only you can see your exact GPS
- Share a **read-only book** with a link; friends see ~100 m approximate locations, never exact coordinates
- Street map via OpenStreetMap (proxied `/tiles/`) or Google Maps JavaScript API when `GOOGLE_MAPS_API_KEY` is set
- **Google Maps** opens the same spot in Google Maps

## Tests

```bash
cd waymark
npm test
```

## Security

Cookie sessions (HttpOnly, SameSite), CSRF on mutating routes, scrypt passwords, CSP / frame deny / nosniff, append-only audit log without lat/lng, integer microdegrees for coordinates. Set `SESSION_SECRET`, `PUBLIC_ORIGIN`, and `NODE_ENV=production` before any public deploy. Change demo passwords.
