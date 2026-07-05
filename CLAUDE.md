# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow

Work directly on `main` — no feature branches. Commit to `main` and push there.

## Commands

- `yarn dev` — dev server with HMR (`quasar dev`).
- `yarn lint` — format and autofix (`oxfmt && oxlint --fix`). Run before committing.
- `yarn lint:check` — CI-style check without writing (`oxfmt --check && oxlint`).
- `yarn typecheck` — `vue-tsc --noEmit`. There is no test suite.
- `yarn build` — **SPA** build. Does **not** include the service worker.
- `quasar build -m pwa` — **PWA** build. This is what ships (see `Dockerfile`); use it whenever you touch `src-pwa/` or anything offline-related, since SPA mode omits the service worker entirely.

Verification loop for a change: `yarn lint && yarn typecheck`, then `quasar build -m pwa` if service-worker/PWA code is involved.

## Stack

Quasar 2 + Vue 3 (`<script setup>`) + Vite + Pinia, TypeScript. Routing is **file-based** via `unplugin-vue-router` (`vue-router/auto-routes`); `src/router/typed-router.d.ts` is generated — don't hand-edit it. Router runs in **hash mode** (`quasar.config.ts`). Path alias `@/` → `src/`.

Pages live in `src/pages/`. `src/pages/index.vue` is the app shell (header + always-visible footer) and every real page is a child under `src/pages/index/` rendered through its `<router-view>`. `[...path].vue` files are catch-all routes carrying a `path` param (used for arbitrary-depth media folders and file paths).

## Backend contract

The app is a client for the **MediaTryk** server (a separate repo). Base URL is hardcoded as `https://mmbe.felizk.net` in `src/services/media-api.ts` (`API_ORIGIN`). The full API contract is documented at `/home/felizk/RiderProjects/MediaTryk/docs/API.md` — read it before changing anything in `src/services/media-api.ts` or `src/services/encode-api.ts`.

Key model: there are **two file trees**. The _source_ tree (`.mkv`, what `browse` lists) and the _media_ tree (`.mp4`, what `stream` serves). Encoding a source file produces a media file at the same relative path with a `.mp4` extension. `getStreamUrl()` maps a source path to its media URL — never build stream URLs by hand. `browse` returns each file's `encodeStatus` (`Encoded` | `Encoding` | `NotEncoded`) and accepts `?encodedOnly=true` to return only streamable content.

The encode queue is driven over a **WebSocket** (`wss://…/api/encode/queue/ws`), not polling. Contract quirks that shape the client code: clear-finished sends **no** removal message — so the client replaces its state from the snapshot on every (re)connect and refetches after clearing — and jobs are sorted by the opaque `order` field, not `queuedAt` (requeueing a Failed/Canceled job reuses its id and moves it to the front of the queue). Adding an external host (including `wss:`) requires updating the CSP `connect-src` in `index.html`.

## State: two Pinia stores (`src/stores/`)

- **`encodes.ts`** — live mirror of the server encode queue. Owns the WebSocket (with reconnect/`online` handling), exposes `jobBySourcePath` so browse listings can overlay live encode state on top of the static `encodeStatus`, and keeps a localStorage-backed "auto-download when this job completes" registry that pushes finished encodes into the downloads store.
- **`downloads.ts`** — client-side download queue. Downloads actually run in the service worker; this store decides _when_ to start each so at most **3 run concurrently**, tracks per-file progress, persists the pending queue, and holds the `storage`/persistence state (`navigator.storage.estimate()` / `persist()`). It also owns the `downloadedOnly` browse preference.

Both stores are singletons initialized once from the app shell (`index.vue` calls `.init()`); components read reactive state from them rather than calling services directly.

## Offline video (`src-pwa/sw/`)

The custom service worker (`custom-sw.ts`, `workboxMode: "InjectManifest"`) does three things beyond Workbox precaching:

1. **Media-browse caching** — `NetworkFirst` for `/api/media/browse/`, so previously visited folders browse offline. The root listing is warmed on `install`.
2. **Offline video** — the `offline-video/` modules (ported from the Kino sample) download a file in chunks into IndexedDB and serve it back with HTTP Range support, so `<video>` playback works offline. Communication with pages is via `postMessage` (`download-video` / `delete-video` in, progress/done/error out); see `src/services/offline-video.ts` for the client half.

**IndexedDB ownership**: the service worker owns the schema. Read-only client access (`src/services/offline-video-status.ts`) must open the DB **without a version** — opening with a version can create an empty stub that suppresses the SW's `onupgradeneeded`. Follow the existing pattern there.

## Deploy

`Dockerfile` runs `quasar build -m pwa` and serves the static output via nginx (`docker/nginx.conf`); `.github/workflows/docker-publish.yml` publishes to GHCR.
