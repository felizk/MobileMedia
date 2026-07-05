---
name: verify
description: How to verify MobileMedia changes end-to-end by driving the real app in a headless browser.
---

# Verifying MobileMedia changes

The surface is a browser GUI talking to the live backend at
`https://mmbe.felizk.net` (no local backend needed; it's reachable and read
operations are safe).

## Launch

```bash
BROWSER=none yarn dev        # quasar dev on http://localhost:9000 (hash router: /#/)
```

`BROWSER=none` stops vite from opening a window on the user's desktop.
Note: `yarn dev` is SPA mode — **no service worker**. Anything under
`src-pwa/` needs `quasar build -m pwa` plus serving `dist/pwa` instead.

## Drive

No playwright in the repo; install `playwright-core` in the scratchpad and
point it at the system browser:

```js
import { chromium } from "playwright-core";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"] // needed for <video autoplay>
});
```

- Real, playable, **Encoded** episodes to point tests at: `Anime/Lycoris
Recoil` and `Anime/Ruri Rocks` (check current status via
  `GET /api/media/browse/<folder>` — statuses change as the library evolves;
  `Anime/Apocalypse Hotel` has had NotEncoded episodes, useful for
  unplayable-file cases).
- Seek-to-end works against the real stream (`video.currentTime =
duration - 2; play()` then wait for `ended`) — Range requests are
  supported, so this is cheap.
- Client state lives in localStorage: `mobilemedia-playback-positions`,
  `mobilemedia-watched`. Seed via `addInitScript`, but **guard with a
  sentinel key** — init scripts re-run on every navigation and will
  clobber state the app wrote since, invalidating multi-page flows.

## Gotchas

- Paths must match the server byte-for-byte (episode filenames contain
  brackets and long language tags) — always copy paths from a live
  `browse` response, never retype them.
- The footer/status bar comes from the encodes WebSocket; it connecting is
  a good "app fully booted" signal but not required for browse flows.
