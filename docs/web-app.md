# The web app — stack, contracts and where things live

A brief for a reviewing or working agent. It describes the running system: what
processes exist, how the browser talks to them, where state is kept, and which
rules are load-bearing. It does **not** repeat the firmware (`docs/esp32-and-wifi.md`),
speech (`docs/voice-languages.md`) or waste (`docs/waste-approach.md`) briefs —
it points at them.

Everything below is a path in this repository, a value in the source, or a
measured observation. Where something is a decision, it says so and gives the
reason.

---

## 1. The one-minute version

```
browser (React 19 + Vite)          one origin, :8010
        │  /api/v1/*  (session cookie or bearer)
        ▼
FastAPI backend (uvicorn) ─────────┬── SQLite   data/village.db
        │  HTTP + X-Device-Token   ├── files    data/{waste-*,voice-clips,cache}
        ▼                          └── models   models/ (served at /models)
ESP32 controller (Wi-Fi)                local servers, started with the app:
        │                                whisper.cpp :8080 (base), :8182 (hi)
        └─ pins                          Piper       (spawned per request)
```

- **One Python process serves everything**: the JSON API, the built SPA, the
  model files and the audio. There is no Node server in production and no second
  port to open.
- **The browser never talks to the board.** It talks to the backend; the backend
  is the only holder of `VILLAGE_DEVICE_TOKEN` (see `docs/esp32-and-wifi.md` §6).
- **One HTML file, one bundle.** `web/frontend/dist/index.html` names a hashed
  JS/CSS bundle; the backend serves it with `Cache-Control: no-store` and the
  hashed files under `/assets` as immutable.
- **Two device sources, one interface.** `VILLAGE_DEVICE_MODE=real` uses the
  ESP32 over HTTP; `simulator` uses `SimulatedDevice` in-process. The page's
  Simulation mode is the same simulator, never the board.
- **One account, one SQLite file.** No ORM, no migration framework: `CREATE
  TABLE IF NOT EXISTS` and additive changes. `data/village.db` is committed on
  purpose (it carries settings and accounts to a new laptop).

---

## 2. Backend stack

`web/backend/` — Python **≥ 3.11**, FastAPI, uvicorn. Requirements are pinned in
`requirements.txt` (and `pyproject.toml`):

| package | version | used for |
| --- | --- | --- |
| fastapi | 0.136.1 | routes, validation, static mounts |
| uvicorn[standard] | 0.46.0 | the server (`scripts/launch.sh`) |
| httpx | 0.28.1 | the ESP32 client, Cloudflare/OpenCode calls |
| pydantic | 2.13.4 | request/response models (`protocol.py`) |
| aiosqlite | 0.22.1 | the one database connection |
| python-dotenv | 1.2.4 | `.env` then `.env.secrets` |
| python-multipart | 0.0.33 | WAV uploads for speech |

The waste classifier adds PyTorch (`requirements-waste.txt`); the tests add
pytest (`requirements-dev.txt`). `scripts/setup.sh` installs all three into
`.venv`.

### 2.1 Settings

`app/config.py` is a frozen `Settings` dataclass, built once by
`Settings.load()`:

1. `python-dotenv` load of `<repo>/.env` (no override),
2. then `<repo>/.env.secrets` **with override** — the one file that holds the
   Cloudflare token, because GitHub's push protection refuses it even in a
   private repository,
3. then every `VILLAGE_*` value is read from the environment.

Defaults are chosen so a fresh clone runs; relative paths are resolved against
the repository root, not the shell's cwd. The settings that matter most:

