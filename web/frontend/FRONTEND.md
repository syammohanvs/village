# Smart Green Village — frontend

React + TypeScript + Vite dashboard for the local FastAPI backend. No CSS
framework, no icon package, no remote fonts, no CDN, no paid service.

## Run

```bash
cd web/frontend
npm ci                             # .npmrc sets legacy-peer-deps for Teachable Machine
npm run dev                        # http://127.0.0.1:5173
```

Vite proxies `/api`, `/models` and `/audio` to `http://127.0.0.1:8010` (the
FastAPI backend). Start the backend first; the dashboard never invents data.

```bash
npm run typecheck                  # tsc --noEmit
npm test                           # vitest run
npm run build                      # tsc --noEmit && vite build  -> dist/
npm run preview                    # serve dist/
```

`@teachablemachine/image@0.8.5` still declares a peer of `@tensorflow/tfjs@1.3.1`;
the pinned `4.22.0` runtime works. The committed `.npmrc` sets
`legacy-peer-deps=true`, so `npm ci` works without an extra flag.

## Pages

| Route | Page | Notes |
| --- | --- | --- |
| `/` | Dashboard | live reason panel, four KPI cards, bins, connection, AI readiness, recent controller events, manual controls, demo scenarios |
| `/sensors` | Sensors & calibration | raw/calibrated values, soil two-point calibration, reservoir thresholds, bin distances, LDR thresholds, save with `config_revision` |
| `/controls` | Controls | irrigation auto toggle, pump commissioning gate, light modes, waste indicator tests, emergency stop, command log |
| `/waste` | Waste camera | model status, camera device picker, code-split Teachable Machine, top-3 predictions ranked by confidence (Background included), stabiliser, one accepted item per camera session (auto-stop), recognition record, separate deposit confirmation |
| `/activity` | Activity | live/demo events, kind filters, client-side CSV, retention note |
| `/settings` | Settings | device URL/mode, `/device/health` test, app preferences with draft/validation, setup checklist, first-run order |
| `/villagers` | Villagers | clearly fictional sample profiles; 3/2/1 points for organic/plastic/paper; no consumption or savings metrics |

## Honest-data rules implemented

- Reservoir: **Available / Low / Unknown / Not calibrated** only. No percent,
  litres or capacity is displayed anywhere.
- Soil percent is labelled a calibrated relative reading.
- Bin fill is labelled an estimated height. A missing echo renders
  **Unavailable**, never `0%`.
- No battery, generation, savings or consumption figures exist. The solar
  panels, windmill and buildings are marked **static display — not
  instrumented**.
- An acknowledgement is labelled as the controller’s decision, not proof that
  water flowed or an LED lit.
- The camera does not prove disposal: **Confirm deposited** is a separate
  record and action.

## State sources

- `src/lib/village.tsx` polls `GET /api/v1/state?mode=...` every 2 s and exposes
  the connection envelope. Stale/disconnected frames are greyed out and labelled;
  Stop stays visible but changes to “Stop (not confirmed)”.
- `src/lib/api.ts` is the only network layer. `ApiError` carries
  `status`, `code`, `message` and `confirmed`. The active mode is module state so
  every state/config/recognition/command call carries `mode=demo` when demo is on.
- `src/lib/commands.tsx` sends one `request_id` per press and records the
  confirmed / rejected / duplicate / unconfirmed outcome and reason.

## Voice

`src/lib/audio.ts` records with `MediaRecorder` (echo cancellation on), decodes
with Web Audio and re-encodes **16 kHz mono 16-bit WAV** before posting multipart
`audio` + `language` to `/api/v1/voice/transcribe`. The floating panel is
available on every page and from the header microphone.

- Only `LIGHTS_ON`, `LIGHTS_OFF`, `LIGHTS_AUTO`, `IRRIGATION_REQUEST` and
  `IRRIGATION_STOP` are sent, with `source: "voice"`.
- `UNKNOWN`, `NEGATED`, `AMBIGUOUS`, `NO_SPEECH` and status intents send **no**
  command and show the backend message.
- Replies prefer `/audio/<lang>/<intent>.wav` and fall back to
  `speechSynthesis`; the push-to-talk button is disabled while speaking.

## Tests

`src/lib/wasteStabilizer.test.ts`, `src/pages/Dashboard.test.tsx`,
`src/components/VoicePanel.test.tsx`, `src/pages/Waste.test.tsx`,
`src/pages/Settings.test.tsx` — 15 tests.

Mocks: `src/lib/api` in page tests; `MediaRecorder`, `getUserMedia`,
`HTMLMediaElement.play/pause`, `speechSynthesis` in `src/test/setup.ts`; the
voice tests also replace `src/lib/audio` and `src/lib/speech`.

## Deferred / needs the hardware or models

- A real ESP32 and a running whisper.cpp server. The waste model **is**
  installed (`models/waste/`, trained locally with `scripts/waste/`); without
  any of these the UI shows the exact missing-model / missing-service messages
  and records nothing.
- Prepared TTS WAV files in `public/audio/<lang>/<intent>.wav` are optional;
  browser speech synthesis is the fallback.
- The Villagers page is explicitly fictional sample data; the backend
  `/profiles` route is optional.
- Live camera recognition: jsdom has no camera, so the component test stubs
  `getUserMedia` and the classifier. The full path was driven in Chromium with
  a fake camera against a simulator backend (Plastic, Organic, Paper and a
  background frame) — see `docs/verification.md`. A physical camera at the
  venue is still worth checking, and retraining with venue photos is described
  in `docs/waste-model.md`.
