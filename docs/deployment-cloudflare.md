# Deploying to Cloudflare (Worker with static assets)

The repository is pushed to `git@github.com:syammohanvs/village.git`, branch
**`main`**. Every push to `main` triggers a Cloudflare build.

The dashboard is deployed as a **Cloudflare Worker with static assets**, not as
a classic Pages project. That is what the current Cloudflare Git flow creates,
and it is what `web/frontend/wrangler.jsonc` is written for.

## What Cloudflare builds (and what it ignores)

Cloudflare must treat **`web/frontend`** as the project root. The firmware and
the Python backend live outside it, so a firmware commit cannot affect the
build:

```
village/
├── web/frontend/        <-- Cloudflare build root
│   ├── src/
│   ├── public/
│   ├── functions/       <-- the shared API proxy module
│   ├── worker.js        <-- Worker entry: API proxy + static assets
│   ├── wrangler.jsonc
│   └── dist/            <-- build output (git-ignored)
├── web/backend/         <-- FastAPI + Whisper, NOT built by Cloudflare
├── uc/                  <-- ESP32 firmware, NOT built by Cloudflare
├── shared/
├── docs/
└── scripts/
```

`uc/.pio/`, `data/`, `models/`, `web/frontend/dist/` and
`uc/include/village/secrets.h` are git-ignored, so they never reach the build.

## Build settings

In the Cloudflare project (Workers & Pages → your Worker → Settings → Build):

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `web/frontend` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |
| Node version | `22` (`NODE_VERSION=22`; `.node-version` is committed) |

`web/frontend/wrangler.jsonc` supplies the rest:

- `main` → `worker.js`
- `assets.directory` → `./dist`
- `assets.binding` → `ASSETS`
- `assets.not_found_handling` → `single-page-application`
- `assets.run_worker_first` → `true`

There is deliberately **no `public/_redirects`**. Workers rejects
`/* /index.html 200` as an infinite loop; SPA routing is handled by
`not_found_handling` instead.

## The API proxy

`worker.js` sends `/api/*` and `/models/*` to the FastAPI backend and serves
everything else from `dist/`.

Set the backend origin in **Settings → Variables and Secrets** (Production and
Preview):

```
VILLAGE_API_ORIGIN = https://your-backend.example.com
```

For local preview:

```bash
cd web/frontend
npm ci
npm run build
echo 'VILLAGE_API_ORIGIN=https://your-backend.example.com' > .dev.vars
npx wrangler dev
```

Without `VILLAGE_API_ORIGIN`, `/api/v1/*` answers **503**
`API_ORIGIN_MISSING` and the dashboard correctly shows **Offline**. Lia still
works, because her guide is local; the live narration says it cannot see the
sensors.

## Backend hosting

Cloudflare static hosting cannot run FastAPI, SQLite, Whisper or the waste
model. The backend must be reachable from Cloudflare. For the exhibition
laptop, a **Cloudflare Tunnel** is the simplest:

```bash
cloudflared tunnel --url http://127.0.0.1:8010
```

Use a **named tunnel** for a stable hostname; the quick `trycloudflare.com` URL
changes on every restart.

## Security — read this before exposing the API

The Python API has **no login**. It was written for a private LAN. If you
publish a tunnel URL, anyone who finds it can switch the streetlights and read
the sensors. The pump is protected by two independent gates
(`VILLAGE_PUMP_COMMISSIONED=0` and `pump_enabled=false`), but the lights are
real.

For a public exhibition, put **Cloudflare Access** in front of the tunnel
hostname (email one-time PIN or a service token), or keep the backend
localhost-only and host only the static guide. Do not expose the API broadly
and leave it unauthenticated.

## Local vs deployed behaviour

| Feature | Local (`./scripts/launch.sh`) | Cloudflare |
| --- | --- | --- |
| Dashboard UI | served by FastAPI | static assets in the Worker |
| Live sensors / controls | yes | only with a reachable `VILLAGE_API_ORIGIN` |
| Whisper voice recognition | local server | needs the backend |
| Waste camera model | local `models/` | proxied from the backend |
| Lia guide + browser speech | yes | yes, entirely in the browser |

## If you use classic Pages instead

The `functions/` folder still contains Pages-style routes
(`functions/api/[[path]].js`, `functions/models/[[path]].js`) that share the
same proxy. For a Pages project, add `public/_redirects` with
`/* /index.html 200`, use root `web/frontend`, build `npm ci && npm run build`
and output `dist`. Do not run both configurations at once.