| setting | default | meaning |
| --- | --- | --- |
| `VILLAGE_DEVICE_MODE` | `simulator` | `real` = ESP32 over HTTP |
| `VILLAGE_DEVICE_URL` | `http://192.168.1.50` | the board, or the Windows relay |
| `VILLAGE_DEVICE_TOKEN` | dev placeholder | `X-Device-Token`, server-side only |
| `VILLAGE_POLL_INTERVAL_MS` | 1000 | `/status` polling |
| `VILLAGE_STALE_AFTER_MS` | 4000 | older than this is **stale** |
| `VILLAGE_DISCONNECT_AFTER_MS` | 9000 | older than this is **disconnected** |
| `VILLAGE_AUTH_ENABLED` | true | the sign-in gate |
| `VILLAGE_ADMIN_USER` / `_PASSWORD` / `_PASSWORD_HASH` | `admin` / `village` | the one account |
| `VILLAGE_SESSION_HOURS` | 12 | cookie lifetime |
| `VILLAGE_SHARE_LINK` | true | the visitor link |
| `VILLAGE_DB_PATH` | `data/village.db` | state |
| `VILLAGE_DIST_DIR` | `web/frontend/dist` | the SPA |
| `VILLAGE_CORS_ORIGINS` | empty | exact extra origins (`https://*.pages.dev` is always allowed by regex) |
| `VILLAGE_WHISPER_URL` / `_URL_HI` | `:8080` / empty | speech servers |
| `VILLAGE_PIPER_BIN` / `_VOICES` | `models/piper/...` | speech out |
| `VILLAGE_VOICE_CLIPS` / `_CLIP_BYTES` | 100 / 64 MB | kept recordings |
| `VILLAGE_WASTE_LEARN` | true | file a named press as training data |

The full list is in `.env` and `.env.example`; the vision chain has its own
(`VILLAGE_CF_API_TOKEN[_2]`, `VILLAGE_CF_ACCOUNT_ID[_2]`,
`VILLAGE_VISION_API_KEY`, `VILLAGE_VISION_*` timeouts) documented in
`docs/waste-approach.md`.

### 2.2 Module map

| file | what it owns |
| --- | --- |
| `app/main.py` | `create_app`, lifespan, middleware, every route, SPA fallback |
| `app/config.py` | `Settings`, `.env` load, defaults, path resolution |
| `app/protocol.py` | pydantic request bodies, `ALLOWED_COMMANDS`, waste/test enums |
| `app/device.py` | ESP32 HTTP client, discovery, polling, staleness, command cache |
| `app/simulator.py` | `SimulatedDevice`: the demo village and its lab knobs |
| `app/db.py` | SQLite schema, events/recognitions/disposals/profiles/settings/samples |
| `app/auth.py` | PBKDF2 password, HMAC session token, guest username |
| `app/intents.py` | the deterministic command grammar (`shared/intents.json`) |
| `app/voice.py` | Whisper client, language routing, prompt rules |
| `app/ml_asr.py` | the Malayalam fine-tune (fallback to whisper-server) |
| `app/tts.py` | Piper voices, per-language model choice, cache |
| `app/voice_clips.py` | bounded recordings + sidecars for replay |
| `app/vision.py` | hosted naming chain and its deadlines |
| `app/waste_resnet.py` | the local ResNet50 classifier |

---

## 3. Lifecycle

`create_app()` builds the app from a `Settings` and injects the database,
gateway, voice client, TTS and intent matcher into `app.state` — which is why
tests can substitute a simulator or a scratch database.

`lifespan` (startup → shutdown):

1. Log the sign-in mode: warns when the gate is off, warns when the **built-in
   default password** is still in use, logs the account when it is neither.
2. Log the voice-clip retention policy (count, folder, byte ceiling) or that it
   is off.
3. `waste_resnet.configure(settings)` — loads the classifier lazily.
4. `db.init()` — opens SQLite (`WAL`, `foreign_keys`, `busy_timeout=5000`),
   creates tables, prunes old rows.
5. Create or read the **share key** (stored in `settings`, fixed across
   restarts, travels with the database).
6. `gateway.start()` — starts the 1 s device poll loop.
7. Start the **sensor sampler**: every **10 s** it writes one sample of the live
   frame and one of the demo frame, and drains device events into the event log.
8. On shutdown: stop the sampler, stop polling, close the database.

---

## 4. The HTTP surface

All routes are under `/api/v1`. The SPA shell and the static files stay public
(the login form has to load); everything else goes through one middleware.

### 4.1 Who may call what

- **Public**: `/auth/login`, `/auth/session`, `/auth/magic` (the share link,
  because it is what issues the session) and `/system/health`.
