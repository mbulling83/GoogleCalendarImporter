# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian plugin that imports Google Calendar events into notes. Renders live calendar blocks via `google-calendar` markdown code blocks with JSON configuration. Desktop-only (uses Node `fetch` to pull the iCal feed). Read-only: it consumes Google Calendar's **secret address in iCal format** — no OAuth, no Google Cloud project, no client ID/secret.

## Build Commands

```bash
npm install          # Install dependencies
npm run dev          # Development build with watch mode and inline sourcemaps
npm run build        # Production build (type-checks with tsc, then bundles with esbuild)
```

No test framework is configured. No linting script is defined — ESLint config exists but must be run manually (`npx eslint .`).

The build output is `main.js` in the project root. Obsidian loads this file directly.

## Architecture

**Entry point:** `main.ts` — Plugin class (`GoogleCalendarImporter`) that registers a `file-open` event listener for auto-injecting calendar blocks into daily notes, an editor command for manual insertion, and a `google-calendar` code block processor.

**iCal feed:** `googleCalendarAPI.ts` (`GoogleCalendarAPI`) fetches the configured secret iCal URL with `fetch` and parses it with [`ical.js`](https://www.npmjs.com/package/ical.js). The only setting is `icsUrl` (stored in Obsidian's plugin data via `this.saveData()`). Because the feed carries events only, **Google Tasks are no longer supported** — the iCal URL is read-only and exposes no tasks. Results are cached in memory for ~30s so the auto-refresh timer does not hammer Google.

**Recurring + override expansion:** `extractEventsForDate` iterates `ICAL.RecurExpansion` over a window of the queried day ±7 days, so recurring events (e.g. a weekly meeting) appear on the right day and one-off overrides (a moved or cancelled instance, signalled by a matching `RECURRENCE-ID`) are substituted or dropped. Output is normalised into Google-API-compatible `{ summary, start, end }` objects so the renderer needs no changes.

**Code block rendering:** `codeBlockProcessor.ts` parses the JSON inside ` ```google-calendar ` blocks using `Injector/Parser.ts` (validates against the `Query` interface in `Injector/Query.ts`), then mounts a Svelte component (`ui/CalendarDisplay.svelte`) that fetches and displays the data with auto-refresh.

**UI:** Svelte 3 components in `ui/`. Compiled via `esbuild-svelte` plugin with `svelte-preprocess` for TypeScript support. Styles use Obsidian CSS variables (`--background-secondary`, `--text-accent`, etc.) for theme compatibility.

## Key Patterns

- The `Query` interface (`Injector/Query.ts`) defines the JSON schema for code blocks: `date`, `refreshInterval`, `showEvents`, `title`. All fields are optional.
- `ical.js` is used untyped via `ical.js.d.ts` (ambient module) to avoid coupling the type-check to its incomplete bundled types; esbuild bundles it regardless.
- Daily note detection uses a simple regex (`/\d{4}-\d{2}-\d{2}/`) against the filename — it does not integrate with the Periodic Notes plugin's configuration.
- Svelte components are imported with `// @ts-ignore` because the TypeScript compiler doesn't understand `.svelte` files.
- Version bumping: `npm version` triggers `version-bump.mjs` which syncs `manifest.json` and `versions.json`.
