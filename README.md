# Website 0.1

Personal site for **T. Chrietzberg** — four static pages, one stylesheet, no frontend framework.

## Pages

- `/` — home
- `/work.html` — selected work
- `/about.html` — bio
- `/contact.html` — form that drafts a `mailto:` note

## Requirements

Node.js 22 or newer.

## Commands

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit + page checks (run after a build)
npm run build
npm run preview  # http://localhost:4173
```

`npm test` expects `dist/` from `npm run build` so it can confirm the production pages exist.

## Notes

Chrono, the legal billing prototype, stays on its own branch. This project is a clean public site on `main`.
