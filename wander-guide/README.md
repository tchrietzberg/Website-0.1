# Wander Guide

A **separate** mobile phone app from Chrono. Wander Guide is a location-based audio tour guide: it reads your GPS, looks up the neighborhood, and a narrator tells you what is around you.

It is a Progressive Web App (PWA). On a phone you can install it to the home screen and use it like a native app. It does not share code, data, or auth with the legal billing system.

## What it does

1. Asks for location, lets you **enter a place**, or pick a demo city.
2. Reverse-geocodes the area with OpenStreetMap Nominatim.
3. Finds nearby notable places on Wikipedia.
4. Speaks a short, conversational tour — not a Wikipedia readout. It prefers a natural voice, talks at a walking pace with pauses, and strips pronunciation marks so it doesn’t sound robotic. If a browser still blocks autoplay, tap **Hear this tour**.
5. Follows you as you walk. When you move about 90 meters, it narrates the next landmark it has not already covered.
6. Lets you tap any nearby card or map pin to hear that place.

## Run locally

Requires Node.js ≥ 22.13. No npm install — zero runtime dependencies.

```bash
cd wander-guide
cp .env.example .env   # optional; defaults to port 4173
npm start
```

Open `http://127.0.0.1:4173` on a phone (same Wi-Fi) or in a desktop browser.

From the repository root:

```bash
npm run wander
npm run test:wander
```

## Install on a phone

1. Serve the app over HTTPS (or `localhost`). Browsers only expose GPS in a secure context.
2. On iPhone: Safari → Share → Add to Home Screen.
3. On Android: Chrome → menu → Install app / Add to Home screen.
4. Grant location when you tap **Start live tour**.
5. Unmute the phone. The narrator uses spoken text-to-speech, not a recorded audio file.

Desktop browsers can use **Try a demo city** without GPS. That is also the path to use in environments without a location sensor.

## Privacy

- Live coordinates are used only to look up the current area.
- The server never stores a trail of where you walked.
- Logs, if any, round coordinates to a ~1 km grid.
- The client talks only to this app’s origin. Nominatim and Wikipedia are queried server-side with a dedicated User-Agent.
- You can refuse GPS and still hear tours of curated cities.

## Security notes

- TLS 1.3 / HSTS when `PUBLIC_ORIGIN` is an `https://` URL or `NODE_ENV=production`.
- CSP, `X-Frame-Options: DENY`, `nosniff`, and `Permissions-Policy` with `geolocation=(self)` (required for the tour).
- GET-only APIs, schema-checked coordinates, in-memory rate limit, path-traversal guard, and no secrets in source.

## APIs

| Path | Purpose |
|---|---|
| `GET /api/health` | Liveness |
| `GET /api/here?lat=&lon=&radius=` | Area label, tour script, nearby places (`radius` 100–5000 m, default 1200) |
| `GET /api/here?demo=golden-gate` | Same payload for a curated city |
| `GET /api/search?q=` | Resolve a typed city/landmark/address, then the same tour payload |
| `GET /api/demo-locations` | Demo city list |

## Tests

```bash
cd wander-guide && npm test
```