- **Signed in**: everything else.
- **Guest** (a share link): reads are allowed; writes only to
  `GUEST_POST_PATHS` — `commands` (and the route refuses `mode: "live"`),
  `demo/scenario`, `demo/reset`, `simulator/scenario`, the three waste
  classifier/recognition routes, the three voice routes, and `auth/logout`.
  Calibration, settings, device config, profiles, waste corrections/teach and
  the bench commands are **reads only** for a guest. `/waste/clear` is not on
  the list either: the page sends it as an early lamp-off convenience and
  ignores a failure, so a visit still works without it.
- `OPTIONS` is answered before the session check, and CORS is registered last so
  it is outermost: a 401 must still carry the CORS headers, or the browser says
  "failed to fetch" instead of "sign in".

### 4.2 Route groups

| group | routes |
| --- | --- |
| auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`, `GET|POST /auth/magic`, `GET|POST /auth/share-link` |
| system | `GET /system/health` (status, version, device mode/URL, `voice.ready`) |
| village | `GET /state?mode=live|demo`, `POST /commands`, `GET /events`, `GET /sensors/history` |
| device | `GET|PUT /device/config`, `POST /calibration/soil`, `POST /calibration/reservoir`, `GET /device/health` |
| waste | `GET /waste/model-status`, `GET /waste/resnet-status`, `GET /waste/captures`, `POST /waste/classify`, `POST /waste/identify`, `POST /waste/correction`, `POST /waste/clear`, `POST /waste/teach`, `POST /waste/recognition`, `POST /waste/disposals` |
| profiles | `GET|POST /profiles`, `GET /profiles/:id` |
| voice | `GET /voice/intents`, `GET /voice/readiness`, `POST /voice/speak`, `POST /voice/interpret`, `POST /voice/transcribe` |
| settings | `GET|PUT /settings`, `GET /setup/checklist` |
| simulation | `POST /demo/scenario`, `POST /demo/reset`, `POST /simulator/scenario` |
| static | `/models/*`, `/assets/*`, `/audio/*`, and the SPA catch-all `GET /{path}` |

`/state` is the page's once-per-2 s read. It returns
`{mode, physical, source{kind,label}, server_time, connection{connected, stale,
age_ms, last_success_at, last_error, boot_id, device_id, reconnects}, status}` —
`status` is the controller's own `/status` payload (or the simulator's), not a
normalised copy.

### 4.3 Commands and the ack

`POST /commands` takes
`{mode, type, parameters, request_id, source}`. The backend:

1. rejects a type outside `ALLOWED_COMMANDS` (422) and validates the
   parameter shapes that have enums (`TEST_OUTPUT`, `INDICATE_WASTE`);
2. refuses `mode: "live"` from a guest (403);
3. sends to the gateway with the browser's `request_id` as `command_id`;
4. records an event (`<Type> · ACCEPTED|REJECTED|DUPLICATE`);
5. returns `{confirmed, mode, physical, ack, error, duplicate_request, state}` —
   **503 when unconfirmed**, so "sent" can never be mistaken for "worked".

`confirmed` is true only for a real acknowledgement. A duplicate `request_id`
with the same body is answered from the gateway cache (marked
`duplicate_request: true`, TTL 600 s, 100 entries); the same id with a
*different* body is **409** (`RequestReuseError`). A live command triggers one
immediate poll so the returned state is after the action.

---

## 5. Device gateway and the two sources

`app/device.py` is the only code that speaks to the board.

- `HttpDevice` — `httpx.AsyncClient(base_url=VILLAGE_DEVICE_URL, timeout=3 s,
  X-Device-Token)`.
- `SimulatedDevice` — the demo world (`app/simulator.py`), driven by
  `POST /demo/scenario` (soil, tank, light, solar, wind, pump/lights manual,
  faults) and `POST /demo/reset`.
- `DeviceGateway` — owns which one applies:
  - `mode="live"` → the ESP32 when `VILLAGE_DEVICE_MODE=real`, refusing to fall
    back to the simulator (a live answer is a hardware answer or nothing);
  - `mode="demo"` → the simulator, never the board;
  - `physical` in the response says which actually answered.
- **Polling**: a background loop every 1 s; on failure the interval doubles up
  to 30 s; `stale` at 4 s, `connected: false` at 9 s.
- **Discovery** (`VILLAGE_DEVICE_DISCOVER`, default true): sweep the /24 of the
  configured URL for a host answering `/api/v1/health` with the token, at most
  once per `VILLAGE_DEVICE_DISCOVER_SECS`. This container sets it **false**
  because the Windows relay (`scripts/relay.sh`) does the discovery instead.
- **Events**: connect/disconnect/reboot and command outcomes are drained into
  the `events` table by `/state` and by the 10 s sampler.

The page's mode knob is one selection: **Live** (`live`), **Simulation**
(`demo`), **Test** (live readings, bench panel owns the outputs). A guest is
forced to Simulation on every load.

---

## 6. Data

`app/db.py`, one `aiosqlite` connection, `PRAGMA journal_mode=WAL`.

**One schema, two populations.** Live and demo rows are separate tables:
`events`/`demo_events`, `recognitions`/`demo_recognitions`,
`disposals`/`demo_disposals`, `sensor_samples`/`demo_sensor_samples`. Profiles
are **demo only** (`demo_profiles` — there is no live `profiles` table), and
`settings` is shared. The table helpers refuse any mode other than
`live`/`demo` — there is no third state.

Caps (rows kept, newest first, pruned on write/startup): **2000** events,
**1000** recognitions, **2000** sensor samples.

`settings` is a key/value table; `Database.get_settings()` merges
`DEFAULT_SETTINGS` with the stored values, and **removes** `share_key` — it is
stored there but is a credential, not a setting a client may read.

On disk, next to the database:

| folder | contents | in git |
| --- | --- | --- |
| `data/waste-samples/` | human-corrected crops, the training tree | **yes** |
| `data/waste-knowledge/` | machine-named booth crops (`--extra-train`) | no |
| `data/waste-rejected/` | crops removed after review (outside the tree) | no |
| `data/waste-captures/` | rolling log of what the classifier judged | no |
| `data/voice-clips/` | last N recordings + JSON sidecars | no |
| `data/cache/tts/` | Piper output cache | no |
| `data/logs/` | backend/whisper/relay logs | no |

---

## 7. Auth and the share link

`app/auth.py`:

- **Password**: PBKDF2-HMAC-SHA256 with a salt (`pbkdf2$...`). A supplied
  `VILLAGE_ADMIN_PASSWORD_HASH` is used **as given**, never re-hashed.
- **Session**: the cookie `village_session` carries
  `username|expiry|HMAC-SHA256(payload)`; the signing key is derived from the
  stored hash, so changing the password invalidates every cookie while a
  restart does not. `HttpOnly`; `SameSite=Lax` on http and `SameSite=None`
  with `Secure` on https — decided from the **request's own scheme**, not from
  the CORS list, so an https origin in that list cannot turn the local http
  cookie into one the browser drops.
- **Two carriers**: the cookie (same origin) and `Authorization: Bearer <token>`
  (a hosted page, where a third-party cookie would be refused). `session_token()`
  reads either.
- **One username** (`VILLAGE_ADMIN_USER`); `VILLAGE_AUTH_ENABLED=false` opens
  every screen for a bench session and logs a warning.
- **Login throttle**: 5 failures from one address, then a 60 s pause. Not an
  account lockout — just enough that guessing by hand is slower than reading
  the label on the laptop.

**The share link** (`GET /auth/magic?key=…`, public): the key is a 32-hex
value stored in `settings` (not derived, because a derived key would change
when a plaintext password is re-salted on restart). It issues a **guest** session
and 303s to `/?mode=demo`; the page strips `?mode` after reading it. The card in
Setup offers Copy and **New link** (which retires the old key). A hosted copy
offers `…/?api=<backend>&share=<key>` instead, so the page and the API share an
origin.

Security headers are set on every response: `nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, a `Permissions-Policy` that allows camera and
microphone to self, and a CSP (`default-src 'self'`, `img-src 'self' data: blob:`,
`script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'`, `connect-src` = self +
configured origins).

---

## 8. Speech and waste in the app (pointers, not copies)

- **Speech in**: `POST /voice/transcribe` takes a WAV (≤5 MB, ≤12 s), routes by
  `language` (never auto-detected): English/Hindi to whisper.cpp (`:8080`, Hindi
  may use `:8182` with `whisper-small`), Malayalam to the fine-tune in
  `ml_asr.py` with a fallback to whisper-server. The parser
  (`IntentMatcher`, `shared/intents.json`) is deterministic; every language
  refuses a sentence with an unaccounted content word. See
  `docs/voice-languages.md` for the measurements and the grammar.
- **Speech out**: `POST /voice/speak` shells out to Piper, one voice per
  language, Indian English by default, with the speech-only rewrites
  (`Sara → Sahra`, sentence-final `you → yoo`). The route caches by text/voice.
- **Waste**: `classify` (ResNet50, offline), `identify` (hosted name, chain of
  Cloudflare account 1 → account 2 → DeepSeek), `recognition` (record the
  answer and light the lamp), `clear`, `teach`, `correction`. **The bin decision
  is made in the browser** (`web/frontend/src/lib/wasteDecision.ts`), because it
  is a string rule over the name plus the classifier's numbers; the backend
  stores what happened. `docs/waste-approach.md` is the authority on thresholds
  and provenance.

---

## 9. Frontend stack

`web/frontend/` — **React 19.1**, **Vite 7.1**, **TypeScript 5.9**,
**react-router-dom 7.18**, **Vitest 3.2 + jsdom**, plain CSS.

| dependency | why it is there |
| --- | --- |
| `react`, `react-dom` 19.1.1 | the app |
| `react-router-dom` 7.18.5 | one router, kiosk and console shells |
| `@fontsource/inter`, `@fontsource/playfair-display` | local fonts (no CDN) |
| `vite`, `@vitejs/plugin-react` | build and dev server |
| `vitest`, `jsdom`, `@testing-library/*` | component and unit tests |

There is **no UI framework, no state library and no fetch wrapper library**:
styling is `src/styles.css` (CSS custom properties for the theme, 2.7k lines),
state is React context, and HTTP is `src/lib/api.ts`. Adding Tailwind or a query
library would be a change of architecture, not a tidy-up.

`npm run build` runs `tsc --noEmit && vite build` — the typecheck is part of the
build, so a bundle that ships is a bundle that typechecks. `__BUILD_TIME__` is
replaced at build time and shown in Setup, so a stale tab is visible.

### 9.1 Shells, routes, pages

Two shells, chosen at build time by **`VITE_LAYOUT`**:

- **`kiosk`** (default) — the exhibit: one page, centred mark, a three-stop mode
  knob (Live / Simulation / Test), a language picker, a connection pill, Talk to
  Sara, and the waste dialog over the village page.
- **`sidebar`** (`VITE_LAYOUT=sidebar npm run build`) — the operator console the
  exhibit grew out of. Kept so going back is a build flag, not a revert.

Routes (both shells): `/` Our Village, `/waste` (kiosk: the village page plus
the `WasteDialog`; console: `SortWaste`), `/activity` What Happened, `/about`
About & Help, `/setup` Setup (Calibration, Voice & Camera, Connections,
Advanced), with redirects for old addresses (`/sensors`, `/settings`,
`/controls`, `/dashboard`). Everything not matched goes to `/`.

`src/pages/` holds the five pages (`OurVillage`, `SortWaste`, `WhatHappened`,
`AboutHelp`, `Setup`, plus `Login`); `src/components/` holds the kiosk chrome,
`WasteDialog`, `VoicePanel`, `SimPictures` (the SVG drawings that follow each
reading), `TestModeDialog` (bench panel), `Gate`, `LanguagePicker` and the small
controls (`Toggle`, `SimSlider`, `BinLeds`, `StreetLamps`).

### 9.2 Providers — the whole client state

Mounted in `App.tsx` in this order:

| provider | owns |
| --- | --- |
| `SessionProvider` (`lib/session.tsx`) | `checking/in/out/error`, username, `guest`; asks once, again on any 401 (`village:unauthorised`) |
| `Gate` (`components/Gate.tsx`) | the sign-in screen; **nothing of the village is mounted behind it** |
| `DemoProvider` (`lib/demo.tsx`) | mode `live|demo`, persisted in `localStorage.village.demoMode`; `?mode=demo` is a once-only instruction |
| `VillageProvider` (`lib/village.tsx`) | `/state` every 2 s; derives `connected`, `stale`, `live`, `demo`, `simulator` |
| `CommandsProvider` (`lib/commands.tsx`) | sends commands, keeps the last outcome, notices a stale frame |
| `VoiceUiProvider` (`lib/voiceUi.tsx`) | language, panel open, English voice choice; writes `<html lang>` |

`useApi(key, fetcher, {intervalMs, enabled})` (`lib/useApi.ts`) is the only data
hook: it refetches on a serialised key, polls only when asked, and never
replaces good data with a transient error.

### 9.3 The client/server boundary

`src/lib/api.ts` is the single HTTP client:

- **Base URL**: `''` (same origin) by default; `VITE_API_BASE_URL` at build
  time, or `?api=https://…` once at runtime (remembered in
  `localStorage.village.apiBase`, removed from the address).
- **Auth**: cookie by default; when the base is another origin it keeps the
  signed token from the login/share response in
  `localStorage.village.sessionToken` and sends `Authorization: Bearer`.
- **Mode**: every call that needs it appends `?mode=…` from `setApiMode()`.
- **401** dispatches `village:unauthorised`, which the session provider turns
  into the sign-in form.
- **No backend**: a 404, a network failure, a 502/503/504 or the Worker's
  `API_ORIGIN_MISSING` is read as *no backend*, and the SPA falls back to
  `lib/localVillage.ts` (a small in-browser village, always Simulation, never
  Live). That is what makes the Cloudflare-hosted copy usable without a server.

### 9.4 Language

`lib/lang.ts` holds `en`, `hi`, `ml`; `lib/messages.ts` holds **399** keys as
`'key': [en, hi, ml]`; `lib/translate.ts` resolves with English fallback and
`useT()` (`lib/i18n.ts`) binds it to the shared state. Whole sentences only —
never glued fragments — and numbers/units are never translated. Routing never
reads translated text (the waste guide returns message **keys**). One selector
sets both the interface and Sara's language. `messages.test.ts` fails the build
if a key lacks a language or the three disagree about a `{placeholder}`.

### 9.5 Look and motion

Charcoal/cream/gold theme, theme colours as CSS variables (`--bg`, `--fg`,
`--accent`, …), Inter for text and Playfair Display for headings, both local.
The five cards are one column of rows (`vcard--row`) that wrap on a phone.
`components/SimPictures.tsx` draws the solar panel, windmill, plant, tank,
streetlamp and bins, each following its own reading; motion is switched off
under `prefers-reduced-motion`, and the stylesheet is asserted by
`SimPictures.test.tsx`.

---

## 10. Running it

```bash
./scripts/setup.sh          # once: .venv, backend, classifier, node_modules
./scripts/download_models.sh# once: whisper ggml-base.bin (~142 MB)
./scripts/launch.sh         # build dist, start whisper, backend on :8010
./scripts/dev.sh            # uvicorn --reload + Vite on :5173 (proxies /api)
./scripts/stop.sh           # stops only what the scripts started (PID files)
./scripts/whisper.sh status # speech server health
```

`launch.sh` builds the SPA first (so the served bundle is the source you just
edited), starts whisper, runs `relay.sh ensure` for the board link, then
`uvicorn app.main:app --app-dir web/backend --port 8010`. `dev.sh` starts the
same backend with `--reload` and Vite, whose proxy forwards `/api`, `/models`
and `/audio` to :8010.

The app is at <http://127.0.0.1:8010/>. `launch.sh` prints the bind address it
used (this deployment binds `0.0.0.0`, so the LAN address works too).

---

## 11. Deployment

Two shapes, and the difference matters:

1. **The exhibit** — everything on one laptop, one origin, as above.
2. **A static copy** — `web/frontend` is a **Cloudflare Worker with static
   assets** (`worker.js`, `wrangler.jsonc`), not plain Pages. It serves
   `dist/` and proxies `/api/*` and `/models/*` to `VILLAGE_API_ORIGIN`. When
   that variable is unset it answers **503 `API_ORIGIN_MISSING`** — the normal
   state of a demo deployment, and the page treats it as "no backend" and runs
   `localVillage`.
3. A shared build can also be pointed at a backend at runtime (`?api=…`) and
   entered with `?share=<key>`; CORS and the bearer token exist for exactly that
   case.

`docs/deployment-cloudflare.md` has the commands and the environment variables.

---

## 12. Gates

```bash
./scripts/test_all.sh                       # everything
cd web/backend  && .venv/bin/python -m pytest -q tests
cd web/frontend && npm run typecheck && npx vitest run && npm run build
./scripts/test_firmware.sh                  # host checks, no board
```

Current counts on this tree: **195 backend tests**, **450 frontend tests in 33
files**, **560 firmware checks**, typecheck + build clean. The backend suite
uses `pytest-asyncio` (`asyncio_mode = "auto"`); the frontend uses jsdom with
`src/test/setup.ts` and `renderWithProviders`.

A change is not done until its behaviour is tested (backend route/unit or a
frontend component test), the three languages are updated if visitor-facing
copy moved, and `docs/help.md`-style operator docs are updated where a control
changed. `AGENTS.md` carries the current state and the conventions.

---

## 13. Limits and deliberate choices

- **One account, no roles.** This is an exhibit, not a multi-user product.
- **Polling, not sockets.** The page reads `/state` every 2 s; the gateway reads
  the board every 1 s. That keeps the server stateless and the demo copy simple;
  a WebSocket would be a different architecture.
- **SQLite, one file, one process.** WAL is on, but this is a single-writer
  design; a second backend on the same file is not supported.
- **Profiles are demo-only.** `demo_profiles` exists so the Simulation can show
  a named visitor; there is no live visitor database.
- **No machine translation.** The three languages are one hand-written table;
  adding a fourth means adding a column to every key and a Piper voice.
- **`/models` and `/audio` are public static mounts.** They are model weights
  and pre-recorded audio, not state; the API itself is gated.
- **The entry bundle trips Vite's 500 kB warning.** Measured on this tree:
  ~600 kB raw, ~175 kB gzip (one file, no route splitting). It is a build-time
  warning only, not a deployment failure; splitting would be a change of
  architecture (the kiosk opens one page).

---

## 14. Invariants — do not break these

1. **The device token never reaches the browser.** Only `device.py` holds it.
2. **An ack is the only proof.** Never render a pin state from what was sent.
3. **Demo can never reach hardware**, and Live can never silently become the
   simulator. `mode` is one selection (`live|demo`), enforced by the gateway.
4. **A command id is idempotent**; a retry reuses it, a different body under the
   same id is 409.
5. **Config writes carry the revision read**; a conflict is shown, not retried.
6. **The SPA shell is `no-store`; hashed assets are immutable.** A cached shell
   would serve yesterday's bundle after a rebuild.
7. **The share link is a look, not a hand**: guest writes are allow-listed, and
   `mode: "live"` from a guest is refused by the backend.
8. **One language selector** drives both the page and Sara; messages are
   complete in en/hi/ml or the build fails.
9. **No secrets in the bundle.** Model files are static, credentials stay in
   the backend; a hosted build carries no `VILLAGE_*` value.
10. **A missing backend is not an error screen.** The SPA falls back to the
    in-browser village and says so.

---

## 15. File map and where to change things

| task | files |
| --- | --- |
| a new API route | `web/backend/app/main.py` (+ a model in `protocol.py`), then `web/frontend/src/lib/api.ts` and `types.ts` |
| a new device command | `protocol.py` `ALLOWED_COMMANDS`, `main.py` validation, firmware command, `docs/help.md`-style docs |
| a new page | `src/pages/*`, a route in `App.tsx`, `lib/pages.ts` metadata |
| visitor copy | `src/lib/messages.ts` — all three languages, same placeholders |
| the waste rules | `src/lib/wasteDecision.ts` (+ tests) — see `docs/waste-approach.md` |
| speech | `web/backend/app/{voice,ml_asr,tts}.py` — see `docs/voice-languages.md` |
| the board link | `web/backend/app/device.py` — see `docs/esp32-and-wifi.md` |
| theme / cards | `src/styles.css`, `src/components/SimPictures.tsx` |
| build/deploy | `vite.config.ts`, `worker.js`, `wrangler.jsonc`, `docs/deployment-cloudflare.md` |

```bash
curl -s http://127.0.0.1:8010/api/v1/system/health     # public
# signed-in calls need the cookie, e.g. from the login route:
curl -s -c /tmp/c -H 'Content-Type: application/json' \
  -d '{"username":"…","password":"…"}' http://127.0.0.1:8010/api/v1/auth/login
curl -s -b /tmp/c 'http://127.0.0.1:8010/api/v1/state?mode=demo'
```
