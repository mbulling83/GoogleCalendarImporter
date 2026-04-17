# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian plugin that imports Google Calendar events and tasks into notes. Renders live calendar blocks via `google-calendar` markdown code blocks with JSON configuration. Desktop-only (uses Node.js `http` for OAuth).

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

**OAuth flow:** `oauthServer.ts` spins up a local HTTP server on port 8080 to handle the Google OAuth 2.0 callback. Tokens are persisted in Obsidian's plugin data store via `this.saveData()`. The plugin requests read-only scopes for both Calendar and Tasks APIs.

**API layer:** `googleCalendarAPI.ts` wraps the `googleapis` SDK. Fetches events for a single day from the primary calendar and incomplete tasks (due within the past year) across all task lists. Token refresh is handled automatically via the `google-auth-library` `tokens` event.

**Code block rendering:** `codeBlockProcessor.ts` parses the JSON inside ` ```google-calendar ` blocks using `Injector/Parser.ts` (validates against the `Query` interface in `Injector/Query.ts`), then mounts a Svelte component (`ui/CalendarDisplay.svelte`) that fetches and displays the data with auto-refresh.

**UI:** Svelte 3 components in `ui/`. Compiled via `esbuild-svelte` plugin with `svelte-preprocess` for TypeScript support. Styles use Obsidian CSS variables (`--background-secondary`, `--text-accent`, etc.) for theme compatibility.

## Key Patterns

- The `Query` interface (`Injector/Query.ts`) defines the JSON schema for code blocks: `date`, `refreshInterval`, `showEvents`, `showTasks`, `title`. All fields are optional.
- Daily note detection uses a simple regex (`/\d{4}-\d{2}-\d{2}/`) against the filename — it does not integrate with the Periodic Notes plugin's configuration.
- Svelte components are imported with `// @ts-ignore` because the TypeScript compiler doesn't understand `.svelte` files.
- Version bumping: `npm version` triggers `version-bump.mjs` which syncs `manifest.json` and `versions.json`.
