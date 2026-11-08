# Deploying the dashboard to Cloudflare Pages

The repository is pushed to `git@github.com:syammohanvs/village.git`, branch
**`main`**. Every push to `main` triggers a Cloudflare Pages build.

## What Cloudflare builds (and what it ignores)

Cloudflare must treat **`web/frontend`** as the project root. The firmware and
the Python backend live outside that root, so a firmware commit cannot affect
the Pages build:

```
village/
├── web/frontend/        <-- Cloudflare Pages root
│   ├── src/
│   ├── public/
│   ├── functions/       <-- Pages Functions (API proxy)
│   ├── package.json
│   └── dist/            <-- build output (git-ignored)
├── web/backend/         <-- FastAPI + Whisper, NOT built by Pages
├── uc/                  <-- ESP32 firmware, NOT built by Pages
├── shared/              <-- protocol documents
├── docs/
└── scripts/
```

`uc/.pio/`, `data/`, `models/`, `web/frontend/dist/` and
`uc/include/village/secrets.h` are git-ignored, so they never reach the build.

## Pages project settings

In **Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git**:

| Setting | Value |
| --- | --- |
| Repository | `syammohanvs/village` |
| Production branch | `main` |
| Root directory | `web/frontend` |
| Framework preset | Vite (or None) |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |
| Node version | `22` (`NODE_VERSION=22`, and `.node-version` is committed) |

`public/_redirects` sends every client-side route to `index.html`, so
`/sensors`, `/controls` and the rest work on a hard refresh.

## The API is not static

Cloudflare Pages only serves files. It cannot run the FastAPI backend, the
SQLite store, Whisper or the waste model. The SPA calls `/api/v1/*` and
`/models/*`, so those must reach a real backend.

`web/frontend/functions/` contains a small reverse proxy:

- `/api/*` → `${VILLAGE_API_ORIGIN}/api/*`
- `/models/*` → `${VILLAGE_API_ORIGIN}/models/*`

Set the environment variable in **Pages → Settings → Environment variables**
(for both Production and Preview):

```
VILLAGE_API_ORIGIN = https://your-backend.example.com
```

The backend may live behind a **Cloudflare Tunnel** to the exhibition laptop:

```bash
cloudflared tunnel --url http://127.0.0.1:8010
```

Use a **named tunnel** for a stable hostname; the quick `trycloudflare.com`
URL changes on every restart.

Without `VILLAGE_API_ORIGIN`, `/api/v1/*` answers **503** with
`API_ORIGIN_MISSING`, and the dashboard correctly shows **Offline**. Lia still
works, because her guide is local; the live narration says it cannot see the
sensors.

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

| Feature | Local (`./scripts/launch.sh`) | Cloudflare Pages |
| --- | --- | --- |
| Dashboard UI | served by FastAPI | static, from `dist` |
| Live sensors / controls | yes | only with a reachable `VILLAGE_API_ORIGIN` |
| Whisper voice recognition | local server | needs the backend |
| Waste camera model | local `models/` | proxied from the backend |
| Lia guide + browser speech | yes | yes, entirely in the browser |

## Manual deploy (optional)

The Git integration is the normal path. To deploy directly:

```bash
cd web/frontend
npm ci
npm run build
npx wrangler pages deploy dist --project-name village
```

The Git integration remains the source of truth for the `main` branch.
