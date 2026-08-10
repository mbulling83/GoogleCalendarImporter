# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian plugin that imports Google Calendar events into notes **as plain markdown text**, via a single command. Desktop-only. Read-only: it consumes Google Calendar's **secret address in iCal format** — no OAuth, no Google Cloud project, no client ID/secret.

Scope is deliberately narrow. There are no live calendar blocks, no Svelte UI, and no automatic daily-note injection — those were stripped in v1.3.0. If you are tempted to add a renderer back, don't.

## Build Commands

```bash
npm install          # Install dependencies
npm run dev          # Development build with watch mode and inline sourcemaps
npm run build        # Production build (type-checks with tsc, then bundles with esbuild)
```

No test framework is configured. No linting script is defined — ESLint config exists but must be run manually (`npx eslint .`).

The build output is `main.js` in the project root. Obsidian loads this file directly.

## Architecture

**Entry point:** `main.ts` — Plugin class (`GoogleCalendarImporter`) registering exactly one editor command, `insert-calendar-events-as-text`. It opens `DateInputModal` for a target date (defaulting to the `YYYY-MM-DD` found in the filename, else today), fetches that day's events, formats them with the user's templates, and inserts the result at the cursor. Plus a settings tab.

**iCal feed:** `googleCalendarAPI.ts` (`GoogleCalendarAPI`) fetches the configured secret iCal URL with `fetch` and parses it with [`ical.js`](https://www.npmjs.com/package/ical.js). The only setting is `icsUrl` (stored in Obsidian's plugin data via `this.saveData()`). Because the feed carries events only, **Google Tasks are no longer supported** — the iCal URL is read-only and exposes no tasks. Results are cached in memory for ~30s so repeated imports do not hammer Google.

**Recurring + override expansion:** `extractEventsForDate` iterates `ICAL.RecurExpansion` over a window of the queried day ±7 days, so recurring events (e.g. a weekly meeting) appear on the right day and one-off overrides (a moved or cancelled instance, signalled by a matching `RECURRENCE-ID`) are substituted or dropped. Output is normalised into Google-API-compatible `{ summary, start, end }` objects.

**Formatting:** `formatCalendarData` in `main.ts` renders each event through a user-configurable template. Variables: `{title}`, `{start}`, `{end}` (24-hour), `{start12}`, `{end12}` (12-hour). Two templates — `eventFormat` for timed events and `allDayFormat` for all-day ones.

**UI:** only `dateInputModal.ts` (a plain Obsidian `Modal`) and `styles.css`, which uses Obsidian CSS variables for theme compatibility.

## Key Patterns

- `ical.js` is used untyped via `ical.js.d.ts` (ambient module) to avoid coupling the type-check to its incomplete bundled types; esbuild bundles it regardless.
- The default date is pulled from the filename with a simple regex (`/\d{4}-\d{2}-\d{2}/`) — it does not integrate with the Periodic Notes plugin's configuration.
- Settings are `icsUrl`, `eventFormat`, `allDayFormat`. Stale keys left in an existing `data.json` (e.g. `enabledForDailyNotes`) are ignored by the `Object.assign` merge — no migration needed.
- Version bumping: `npm version` triggers `version-bump.mjs` which syncs `manifest.json` and `versions.json`.
