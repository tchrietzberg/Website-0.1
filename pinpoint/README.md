# Pinpoint

Standalone location app. **Not part of Chrono.** Pin where you were, then chat with other people who were at the same spot (about 100 meters).

Chrono (legal billing) stays at the repository root. This app lives only under `pinpoint/` and has its own database, users, and server.

## Requirements

Node.js ≥ 22.13 (`node:sqlite`).

## Quick start

```bash
cd pinpoint
npm run seed
npm start
```

Open http://localhost:3000 — the UI is a **phone app** (home-screen installable PWA). On a desktop it shows in a phone frame; on a real phone it goes full screen.

Cursor Cloud preview forwards **port 3000 only**. This app listens there by default so the preview Open button works. Chrono billing stays at the repo root; start it on another port if you need both locally (`PORT=3001 node src/web/server.js`).

## Install on your phone

1. Open the Pinpoint URL in Safari (iPhone) or Chrome (Android).
2. iPhone: Share → **Add to Home Screen** → Add.
3. Android: browser menu → **Install app** / **Add to Home Screen**.

The installed app opens standalone (no browser chrome). Sessions stay in HttpOnly cookies; the service worker caches the app shell only and never caches `/api/` responses.

## Demo logins

Password for seeded users: **`pinpoint-demo-1`**

| Email | Name |
|---|---|
| alex@pinpoint.test | Alex Rivera |
| jordan@pinpoint.test | Jordan Lee |
| riley@pinpoint.test | Riley Chen |

Create your own account from the Sign in screen.

## What it does

- Drop a pinpoint from GPS, by tapping the map, or by checking in at a landmark
- The Map tab is a real street map (Google Maps JavaScript API when `GOOGLE_MAPS_API_KEY` is set, otherwise OpenStreetMap). **Google Maps** opens the same spot in Google Maps.
- Pins within ~100 meters share one place and one chat room
- Only people who visited a place can read or send messages there
- Other users never receive your exact coordinates (only a coarse centroid)
- Audit logs store place ids, not lat/lng

## Tests

```bash
cd pinpoint
npm test
```
