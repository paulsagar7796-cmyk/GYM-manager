# Gym Manager

A mobile-first PWA for a small gym owner to replace the paper register: track members
and renewals, assign workout and nutrition plans, chase dues over WhatsApp, and keep a
catalogue of affiliate products to recommend.

Built with Next.js 16 (App Router), React 19, TypeScript and Tailwind v4. It runs
entirely in the browser — no backend, no accounts.

## Features

- **Members** — add, edit and delete; status (Active / Due Soon / Overdue) is derived
  from the expiry date, never stored, so the badge can't drift from the data
- **Renewals** — extend a membership by a month and record the payment; undo restores
  the exact previous expiry
- **Income** — what was actually collected this month, plus a six-month bar chart
- **Plans library** — reusable workout and nutrition templates, assigned per member
  from a dropdown and sent over WhatsApp
- **Affiliate products** — a catalogue with per-sale commission, and a recommend flow
  that sends the member a tracked link. Commission is never included in that message
- **Import** — bring an existing roster in from CSV or JSON with column mapping and a
  preview before anything is written
- **Backup & restore** — export the whole dataset to a file and restore it on another
  device
- **Offline** — an app-shell service worker; the app opens and stays usable with no
  network

## Getting started

```bash
npm install
npm run dev     # http://localhost:3000
```

```bash
npm run build && npm run start   # production
npm run lint
```

The app opens as an empty gym. To explore it with data, go to **Settings → Load Sample
Data**.

## Project structure

```
src/app/         page, layout, error boundary, service worker registration
src/lib/
  gym-data.ts    types and the sample dataset
  gym-store.ts   external store (useSyncExternalStore) — the seam for a real backend
  gym-storage.ts persistence, schema validation and version migrations
  gym-utils.ts   dates, money, status, WhatsApp message building
  gym-import.ts  CSV/JSON parsing, column guessing, date disambiguation
public/sw.js     app-shell service worker
```

## Notes on a few decisions

**Dates are parsed as local midnight.** `new Date("2026-09-30")` is parsed as *UTC*
midnight, which lands on the previous day west of Greenwich and shifts every due-date
comparison. Day differences are rounded, not floored, because DST makes some days 23 or
25 hours long.

**Importing asks which date format it's looking at.** `05/10/2026` is a valid reading as
both 5 October and 10 May. The importer detects the order when the data proves it, says
so when it can't, and shows a live preview before writing.

**Nothing clock-dependent is rendered on the server.** The page is prerendered at build
time, so reading the date during render would bake build-day values into the HTML and
mismatch on hydration. State comes from an external store with separate server and
client snapshots.

**Storage is versioned with a migration chain.** Saved data is validated field by field
on load; a corrupt or hand-edited entry falls back rather than taking the app down.

## Status

Pre-release. Data lives in the browser's `localStorage` on a single device — there are
no accounts and no server copy, so changing phone or clearing site data loses
everything unless a backup file was saved. A Supabase-backed multi-tenant data layer is
the intended next step; `gym-store.ts` is the seam for it.
