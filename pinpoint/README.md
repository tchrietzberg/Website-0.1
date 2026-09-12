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

Open http://localhost:3000

Cursor Cloud preview forwards **port 3000 only**. This app listens there by default so the preview Open button works. Chrono billing stays at the repo root; start it on another port if you need both locally (`PORT=3001 node src/web/server.js`).

## Demo logins

Password for seeded users: **`pinpoint-demo-1`**

| Email | Name |
|---|---|
| alex@pinpoint.test | Alex Rivera |
| jordan@pinpoint.test | Jordan Lee |
| riley@pinpoint.test | Riley Chen |

Create your own account from the Sign in screen.

## What it does

- Drop a pinpoint from GPS, by clicking the map, or by checking in at a landmark
- Pins within ~100 meters share one place and one chat room
- Only people who visited a place can read or send messages there
- Other users never receive your exact coordinates (only a coarse centroid)
- Audit logs store place ids, not lat/lng

## Tests

```bash
cd pinpoint
npm test
```
