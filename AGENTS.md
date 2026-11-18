# AGENTS.md — working notes for this repository

> **This repository is the master copy — commit and push normally.** The user
> changed this on 2026-11-17: *"commit everything including secrets.h in github.
> If laptop has a problem I should simply be able to use another laptop and run
> the app as is."* So the code, the models, the settings and the secrets are all
> committed and pushed to `origin/main` (`git@github.com:syammohanvs/village.git`,
> **private**). Do not publish it, and do not paste its credentials anywhere
> public. **Pushing still triggers a Cloudflare Pages build** of the dashboard —
> that is a deploy of `web/dist` only and contains no token (verified: the built
> bundle carries no `VILLAGE_*` value), so it is a side effect to be aware of,
> not a reason to hold commits back. Earlier history: the user preferred local
> commits (2026-11-12) for exactly that reason.

Smart Green Village: ESP32 firmware (`uc/`), FastAPI backend
(`web/backend/`), React/Vite dashboard (`web/frontend/`), Whisper voice and a
local waste classifier. Keep the app running at <http://127.0.0.1:8010/>.

## A new machine: clone and run (2026-11-17)

The repository is a **complete copy of the working exhibit** — code, firmware,
Sara's four voices, both waste models, the village database and the credentials —
so a fresh session on another laptop is four commands, not a rebuild. This is the
runbook; do not invent a different one.

**1. Check the machine.** WSL/Ubuntu as on the original: `git`, `python3` ≥ 3.11
with **`python3-venv`**, Node ≥ 22, `rsync`, `curl`.

```bash
sudo apt install python3-venv python3-pip rsync curl
```

`python3 -m venv` failing with *"ensurepip is not available"* is exactly the
missing `python3-venv`; `setup.sh` names it and stops rather than half-installing.

**2. Clone** — `git@github.com:syammohanvs/village.git`, **private**, so the key
must have access. It is ~600 MB, so expect a wait:

```bash
git clone git@github.com:syammohanvs/village.git
cd village
```

**3. Install what git cannot hold** (once per machine):

```bash
./scripts/setup.sh             # .venv, backend, classifier, node_modules
./scripts/download_models.sh   # whisper ggml-base.bin (~142 MB)
```

`setup.sh` installs three requirement files: the API (`requirements.txt`), the
**classifier** (`requirements-waste.txt` — `torch` is ~200 MB the first time, and
without it the app starts and cannot sort waste), and the test tools. It creates
the Python environment in `.venv` beside the checkout when `.env` names one that
does not exist on this machine — `scripts/venv.sh` is the single rule, shared by
`setup.sh`, `launch.sh`, `dev.sh` and `test_all.sh`.

**4. Run**:

```bash
./scripts/launch.sh            # build web/dist, start whisper, backend on :8010
```

**5. Verify — do not assume.** Three checks that fail loudly when something is
missing:

```bash
curl -s http://127.0.0.1:8010/api/v1/system/health | python3 -m json.tool
```

- `status: ok` **and `voice.ready: true`**. A `false` with
  `server_reachable: true` is the whisper binary without its model — step 3.
- Sign in at :8010 with **`mahi$haru` / `village`** (this exhibit's account,
  set in `.env`; a fresh clone of the repository carries the name) and open
  **Talk to Sara**: she should speak, and
  `/api/v1/voice/readiness` reports `Piper is ready for en, hi, ml` with
  `english_voices: [sara, indian]`.
- **Sort waste** with a real item, or `POST /api/v1/waste/classify` with a photo
  from `data/waste-samples/` — a clear plastic item answers `Plastic ≈ 0.92`.

Measured 2026-11-17 by cloning into a clean directory and starting it on **:8099**
(so the original kept :8010): health ok, sign-in from the committed database, a
143 KB RIFF from `/voice/speak`, and the classifier
answering `Plastic 0.924`. That is the standard this setup is held to.

**6. What is per-machine, and repairs itself**

- `.env` carries this laptop's paths. `VILLAGE_VENV` falls back to `.venv` as
  above; `VILLAGE_DEVICE_URL` is the relay on the **Windows host**, whose WSL
  address changes every boot — `./scripts/relay.sh ensure` (called by both start
  scripts) rewrites it, and `./scripts/relay.sh status` says whether the board is
  reachable (hotspot on, relay running, board's lease).
- The board needs the **Windows Mobile Hotspot** on; its Wi-Fi credentials are in
  `uc/include/village/secrets.h` (committed). Moving laptops reflashes nothing —
  the board keeps its own NVS calibration.
- `web/dist` and `node_modules` are deliberately not in git: `launch.sh` builds
  the first, `setup.sh` installs the second.

**7. If it does not start**, in this order: `./scripts/stop.sh` then `launch.sh`
(a stale pid holds the port), `data/logs/backend.log` for the traceback,
`./scripts/whisper.sh status` for the speech server. Never `rm -rf data/` —
`data/village.db` is the village's own state, and it is the point of this repo.

**8. Pushing** works from the new machine with the same key (see the banner at the
top). Settings, accounts and voice choices travel with the repository, so a new
laptop speaks, sorts and signs in exactly as the old one did.

## Daily commands

```bash
./scripts/launch.sh        # build web/dist, start whisper + backend on :8010
./scripts/dev.sh           # the same, with Vite and uvicorn --reload (it starts
                           # whisper too — it used not to, so voice had no speech
                           # server at all; fixed 2026-11-17)
./scripts/whisper.sh       # start|status|stop the local whisper.cpp server
./scripts/stop.sh          # stop only what the start scripts started
./scripts/test_all.sh      # firmware host tests + backend + frontend
```

Individual gates:

```bash
./scripts/test_firmware.sh
cd web/backend && /home/ubuntu/.venvs/aivillage/bin/python -m pytest -q tests
cd web/frontend && npm run typecheck && npx vitest run && npm run build
```

The current tree passes **499 firmware checks**, **137 backend tests** and
**425 frontend tests**. Always rebuild `web/dist` after frontend edits; the
backend serves it from disk.

## Signing in (the dashboard gate, 2026-11-17)

One account in front of every screen, so a laptop left open in a room of
visitors cannot be used to press **Water** or change calibration.

- **`mahi$haru` / `village`** on this exhibit (asked for 2026-11-18; a fresh
  install defaults to `admin` / `village`). Set in `.env` as
  `VILLAGE_ADMIN_USER`, `VILLAGE_ADMIN_PASSWORD` (or
  `VILLAGE_ADMIN_PASSWORD_HASH`, a `pbkdf2$…` value — it is used as given,
  never re-hashed), and `VILLAGE_SESSION_HOURS` (12).  **A name containing `$`
  must be single-quoted in `.env`** (`VILLAGE_ADMIN_USER='mahi$haru'`): both
  `set -a; . ./.env` and `python-dotenv` would otherwise read `$haru` as a
  variable and the account would arrive as `mahi` — the two readers were
  checked after the change, and the running server logs the name it uses.
  The login form's `username` comes from that setting, so nothing else had to
  change.  `VILLAGE_AUTH_ENABLED=false` switches the gate off for a bench
  session; the start-up log warns that every screen is open, and it also warns
  while the built-in default password is still in use.
- Backend: `web/backend/app/auth.py` — PBKDF2-HMAC-SHA256 with a salt, and a
  session cookie `username|expiry|HMAC` signed with a key derived from the
  stored hash, so changing the password invalidates every cookie and a restart
  does not.  `HttpOnly`, `SameSite=Lax`.  The middleware in `main.py` gates
  `/api/v1` except `/auth/login`, `/auth/session` and `/system/health`; the SPA
  shell must stay public or the form could never be shown.  Five wrong tries
  from one address pause the form for a minute.
- Frontend: `lib/session.tsx` (asks once, and again on any 401 — `api.ts`
  raises `village:unauthorised`), `components/Gate.tsx` (checking → form /
  dashboard / "did not answer, try again"; **nothing of the village is mounted
  behind the form**), `pages/Login.tsx`, and Sign out at the foot of the side
  menu under the source line.
- **Tests that render `<App />` must wait past the gate.** It adds one round
  trip, so `render()` no longer returns a populated page: `OurVillage.test.tsx`
  uses `renderReady()` (waits until neither "Checking the session" nor
  "Waiting for the first frame" is on screen).  An assertion made before that
  passes or fails by timing — which is exactly how the first version of this
  work went red.

## The share link — a visitor without a password (2026-11-18)

Students were to be shown the exhibit from their own machines, and the Cloudflare
Pages build has no backend (it serves `web/dist` only), so a shared build talks to
a backend that is not on its own origin. Two halves, and the second is what makes
sharing safe for the *village*, not for the account:

- **Where the API lives** (`web/frontend/src/lib/api.ts`). `API_BASE` is `''` by
  default — the exhibit's normal case, one laptop one port. A shared build is
  aimed elsewhere by `VITE_API_BASE_URL` (baked in at build time, set in the
  Pages environment) or once at runtime with `?api=https://…`, which is
  remembered in `localStorage.village.apiBase` and taken out of the address.
  **A hosted page is a different origin, and there the session is a bearer
  token, not a cookie**: browsers refuse a third-party cookie, so `/auth/login`
  and `POST /auth/magic` return the same signed token the cookie carries, the
  page keeps it in `localStorage.village.sessionToken`, and `request()` sends
  `Authorization: Bearer`. `session_token(request)` in `main.py` reads either.
  **`?share=<key>`** is the hosted copy's visit link: `takePendingShareKey()` in
  `lib/session.tsx` exchanges it in one request (before asking who it is, so the
  page never flashes the sign-in form) and puts the page in Simulation.
  CORS: `connect` goes from `https://*.pages.dev` by default (a `*` entry is an
  origin *pattern* via `allow_origin_regex`), exact origins from
  **`VILLAGE_CORS_ORIGINS`**. The CORS middleware is registered **last** so it
  is outermost — a preflight must be answered before the session check, and a
  401 must carry the CORS headers or the browser says "failed to fetch" instead
  of "sign in". The cookie's `SameSite`/`Secure` is decided from the **request's
  own scheme**, not from the CORS list: an https origin in that list must not
  turn the local http cookie into a `Secure` one the browser drops.
- **The link itself** (`GET /api/v1/auth/magic?key=…`, public because it is the
  thing that issues the cookie). It sets a **guest** session and 303s to
  `/?mode=demo`, which `lib/demo.tsx` reads once and strips, so the first
  screen is Simulation even on a fresh browser. The key is
  The key is **stored, not derived**, in the `settings` table
  (`Database.share_key`, 32 hex chars) — and the reason is measured: with a
  plain-text `VILLAGE_ADMIN_PASSWORD` the stored hash is re-salted on every
  start, so a key derived from it would 403 tomorrow for no visible reason.
  Stored, it survives a restart *and* travels with `village.db` to another
  laptop. `get_settings` takes it back out, so it is not a setting a client can
  read. `GET /api/v1/auth/share-link` returns the link for **Setup → A link for
  students** (behind the account: handing out a session is the operator's
  call), with Copy and **New link** — the latter is `POST` on the same route,
  asks first, and really retires the old key (tested by opening both).
  `VILLAGE_SHARE_LINK=0` removes the route (404) and the card says so.
  **Served from the hosted copy, the card offers a different link**:
  `shareLinkFor()` (`lib/shareLink.ts`) composes
  `https://<site>/?api=<backend>&share=<key>`, because the direct link would
  leave the hosted site and its cookie would be refused. Same key, same guest.
- **A guest is not the account, in three layers, and each was tested:**
  1. `KioskLayout` draws **Live and Test disabled** with the reason
     (`mode.guestOnly`) and `choose()` ignores them; `GuestUsesSimulation` in
     `App.tsx` forces `demo` even when the browser remembered `live`.
  2. `POST /commands` refuses `mode: "live"` from the guest cookie with a 403
     naming Simulation. A page is not the place to enforce this.
  3. The middleware's `GUEST_POST_PATHS` allowlist: reads are fine, writes only
     for the visitor page (commands, `/demo/*`, `/simulator/scenario`, the waste
     classifier, Sara, sign-out). Calibration, settings, device config,
     profiles, waste corrections and the bench panel are readable but never
     writable. `tests/test_auth.py` drives all three: a demo command 200, a live
     command 403, and five operator writes 403.
- **`?mode=demo` is a once-only instruction**, not a permanent one: it is
  removed from the address by `readStoredMode`, because a URL that keeps forcing
  Simulation would make the mode knob look broken on every visit.
- **A copy with no backend at all runs the village itself** (`2026-11-18`,
  `lib/localVillage.ts` + `lib/demoState.ts`). Cloudflare Pages serves the SPA
  and nothing else, so `/api/v1/auth/session` there is a 404 page — and the
  first version of this showed "The village service did not answer", i.e. a
  broken exhibit. `api.session()` now treats **a 404, a network failure, or an
  answer that is not a session** as *no backend*, and switches to the built-in
  village: a small simulation that dries the soil, runs a pulse, drains the
  tank, follows the daylight, lights a bin and answers the commands. It is
  **never Live** — every frame is `demo`, `physical: false`,
  `source.kind: 'demo'`, the mode switch is locked to Simulation with the
  reason `mode.demoCopy`, and the note under the knob says the copy has no
  village service. The exhibit laptop always has its backend, so nothing here
  changes what it does; a page that lands in the demo can get out of it by
  reloading once the backend answers. Measured with `chromium --dump-dom`
  against `python3 -m http.server` over `web/dist`: cards drawn (soil 34 %,
  Rain Water Tank, Streetlights), note present, no sign-in form.
  **The models are the part that is honestly missing there**: `voiceReadiness`
  answers not-ready (the microphone stays off), `waste/model-status` says not
  installed, and `voice/*` and `waste/classify` answer "this demo copy does not
  provide that" — which is what the hosted copy is for.
  **The deployed thing is a Worker, not Pages** (`web/frontend/worker.js` +
  `wrangler.jsonc`, `docs/deployment-cloudflare.md`): it proxies `/api/*` to
  `VILLAGE_API_ORIGIN` and answers **503 `API_ORIGIN_MISSING`** when that is
  unset — which is the *normal* state for a demo deployment. So the session
  check treats **502/503/504 and that code** as "no backend" too; without it
  the page sat on the sign-in error card with the gateway's refusal underneath.
  Measured against a static server that answers 503 JSON on `/api/*` (the
  Worker's exact behaviour) with `chromium --dump-dom`: cards drawn, note
  present, no sign-in form.

## Voice (whisper + Sara)

- The speech server is started by `scripts/whisper.sh` (`start|status|stop`),
  called by both `launch.sh` and `dev.sh`. `dev.sh` used not to start it at all,
  which is why the microphone was disabled with "Whisper server is not
  reachable" in a dev session (2026-11-17).
- Model choice and its measured behaviour are in `docs/operation.md` § "The
  speech server and the model". English is good on `ggml-base.bin`; Malayalam
  and Hindi recognition is weak on every model that fits this CPU's speed
  budget.
- **Malayalam must be decoded with NO prompt (2026-11-18).**  `voice.py` primes
  the decoder with a short phrase in the language, because for **Hindi** that
  settles the script ("Light Bandkaru." → "… करो" in Devanagari, 2026-11-17).
  The file used to carry a Malayalam prompt too and called it "unaffected"; it
  is not, it **hurts**.  Whisper names Malayalam with the *Devanagari* token, so
  a Malayalam prompt pulls the decoder toward the wrong tokens.  Measured on the
  same three clips, with the prompt vs without:
  `வியலகுகள் கட்டிக்குங்கள்` (Persian yeh) → `விலக்குகள் காட்டிக்குக்கா`,
  `മണ്ണിൽ എത്താൻ…` → `மண்ணில் எத்தாக இருப்போமும் இரு`, and a bare
  `യ്മയ്ക്കുക.` → `தாங்கில வெள்ளம்ணு`.  Without it all three parse
  (LIGHTS_ON / SOIL_STATUS / WATER_STATUS) through the real
  `/voice/transcribe` route.  `test_the_decoder_is_primed_with_the_language_it_
  should_expect` now asserts **no** prompt for `ml`.
- **Malayalam is read by its own model, and the language really is forced
  (2026-11-18).**  The user asked whether we set the language code instead of
  letting Whisper auto-detect.  We do: `request_fields` always sends
  `language=<code>`, proven against the server — the same clip with
  `language=en` answers "Vila Google Cut Tikuga", and `lang=ml` (the wrong field
  name) is ignored and falls back to auto-detection.  **The language was never
  the problem; the model was.**  `ggml-base` hears Malayalam and writes it in
  Tamil/Arabic letters, so `kavyamanohar/whisper-small-malayalam` (a whisper-small
  fine-tune, `models/whisper/ml-asr/`, ~950 MB, fetched by
  `scripts/download_models.sh`, git-ignored) now answers Malayalam in
  `web/backend/app/ml_asr.py`.  Measured through the real
  `/voice/transcribe` route on six catalogue sentences: **base 2/6**, whisper
  `small` 3/6 and up to 24 s, the fine-tune **6/6 at 2.5–2.9 s**.  It is used
  only for `ml`; English and Hindi stay on whisper.cpp, and **any failure falls
  back** to whisper-server — a missing model must never stop the exhibit
  listening.  `tests/test_ml_asr.py` pins availability, the language routing and
  the fallback (the model itself is never loaded in a test).
  Two parser changes came with it: a Malayalam **second pass by sound** when the
  exact-word pass finds nothing (the model writes "വിലക്കുകൾ" for "വിളക്കുകൾ"),
  and `roman_aliases` no longer treats a **verb** spelling as a state — the word
  "ചെയ്യുക" ("to do") is inside the "ഓൺ ചെയ്യുക"/"ഓഫ് ചെയ്യുക" aliases and made
  one sentence three states at once.  **`no_repeat_ngram_size` corrupts this
  model's output** (replacement characters) — do not add it back.
- **"Pump auto" in Malayalam — what it took (2026-11-18).**  Reported as the
  one phrase that would not work, and the app's own event log had the literal
  transcripts: `പംമ് അട്ടോ`, `പംഭ് അട്ടോ`, `പമ്പ് ഹോണാക്കുകാ`.  Three separate
  faults, each measured:
  1. **The anusvara (ം) was always romanised `n`**, so `പംഭ്` — the same word as
     `പമ്പ്`, "pamp" — became `pnb` and matched nothing.  It now takes the nasal
     of the *following* consonant's class (m before a labial), and a consonant
     before a sign keeps its inherent vowel (`പംമ്` is `pamm`, not `pmm`).
  2. **The pump cue claimed the sentence first.**  `പമ്പ്` is the watering cue as
     well as the pump's name, so a state the word matcher could not read became
     "start watering" before the sound pass ran.  The **by-sound pass now runs
     before the cue** whenever no state word was matched structurally, and it
     applies the same rule inside itself (`auto` outranks the cue).
  3. **A short word had to tolerate one letter.**  The model writes auto as
     `അട്ടോ` / `ഓെട്ടോ` / `ഓത്റോ` / `ഓത്`; `same_word` now allows one edit for
     words of **2–4 letters**, but only when **the consonants are equal or one
     extends the other** — without that check the question word `ആണോ` ("ano")
     matched "auto" and every short word became a question, and without the
     length limit "on" and "off" meet.  Both guards are pinned in
     `test_a_short_word_tolerates_one_letter_but_never_a_different_consonant`.
  After: four TTS recordings of "pump auto" (three phrasings) all answer
  PUMP_AUTO through the real route.  *(The merged `പോട്ടു` this paragraph used
  to call un-chased is read as the mode now — see the next bullet — but only
  when the sentence also names the pump.)*
- **The model writes "automatic" in pieces, and the pieces were refused
  (2026-11-18).**  The event log had six recordings of *pump auto* that all came
  back UNKNOWN or AMBIGUOUS: `പമ്പ് ഓട്ടോ മാടിക്` (two words — the second was
  unaccounted, so the whole sentence was refused), `പമ്പ് ഓട്ടുമാറ്റിക്` and
  `പമ്പു ഓെട്ടുമാട്ടിക്` (one word, and no alias), and `പമ്പ് പോട്ടു`, where
  the pump's last consonant has bled into the state.  Three fixes, each narrow
  enough to say why:
  1. **the spellings** — `മാടിക്` / `മാടിക്ക്` / `ഓട്ടുമാറ്റിക്` /
     `ഓെട്ടുമാട്ടിക്` / `അട്ടോ` join `states.auto` (`shared/intents.json`), so
     the second half of "auto-matic" is the same mode rather than an extra noun;
  2. **`പോട്ടു` is the mode only after a pump word** (`_romanised_intent`): a
     word that ends in the *sound* of "auto" (`fold(word)` ends `otu`/`oto`) is
     read as `auto` when the sentence also names the pump, and nowhere else —
     `പോട്ടു.` on its own is still refused.  This is the merged case the earlier
     note called un-chased; it is chased now, with that guard;
  3. **one edit after a shared start** (`same_word`): `കത്യകുകാ` ("katyakuka")
     and `കത്തിക്കുക` ("kathikkuka") are one vowel apart, and the command was
     lost.  The rule allows one edit when the two words are at least five long
     **and their first three letters are equal** — which is exactly the guard
     that keeps "anakuka" (turn off) and "nanakuka" (water) apart, the pair
     whose confusion once started the pump on a request to put a lamp out.
  Alongside them, from the same log: the pump with a case ending (`പംമ്പേ`) and
  its misspellings (`പമ്വ്`, `പംപ്പ്`, `പംഭ്`); "soil" in the genitive with the
  model's own word for moisture (`മണ്നിന്റെ ഏർപ്പം`); "switch on" said as one
  word (`ഓണാക്കുക` / `ഹോണാക്കുകാ`, the standard `ഓൺ ആക്കുക` run together); and
  the verb ending `ചെയുകാ` beside `ചെയുക`.  Every one is pinned by a test that
  quotes the transcript verbatim (`test_the_latest_unrecognised_recordings_are_
  understood`, `test_automatic_is_one_mode_however_the_model_splits_it`,
  `test_one_wrong_vowel_is_read_only_where_the_word_starts_the_same`), and all
  eight answer correctly through the real `POST /voice/interpret` route.
  **Still not chased:** `പംപ്പോട്ടു` with no pump word at all (the pump's name
  and the mode fused), and Arabic/Tamil-script soup the model produces from
  near-silence, which the script guard is meant to refuse.
- **"Pump off" had two faults of its own (2026-11-18, `പമ്പ് അഫ്`).**  First,
  the sound path drops verb spellings so `ചെയ്യുക` cannot be read as a state —
  but `ഓഫ്` is *also* listed as a verb ("ഓഫ് ചെയ്യുക"), so `off` was dropped
  entirely and the model's `അഫ്` had nothing to match.  Now only a
  **single-word** state alias rescues a verb (`ഓൺ`, `ഓഫ്`); the verb half of a
  two-word alias stays dropped.  Second, once a state *was* read, the pump cue
  overwrote it (`unique_states = {watering}`), so "pump off" started the pump:
  the cue now fills in only when the sentence names no state.  Pinned by
  `test_pump_off_is_not_swallowed_by_the_pump_cue`, including the four ways
  the model writes `off` and the cue's own start-request.
- **"Turn the pump on" was answered with advice about Auto (2026-11-18,
  reported).**  The sequence was *pump on* (switch On) → *stop the pump* (which
  by rule **releases the switch to Off**) → *pump on* again, and the controller
  refuses a watering request while the switch is not Auto, in an operator's
  words: "Set it back to Auto to water by the rules".  Two decisions:
  - **the refusal is correct, the sentence was not.**  A visitor who asked to
    turn the pump *on* needs On named as well — `panel.pumpOffNoWater`
    ("The pump is switched off by hand, so it will not water. Set the switch to
    On or Auto on the Watering card."), used from a **fresh** frame without
    sending a request a refusal would only repeat, and `reason.
    PUMP_MANUAL_ACTIVE` carries the same three sentences for the stale-frame
    path where the controller answers.
  - **it deliberately does not send `PUMP_ON` for you.**  The switch is the
    operator's, and this board has **no tank probe fitted**, so a manual On
    runs the pump with the tank unknown — a voice command must not do that on
    its own.  The card's On switch is one press away, and a manual On is still
    stopped by a tank the controller *knows* is low.

- **Hindi "लाइट चालू" was refused as a *foreign* utterance, and four faults
  were behind it (2026-11-18, reported as "it told me it didn't understand").**
  The log had `बालाइट चालू.` — the model's own rendering of "लाइट चालू":
  1. **The romaniser dropped a word's final vowel at a space.** `ലാഇട` gave
     "laita" on its own and "lait" inside a sentence (a space is ASCII, and the
     ASCII branch cleared the pending consonant instead of flushing it), so a
     word never matched the alias it had just failed to equal.  A space now ends
     the word the way end-of-string did.
  2. **A word-final "a" never separates two renderings** (`same_word`): Hindi
     drops the schwa, the romaniser writes it in one position and not another.
  3. **A device name tolerates a syllable in front of it** (`same_word(...,
     allow_suffix=True)`, devices only — states never): "palaita" ↔ "laita".
     This is what made `बालाइट` find the lights.
  4. **A guard phrase is matched as the phrase it is, never by its parts.** The
     Hindi corrections list holds "चालू मत" ("do not turn on"), and splitting it
     handed the word `चालू` — the word for ON — to the correction check, so
     **every** Hindi sentence containing "चालू" was refused before a device was
     read.  `guard_aliases` keeps a multi-word guard whole.
  Two related repairs came with it, both about not guessing:
  **the pump cue is a request only through a start word or the cue *phrase*** —
  a bare pump word is not enough, or a sentence whose state could not be read
  would start the pump (a Hindi "पंप बंद" heard while Malayalam is chosen now
  refuses instead); and **a catalogue phrase answers when the structural
  device has no such action** — "വെള്ളം നിർത്തുക" (stop the water) reads as
  device *water* + state *stop*, and water has no stop, so a listed phrase was
  being refused.  `பம்ப் ஆஃப்` (Tamil, "pump off") now answers **IRRIGATION_STOP**
  rather than THING-unknown — the test that guarded the direction was updated
  to assert STOP and still never REQUEST.
  **Still not chased:** `अट चालू` (the model lost most of "लाइट" — nothing left
  to match), and the same weak-Hindi caveat the speech-model notes already
  carry.

- **A transcript in a sister script is understood** (`web/backend/app/
  phonetics.py`): Tamil letters are shifted into the Malayalam block (a fixed
  Unicode offset) and romanised, so `വിളക്കുകൾ അണയ്ക്കുക` and
  `விலக்குகள் ஆனக்குக்கா` meet on `vilakkukal anakkuka`. `_romanised_intent` in
  `intents.py` uses that only when the script is not the chosen language's, and
  only for exactly one device + one state with no refusal word — do not widen it
  to fuzzy edit distance, which was measured turning "turn off" into "water".
- **There is no pump commissioning gate any more (2026-11-17).** The hardware is
  finished; the `VILLAGE_PUMP_COMMISSIONED` build flag is deleted and the reason
  codes are `*_PUMP_DISABLED`. The pump has the same **Auto / On / Off** switch
  as the lights: Auto is every rule, and On/Off are the operator's, watched only
  by the tank (`PUMP_ON` / `PUMP_OFF` / `PUMP_AUTO`, status `actuators.pump.mode`).
  The card carries that switch and nothing else: Water/Stop were removed
  (2026-11-17) because On/Off say the same thing.  A manual **On** is stopped
  only by a tank the controller *knows* is low — a missing or uncalibrated probe
  does not refuse it (this board has no tank probe fitted), and
  `actuators.pump.pin_high` answers "is D19 actually high” from the app.  A spoken "stop the pump"
  (IRRIGATION_STOP) also releases a manual **On** — answering "stopped" while
  the switch holds the pump running is the one answer it must never give.
  The card shows the switch only: the sentence under it and the "tank reading is
  unavailable" line were removed the same day (the Rain Water Tank card already
  says **Not calibrated**, and a line repeated on every visit is furniture).
- **Our Village is one column of rows (2026-11-17).** All six cards — Watering,
  Rain Water Tank, Lights, Waste, Solar, Wind — use `vcard--row` inside
  `village-rows`: name and chip left, reading next, control last.  Below 900 px
  each row wraps back to a column.  The name column is `min-width: 320px` with a
  `nowrap` title — a fixed 300 px squeezed "Rain Water Tank" onto two lines as
  soon as its chip read "Status unknown".  The tank card is titled **Rain Water
  Tank**, not "Tank", and `docs/operation.md` + the About page + Sara's topics
  say the same.  The Watering row answers two questions and now says so: the
  chip is the *session* (`Watering` / `Idle`) and the line beside it is the
  soil's own reading, prefixed with **Soil:** — unprefixed, "Idle · Not
  calibrated" read as one confused state.  `soilPercent` already carries its
  `%`, so appending another printed `Dry · 28%%` on any calibrated probe.
- **Every card carries a drawing, and each one follows its own reading
  (2026-11-18).**  Asked for after the solar panel and windmill: the other four
  cards got the same treatment in `components/SimPictures.tsx` — a **potted
  plant** (`Plant`: leaves lift and the soil darkens as moisture rises, and water
  falls **only while the pump is actually running**), the **rain water tank**
  (`RainTank`: one of the two levels its two wires can report, never a
  percentage, and dashed and empty when the probe cannot be read), the
  **streetlight** (`StreetLamp`: the lamp glows when `commanded` is true) and the
  **three bins** (`WasteBins`: only the category the camera last named is lit).
  The pictures are rendered in **Live and Simulation alike** — Live follows the
  controller's value, Simulation the slider's, exactly as the solar and wind
  ones do — and the lab's own controls keep their `sim-*` test ids, because
  those mean "simulation only" and the pictures are not lab controls.
  **The waste picture also draws the camera**, because the camera is what does
  the classifying — the bins only report the answer it gave.
  **The rule they all obey: a picture may not claim hardware the board does not
  have** (the windmill stands still when no turbine is wired; the tank never
  shows a percentage), and its accessible name comes from the message table
  (`picture.*`), so a screen reader hears the page's language too.
  **Motion follows the same rule** (2026-11-18): the sun pulses and its rays
  shimmer, a **lit** lamp and the **chosen** bin's halo swell, and the waste
  **camera flashes** (a star at the lens, every 3.2 s, dark for most of the
  cycle — a flash that never goes out is a lamp) — each is an animated `<g>`
  around the thing, so the
  colours inside still come from the reading (a dim panel shimmers more faintly,
  an unlit lamp has no halo, an unnamed bin has none). The only full rotation is
  still the windmill's; everything else pulses in place. All of it is switched
  off under `prefers-reduced-motion`, and
  `components/SimPictures.test.tsx` reads the stylesheet to keep that true.
  **A first cut animated opacity only, and it was invisible** — 18 px of halo at
  16 % on a dark card changing 0.18 → 0.10 is not motion anyone can see
  (reported 2026-11-18). The glows now **scale 0.82 → 1.12 as well as
  brighten**, and the camera flashes so the waste card is alive before anything
  is recognised. Measure motion with `getComputedStyle(el).transform`
  over two samples, not with `animationName`: the name being attached says
  nothing about whether a person can see it.
  **One measured trap:** adding a 92 px lamp to `.sim-lamps` — a row that is
  `flex: 0 0 auto` — made the kiosk **5 px wider than a 390 px phone**; the
  phone media query now lets that row wrap and draws the lamp smaller. Check
  `document.documentElement.scrollWidth` at 390 px after touching any picture.
- **The whole kiosk page and its dialogs are in three languages (2026-11-18).**
  One selector — **English · हिन्दी · മലയാളം**, each name in its own script —
  now sets **both** the interface and Sara's language, because a visitor who
  cannot read English should not have to find a second switch to read the page.
  `lib/lang.ts` holds the codes and the order; `lib/messages.ts` holds every
  visitor-facing sentence as `'key': [en, hi, ml]`; `lib/translate.ts` resolves a
  key with **English as the fallback**; `useT()` in `lib/i18n.ts` binds it to the
  shared state in `voiceUi`.  `messages.test.ts` fails the build if a key lacks a
  language, if the three languages disagree about a `{placeholder}`, or if a key
  would ever be displayed raw.
  - **Whole sentences, never glued fragments**: `page.soilWithValue` is
    `'Soil: {state} · {percent}'`, because word order differs between the three.
  - **Numbers and units are untouched** (330 Ω, 1.8 V, mA, mW, %): only the
    words around them change.
  - **Routing never reads translated text.**  `wasteGuide.guideFor` still decides
    from the English class label and returns message **keys**; the components
    translate.  A Hindi page cannot send an item to a different bin.
  - **A language change touches nothing else.**  No command, no demo scenario,
    no reset, no re-record: it is a way of reading the page, not an action on it.
    `OurVillage.test.tsx` asserts `sendCommand`/`demoScenario`/`demoReset` are
    never called by it, and `voiceUi` writes `<html lang>`.
  - **A request finishes in the language it began in.**  `VoicePanel` captures
    the language when the recording starts (`startedLanguageRef`) and threads it
    through transcription, the reply template and the spoken reply, so changing
    the selector mid-sentence cannot re-read an utterance.
  - **Out of scope on purpose:** the operator pages (Setup, Sensors, About,
    What Happened, Help) stay English — the visitor never sees them — and the
    firmware's own `reason` strings and backend error text stay English, with a
    translated sentence used in their place where one is needed.
  - **Translations still need a fluent speaker.**  They were written here, not
    reviewed by a native speaker; the wording is deliberately simple (Class 6,
    exhibition), and any sentence that reads oddly should be fixed in
    `messages.ts` alone — no component changes.
- **Auto is a spoken command for *both* devices (2026-11-18).**  The lights had
  `LIGHTS_AUTO`; the pump had only on/off, so "put the pump on automatic" fell
  through to *start watering* — the Malayalam/Hindi watering cue is the word
  "pump" itself.  `device_commands.pump.auto = PUMP_AUTO` and a `PUMP_AUTO`
  intent close it, and two rules keep the two modes apart: **an explicit `auto`
  outranks the preposition "on"** ("put the pump on automatic" is one state,
  not two) **and outranks the pump cue**.  The panel's client-side
  `ALLOWED_COMMANDS` had to gain `PUMP_AUTO` too, or it refused a sentence the
  parser understood.  The demo device answered the mode change with
  "switched on by hand"; it now says the pump follows the readings again.
- **Natural Malayalam/Hindi status questions work (2026-11-18).**  They were
  listed catalogue phrases that came back **AMBIGUOUS**, because the
  whole-phrase fallback was skipped exactly where they land (one device, no
  state, no question mark).  `_phrase_fallback` is now allowed there whenever
  the sentence is not a question or a refusal.  Malayalam also glues the verb
  to the noun (`വെള്ളമുണ്ടോ` = water + is-there) and `_find` matches whole words,
  so the joined forms are listed in `devices` (`വെള്ളമുണ്ടോ`, `വെള്ളമുണ്ട്`,
  `ടാങ്കിൽ`, `ഈർപ്പം`, …).  With those, the panel's two status examples are the
  sentences a visitor actually says — "മണ്ണിൽ എത്ര ഈർപ്പമുണ്ട്?" and "मिट्टी में
  कितनी नमी है?" — instead of the phrasings the parser used to force
  ("മണ്ണ് നനവുണ്ടോ?", "मिट्टी की स्थिति").  `test_voice_examples.py` sends
  every shown example through the parser, so this cannot drift back.
- **The three examples are buttons at the top of the panel (2026-11-18).**
  They were a list at the foot, under the typed box and the privacy line — below
  the fold on the exhibition laptop and the last thing a visitor needs.  Now
  **Try saying…** is the first block under the heading: one button per example,
  carrying the plain name (*Streetlights on*) and the sentence it will send
  (“Please turn on the lights.”), with the explanation on the title.  **One
  press sends that sentence through the same path as typing** (`sendTypedText`,
  shared with `submitTyped`), so "Your request" shows what was asked and the
  phrase is learned by watching it work — never a second parser.
  **Nothing of the catalogue lives at the foot of the panel (2026-11-18, second
  pass).**  A collapsed *More examples* strip down there was unreachable on a
  smaller window — "it needs a browser zoom out to actually even see it" — so
  there is no footer at all: **More commands**, at the right of *Try saying…*,
  opens the remaining nine sentences **at the top** in a **two-column list of
  buttons** (two columns is what makes all nine fit without scrolling on a
  laptop; one column on a phone, where the list scrolls inside itself).
  Choosing one sends it and **closes the list**, because the answer is what the
  visitor asked for.  `runPhrase` is the one entry point for any pressed
  sentence, however it was chosen.
  **The panel scrolls at every width** — `overflow-y: auto` on `.voice-panel`,
  not only in the phone block.  That block had promised "its own scroll,
  nothing clipped" since it was written while `overflow` was still `hidden`,
  which squeezed the old catalogue to **11 px**; measured 2026-11-18 at
  1440x900 / 1280x720 / 1024x700 / 390x844, all nine commands visible on a
  laptop with no list scroll.  On a phone the three headline buttons sit
  two-across with the last spanning the row.
  `VoicePanel.test.tsx` asserts the buttons are the first block, that pressing
  one calls `voiceInterpret` with the phrase (and never the microphone), that
  the catalogue opens at the top with a row per command, that the row's shown
  phrase is the phrase it sends, and that the wire names stay out of sight.
- **A command that is already true is answered with the state, not sent
  (2026-11-18).**  Asked for the pump's Auto/On/Off and checked against the
  lights.  The rule is one function, `alreadyInState` in `VoicePanel.tsx`, and
  it runs on a **fresh** frame only (connected, not stale, younger than 5 s):
  - **lights** — `LIGHTS_ON` needs `mode === 'manual_on'`, `LIGHTS_OFF`
    `manual_off`, `LIGHTS_AUTO` `auto`.  Auto + dark is **not** "already on":
    that asks for them to be *held* on, so it reaches the controller.
  - **pump** — `PUMP_AUTO` / `PUMP_ON` / `PUMP_OFF` read
    `actuators.pump.mode`.  A spoken "pump on" is a **watering request**, so it
    is already satisfied when the pump is pumping, soaking **or held on by the
    switch** — and the reply is *"The pump is already on by hand."*, not the
    catalogue's "a watering pulse is already running" (that sentence is wrong
    for a manual switch).  **The exception:** `IRRIGATION_STOP` while
    `mode === 'on'` is a real action and must reach the controller — a manual
    On is stopped by "stop the pump".
  - Each sentence is in the visitor's language: the catalogue's `already_text`
    for the intents it knows, and `panel.alreadyLightsAuto` /
    `panel.alreadyPumpAuto|On|Off` for the pump's own switch (which has no
    intent, because only the card and "pump auto" reach it).
  Measured in Simulation: switch On + "pump on" → *already on by hand*; switch
  Off + "stop the pump" → *nothing to stop*; Auto + "pump auto" → *already in
  automatic mode*; lights held on + "lights on" → *already on*; Auto + "lights
  auto" → *already in automatic mode*.
- **A refusal is shown and spoken in the visitor's language (2026-11-18).**
  A rejected command used to print the controller's own English sentence under a
  Malayalam heading — twice, because the same string was also the detail line
  ("നിരസിച്ചു / Simulated: Irrigation blocked: the soil is already wet
  enough.").  The refusal codes a visitor can meet now have sentences in
  `lib/messages.ts` (`reason.<CODE>`, ~14 of them), `refusalKey()` is the single
  lookup, the reply **and** the spoken sentence use it, and the English detail
  line is rendered **only** for a code this build has no translation for.  In
  Simulation the sentence keeps the simulator's marker (`panel.simulatedPrefix`)
  so a translated refusal cannot imply the physical model moved.
- **Silence is not a sentence, and neither is a script nobody reads
  (2026-11-18).**  A Malayalam command came back as **ずいら屋子座** and the panel
  printed it under "Your request" — Whisper invents text when it is handed
  near-silence.  Two guards, in `VoicePanel.finish()`:
  **`peakLevel`** (`lib/audio.ts`, threshold `SILENCE_PEAK` 0.02) refuses a
  recording that never moved before the model is asked at all, and
  **`usableTranscript`** (`lib/lia.ts`) refuses a transcript with no Indic or
  Latin character — kana, han, hangul, Thai, Cyrillic.  Both answer
  `panel.silent` / `panel.notHeard` in the panel's language, leave "Your
  request" empty, and never parse.  A **sister** script (Tamil for Malayalam) is
  deliberately usable: that path still runs the command.  `peakLevel` reads
  through `Blob.arrayBuffer` **or `FileReader`** — jsdom has no `arrayBuffer`,
  and the first version threw, which the panel's catch reported as "the service
  did not answer".
- **Two words run together are split, and "pump" is the word the model gets
  wrong (2026-11-18, from the evening session — one adult and two children).**
  The app keeps **no audio**, only the transcript in the event log, so the
  evidence used here is the transcript itself.  Nine of that session's twenty
  recordings were answered "please ask me to control a supported device":
  - **Merged words.** The Malayalam model wrote "വിളക്കുകൾ അണയ്ക്കുക" as one
    word, four times: `വിളക്കുകളാണക്കുകാം`, `വിളക്കുകളാണക്കുകാ`,
    `വിളക്കുകളാന്ക്കുകാം`, `വിലക്കുകളാണക്കുകാം` — device + verb in one token,
    with the glide `യ` of അണയ്ക്കുക dropped twice.  `_romanised_intent` now
    **splits a token that nothing reads whole** into two halves, and keeps the
    split only when *this* vocabulary reads both: a device and a state (a
    command), or two device names (`താങ്കില്വല്ലം` = "in the tank" + "water").
    Two of the model's own spellings joined the data: `അണ്ക്കുക`/`അണ്ക്കൂ`
    (`states.off.ml` — the dropped-vowel form) and `വല്ലം` (`devices.water.ml`).
    All five now parse; `ഡ്രയാവ്.` and `ക്കാൽ ക്ക്കുകാം.` still refuse, because
    they hold nothing to read.
  - **"Pump" is short and every mishearing lands in one syllable.** Measured on
    this laptop by reading the exhibit's own voices back through the running
    whisper server and degrading them (pitch up, volume down, room noise):
    54 English command clips score **42/54** on `ggml-base`, **43/54** with beam
    search (`-bs 5`, +0.04 s) and **45/54** on `ggml-small` at **3.05 s** a
    command.  So the model is not the fault, and it was left alone — including
    **no English decoder prompt**, which would risk inventing a command out of a
    cough.  What the Indian English voice produces for "Pump on!" is `Bum on!`
    on base *and* small, and the children produced `Dumb on!` / `Bounce on!`, so
    the spellings the exhibit has actually produced are now listed on the pump
    (`bum`, `bump`, `dumb`, `thumb`, `pum`, `pomp`) and "Pump on!" reads in 5 of
    6 variants.  `docs/operation.md` carries the table.
  - **A half command is answered with its other half, not with "unsupported".**
    A **state word with no device** now returns `clarify_device`
    ("Which device? You can say the lights, the pump, or ask about the soil or
    the water.") and a **device with no state** returns `clarify_state`
    ("On, off, or automatic?") for a device that really has one — soil and water
    are never offered a switch they have not got.  Nothing is sent in either
    case, so "Thanks on!", "Let off!" and even "turn on the fan" get a sentence a
    visitor can answer instead of a dead end.  `messages.clarify_device` lost the
    word **bins** with this (the bins have had no reading since 2026-11-18).
  - **A bracketed sound is not a sentence.** `[Coughing]`, `[Laughter]`,
    `(coughing)` and `[Music]` now answer `no_speech` ("I did not hear a
    command") through `NON_SPEECH` in `intents.py`, instead of the catalogue
    sentence.  Only a *whole* transcript counts, so a marker inside a sentence
    leaves the words to the usual rules.
- **"Some worked, some didn't" — the device matcher now reads spellings the way
  the sound pass does (2026-11-18, reported, with the recordings).**  The user
  gave ten Malayalam commands; four were refused and two more answered wrongly.
  Every failure was a spelling of a word this vocabulary already had, so the fix
  is in the *matcher*, not in new vocabulary:
  - `_device_hits` gained a second pass over the tokens no exact alias claimed,
    comparing `romanise(token)` against the device sounds with
    `same_word(allow_suffix=True, allow_edit=False)`.  That covers the case
    ending Malayalam puts on the noun — `വിളക്കുകുള്ളെ` (lights), `പംഭിന്റെ`
    (pump), `മണ്നില്ലത്രാ` (soil + "how much" fused) — and the model's
    `വിളക്കുകള്` (spelt with ്, not ൾ), which no alias list contained.
  - **Two traps set the limits, and both were measured as wrong answers:**
    the *prefix* tolerance is only for names of **5 folded letters or more**
    ("thanks" starts with "tank", so "Thanks on!" was answered about the water),
    and `allow_edit=False` keeps the one-letter tolerance **out of the
    structural pass** ("band" — Hindi for off — and "pani" nest consonant for
    consonant, which made "light band karo" ambiguous).  The sound path keeps
    both, because that is what reads `പംമ്` and `ഓത്ടോ`.
  - `_unaccounted` now counts a device the matcher found, so a sentence whose
    device was read perfectly ("വിളക്കുകള് ഓട്ടവു") is not refused for the same
    word the alias list spells differently — one definition, reused.
  - Data, each quoted from a recording: `states.auto.ml` += `ഓട്ടവു`,
    `ഓട്ടോവു`; `devices.pump.ml` += `പമ്പൾ`, `പമ്പിന്റെ`, `പംഭിന്റെ`;
    `grammar.ml.status_words` += `അവസ്ഥാ` (the emphatic form — `അവസ്ഥ` was
    already there but an exact-token match missed it); `VILLAGE_STATUS.phrases.ml`
    += `ഗ്രാമത്തിന്റെ അവസ്ഥാ`.
  - **Measured on the user's own 15 recordings** (`scripts/voice_replay.py`,
    which is why the folder exists): **6 answered differently, all better**
    (`മണ്നില്ലത്രാ…` → SOIL_STATUS, `വിളക്കുകുള്ളെ അവസ്ഥാ` → LIGHTS_STATUS,
    `പംഭിന്റെ അവസ്ഥാ` → PUMP_STATUS, `പമ്പൾ ഓട്ടോ` → PUMP_AUTO,
    `വിളക്കുകള് ഓട്ടവു` → LIGHTS_AUTO, `ഗ്രാമത്തിന്റെ അവസ്ഥാ` →
    VILLAGE_STATUS) and **1 still unread** — `ഗ്ഗാസാവ്യായ്യ്`, which holds
    nothing.  The other 8 were already right and stayed right.
  - One accidental win, worth knowing because it is not a rule anyone wrote:
    the voicing fold makes "led" (a lights alias) and "let" the same word, so the
    child's `Let off!` is the lights' off.  It is pinned by a test with that
    explanation beside it.
- **The tank's answer says "enough", not "low level" (2026-11-18, reported).**
  Asked "Is water available?" in Simulation with the tank set to available, Sara
  answered *"There is water at the low level in the tank"* — a sentence that
  reads as *the water is low* when it is the opposite.  `tankAvailable` is now
  **"There is enough water in the tank"** (ml `ടാങ്കിൽ ആവശ്യത്തിന്
  വെള്ളമുണ്ട്.`, hi `टंकी में पर्याप्त पानी है।`) in `lib/lia.ts`, which is what
  both the voice panel and the live narration read.  Two facts keep it honest and
  are why "full" is not claimed and no percentage is offered: the probe sits at
  a **low level**, so "available" means *water above that level* — enough for the
  pump to run — and the two wires cannot say anything more.  The Rain Water Tank
  picture's hint and `docs/operation.md` say the same in their own words.
- **The last few recordings are kept on disk, bounded twice, and a script
  replays them (2026-11-18, asked for by the user).**  The evening's analysis
  had to work from transcripts because the app kept **no audio** — so it now
  keeps the newest ones in **`data/voice-clips/`** (`app/voice_clips.py`), each
  with a `.json` sidecar (language, engine, duration, transcript, intent,
  reason) written *after* the answer, with the audio saved **before** the model
  is asked so a sentence the model cannot read at all is still there.
  - **Two ceilings, pruned on every save**, because a count alone lets a big
    clip fill the disk and a byte cap alone lets a thousand tiny ones: default
    **100 clips** (`VILLAGE_VOICE_CLIPS`) **and 64 MB**
    (`VILLAGE_VOICE_CLIP_BYTES`); `VILLAGE_VOICE_CLIP_DIR=` (blank) switches it
    off.  A 10 s clip is ~320 kB, so 100 is ~32 MB.  The newest clip is never
    deleted to honour the ceiling — an empty folder would lose the sentence just
    misheard — and a clip goes with its sidecar, so the pair cannot drift.
    `data/*` already ignores the folder, so no recording can reach git.
  - **A failure to save never fails the request** (the pattern the waste crops
    already use), and `GET /voice/readiness` reports `clips: {enabled, keep,
    max_bytes, kept, bytes}` so `curl` answers "how much room do they take?".
    The startup log says the policy in one line.
  - **`scripts/voice_replay.py` is why the folder exists**: it re-runs each
    stored transcript through the parser and marks what changed
    (`--fails-only`, and `--audio` to ask whisper again after a model change).
  - The panel's privacy sentence gained the fact in three languages ("the last
    few recordings are kept here so Sara can learn to hear you better") — a
    visitor is not told something that is not true.
- **Malayalam speech: the model mangles the question word, so the device is
  what survives (2026-11-18).**  Measured with audio synthesised by Sara's own
  voice: `ggml-base` writes Malayalam **in Tamil script** (`താങ്കില വെള്ളമ്ണു`)
  and loses `ഉണ്ടോ`/`എത്ര` while keeping the noun.  Two changes make the exhibit's
  own questions work: `fold()` now merges the **varga** classes (g→k, b→p, d→t,
  j→c, z→s, v→w — voicing is not phonemic in these languages, and Whisper wrote
  "Thangil"/"Velamundo" for `tankil`/`vellamunto`), and `_romanised_intent`
  answers **a device whose only command is status** (soil, water) when exactly
  one device and no state were heard.  That last rule is **restricted on
  purpose**: the pump and the lights have commands, so a mangled "pump off"
  stays refused rather than being quietly answered with a reading
  (`test_an_unreadable_pump_command_is_never_answered_as_a_status`).  Measured
  after: `விலகுகள் காட்டிக்குக்கா` → LIGHTS_ON, `தாங்கில வெள்ளമ്ണു` →
  WATER_STATUS, `மண்ணில் எத்தாக இருப்போமும் இரு` → SOIL_STATUS.
- **The watering picture is a can, not four dots (2026-11-18).**  Reported
  twice as "the watering animation is not visible": the first drawing put four
  pale-blue circles a little above the leaves with nothing holding them, which
  reads as **berries on the plant**.  It is now a watering can in the corner
  with a spout, four droplets falling from it onto the pot, and a faint splash
  where the stream lands — all of it only while `pumping` is true, so the
  picture still cannot claim water that is not flowing.
  **Two other reasons a presenter saw nothing, both now handled:** the
  simulated controller pulses for ~4.5 s and then **soaks** (pump off) for much
  longer, so the stream is only on for part of each cycle; and a lab left in the
  controller's own "no moisture rise" **failure lockout** (30-minute cooldown)
  would not water at all until reset.  A demo **scenario** now clears that
  lockout and cooldown with it
  (`test_a_scenario_clears_the_controller_lockout_so_the_demo_can_water_again`).
- **Where the drawings move, they still say the truth without motion
  (2026-11-18).**  Under `prefers-reduced-motion` the watering stream used to be
  `display: none`, so a machine asking for less motion saw a card that looked
  broken ("the watering animation seems gone").  The drops are now drawn **held
  still** at four heights instead — still only while the pump actually runs.
- **The panel has its own words, in all three languages (2026-11-17).** All
  strings live in `web/frontend/src/lib/voiceCopy.ts` (title *Talk to Sara*,
  intro, section headings, short state words, plain action wording) and are
  checked complete for `en`/`ml`/`hi` by `voiceCopy.test.ts`. Nothing internal
  may reach a visitor: no command ids, no `sends LIGHTS_ON`, no confidence and
  no parser rules. Order is fixed — language + state (with the Simulation
  sentence), Start/Stop speaking, **Your request**, **Sara's reply**, typed
  input, three examples + **More examples** — and only the examples area
  scrolls, so the reply never leaves the screen.
- **The three examples are tested against the real parser.** They live in
  `web/frontend/src/lib/voiceExamples.ts` and
  `web/backend/tests/test_voice_examples.py` reads that file and sends every
  phrase through `IntentMatcher` in its own language, expecting the intent the
  file claims. An example nobody understands fails a test. Malayalam and Hindi
  cannot use the English sentences verbatim: “മണ്ണിലെ ഈർപ്പം” and “मिट्टी की नमी”
  come back AMBIGUOUS, so the examples use “മണ്ണ് നനവുണ്ടോ?” and “मिट्टी की
  स्थिति” — do not "tidy" them back to the literal translations.
- **A status question is answered from the frame, not from the catalogue.** The
  catalogue's WATER_STATUS/SOIL_STATUS replies only say "the dashboard shows
  which", so the panel answers from `sensors.reservoir` / `sensors.soil` using
  `LIVE_COPY` — in the visitor's language, and without inventing a percentage
  when the probe is uncalibrated. `soilDry(pct)` templates already carry the
  `%`: pass the number only (a doubled `%%` shipped once).
- **A new recording clears the request but keeps the reply (2026-11-18).**  It
  used to keep both, and the visitor saw the *previous command* sitting under
  "Your request" while speaking the next one, which reads as "it already heard
  me".  `start()` empties `transcript`; the reply stays because it answers the
  previous question and is what the visitor was reading.  Closing the panel
  mid-recording still cancels the recorder.
- **The rows read the same in both modes; only the lab's controls are extra
  (2026-11-17).**  The pump/streetlight state, the *Outside / Streetlights*
  readings, the five-lamp strip, the SolarPanel / Windmill pictures and the
  "why" sentence under each row are rendered for Live as well — the sliders,
  the tank choices, the quick demonstrations and *Try a sample* stay inside
  `{demo && …}`.  In Live the pictures follow the **measured** volts through the
  same curve the simulator uses (150 mV … 4000 mV), and the windmill is drawn
  still with `data-fitted="false"` when no turbine is wired, so the picture
  cannot claim hardware the board does not have.
- **Sara answers in the visitor's language, never in the device's words
  (2026-11-17).**  The firmware's `reason` texts are English; `applyUtterance`
  used to *speak* `commandOutcome.reason` first, so a Malayalam command was
  confirmed by an English sentence read with the `ml` Piper voice — reported as
  "she answered in something weird".  Now the spoken text is the parser's
  localized `done_text` (confirmed) / `already_text` (duplicate) /
  `messages.refused` (rejected) / `messages.unconfirmed`, and the English
  reason appears only as the **text** line under a non-confirmed outcome
  (`CommandOutcome` line is no longer rendered for a confirmation, where it
  repeated the state word).  `messages.refused` was added to
  `shared/intents.json` in all three languages.  A test asserts the spoken
  argument is Malayalam for a Malayalam command.
- **Two words are said differently from how they are written, in English only
  (2026-11-17).**  `ENGLISH_SAY` in `lib/speech.ts` rewrites them for **speech
  only** (`spokenText`), leaving every on-screen word alone, and the
  device-voice fallback gets the same spelling:
  - **`Sara` → `Sahra`.**  The English phonemiser reads the name /ˈsɛrə/
    ("SEH-ra", the American name); our Sara is /ˈsɑːrə/ ("SAA-ra") as
    സാറ/सारा.  `Sahra` gives `s ˈ ɑː ɹ ə`; `Saara` doubles the r
    (`s ˈ ɑː ɹ ɹ ə`) — do not "tidy" it without re-running `piper_phonemize`.
  - **sentence-final `you` → `yoo`.**  An unstressed final pronoun is reduced to
    a short vowel (greeting measured **140 ms, 13.3 %** of the sentence peak);
    `yoo` is the same sound stressed (`j ˈ uː`, 200 ms, 15.9 %), so it is a
    fully spoken word across a room.  `yuu` doubles the vowel (`j uː uː`) and
    `youu` becomes "yow-oo" — measured, not guessed.  Only at a sentence end:
    mid-sentence "you" is a normal pronoun and is left alone.
- **Indian English is the default and it is stored server-side (2026-11-17).**
  Two English voices: `en_IN-spicor-medium` (NavGurukul, **AGPL-3.0**, neural,
  Indian — installed by `scripts/install_piper.sh`) and
  `en_US-lessac-medium` (official, American, the same speaker as hi/ml).
  `ENGLISH_VOICES` in `web/backend/app/tts.py` maps the setting value
  (`device-india` | `sara`) to a model; `/voice/speak` takes a `voice` field and
  falls back to Lessac if the Indian file is missing, so a request can never
  silence her.  `english_voice` is a **server setting** (`DEFAULT_SETTINGS` in
  `db.py`, default `device-india`) written by Setup → Voice & Camera, mirrored
  into `localStorage` (`village.englishVoice`) and hydrated for a fresh browser
  by `VoiceUiProvider`.  A reflash of the board touches none of it — the
  settings live in `data/village.db`.
- **The simulation lab is one engine with real controls (2026-11-17).** Every
  slider, preset and sample goes through `SimulatedDevice` (`web/backend/app/
  simulator.py`) via `POST /demo/scenario` / `/demo/reset` — never a second
  simulation, and never a hardware command.  Controls: soil moisture
  (`soil_pct`), tank `available|low`, outside light (`light_metric`),
  `solar_light`, `wind_speed`, and `lights_mode` for the presets.  Solar is one
  circuit (mW = V × mA, junction clamped at the LED's forward voltage); wind is
  **voltage only** — no current or power field exists, deliberately.  A manual
  **On** is stopped by a *low* tank in the simulator exactly as on the board,
  and the switch stays where the operator put it.  Demo answers are prefixed
  "Simulated: " so a spoken reply cannot imply the physical model moved.
  `Quick demonstrations` (Night-time / Dry soil / Low water / Reset demo) are
  deterministic and each states what it changed; reset clears timers and
  restores the documented defaults without touching hardware settings.
  Waste samples are five presets answered from `lib/wasteGuide.ts` — they are
  **not** classifier results and light no bin LED.
- **Choosing a camera is a first-class control (2026-11-17).** An exhibit
  laptop usually has a built-in camera *and* an external USB one, and the
  browser defaults to the built-in. `Camera device` sits on Sort Waste **under
  the Start/Stop button** (it used to be buried inside the collapsed
  "Confidence and model details" panel, where nobody found it) and lists
  `enumerateDevices()`; the choice is stored in `localStorage`
  (`village.cameraDevice`, helpers in `lib/camera.ts`), a `devicechange` listener
  refreshes the list so a camera plugged in later appears without a reload, and
  a remembered device that no longer answers is cleared rather than retried.
  Names only appear after the page has been allowed a camera once — the page
  says so. Listed before anything else when someone asks "how do I select my
  webcam".
- **A filled button keeps its fill on hover (2026-11-17).** `.btn:hover:
  not(:disabled)` is a class plus two pseudo-classes, so it outranks
  `.btn--gold` / `--primary` / `--danger` and once replaced the gold gradient
  with a near-transparent white under a dark label — the sign-in button read as
  turning black.  Each filled variant has its own hover rule; the neutral `.btn`
  keeps the white wash.  `components/buttonHover.test.ts` reads the stylesheet
  and fails if a variant loses its hover or reintroduces the wash.
- **The language pills are styled in `styles.css` and guarded (2026-11-17).**
  `.lang-picker` / `.lang-pill` (plus `.is-on`, `-label`, `-note`) are shared by
  the page, the panel and Lia.  Rewriting a large CSS block wholesale deleted
  them silently once and the selector fell back to the browser's grey buttons —
  `components/langPills.test.ts` now reads the stylesheet from disk and fails if
  the pills or their gold selected state go missing.
- The panel greets on open ("I am Sara. How may I help you?") in the page's
  language, once per opening, and stays silent when `tts_enabled` is off.
- **Simulation-only lab controls** on Our Village: the light-level slider
  (`light_metric`) and the pump switch (`pump_manual`: auto/on/off). Both are
  fields of `POST /api/v1/demo/scenario` on `SimulatedDevice`; live has neither,
  because the firmware's Water request is gated and the manual path there is the
  bench panel (Test). Do not add a manual pump mode to the firmware without the
  commissioning rule in mind.

## ESP32 firmware

> **DO THE OTA FROM THIS SESSION. This is a standing rule (2026-11-17).** The
> upload runs on the **Windows** host, over the Mobile Hotspot, and this session
> can drive it through interop — do not hand the command to the user and wait:
>
> ```bash
> PW=$(sed -n 's/.*VILLAGE_OTA_PASSWORD "\(.*\)"/\1/p' uc/include/village/secrets.h)
> cp uc/.pio/build/esp32doit-devkit-v1-ota/firmware.bin /mnt/c/Users/<you>/village-flash/ota-firmware.bin
> /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command \
>   "cd \$env:USERPROFILE\village-flash; .\espota.exe -i <board-ip> -p 3232 -I 192.168.137.1 -P 3233 -a '$PW' -f ota-firmware.bin -r"
> ```
>
> `-I 192.168.137.1` is the Windows hotspot address the board can reach back on
> (WSL's 172.29.x cannot be reached, which is the whole reason espota runs on
> Windows). The board's address comes from `./scripts/relay.sh status` — it is
> DHCP and has been .168, .197, .222 and .230. espota's output is often swallowed
> by the PowerShell wrapper, so **confirm with the board itself**:
> `firmware` in `/api/v1/status` (0.2.4, say) and a new `boot_id`. This was
> missed on 2026-11-17 and the upload was handed over instead of run.

> **ALWAYS FLASH AN OTA-CAPABLE IMAGE. This is a standing rule (2026-11-15).**
> Never write a firmware whose USB image has OTA compiled out, and always check
> the OTA port is answering after a flash. **The mistake it prevents, measured:**
> on 2026-11-14 the board was flashed, USB was then disconnected, and the board
> turned out to be running an image with **no OTA server** — `192.168.1.41:3232`
> refused six connections over 18 s while `:80` answered. There was no way in: no
> USB (the CP210x had gone from Windows) and no OTA. Nothing could be updated
> until a cable was produced. One minute of checking would have avoided it.
>
> - The **USB image** must have OTA compiled in — `VILLAGE_ENABLE_OTA` defaults
>   to 1 in `uc/include/village/build_config.h`; **do not set it to 0** in any
>   build flag, and check the image carries it:
>   `python3 -c "print(open('uc/.pio/build/esp32doit-devkit-v1/firmware.bin','rb').read().count(b'[ota] ready on'))"`
>   must print **1** (0 means that image can never be updated over Wi-Fi).
> - **OTA on this firmware is UDP on 3232, not TCP** — `ArduinoOTA.begin()` opens
>   `_udp_ota.begin(3232)` and only creates a TCP listener when an update arrives.
>   So **a TCP connect to 3232 is refused even on a perfectly healthy board**;
>   probing it that way and concluding "no OTA" is a wrong diagnosis that cost an
>   hour on 2026-11-15. The honest checks are the device's own report —
>   `GET /api/v1/health` → `ota: {started, port, password_set}` — and an actual
>   `espota` run.
> - **The working upload runs `espota.exe` on the Windows host** (the board must
>   be able to reach the uploader, and it cannot reach WSL's NAT address):
>   ```powershell
>   netsh advfirewall firewall add rule name="village-ota-3233" dir=in action=allow protocol=TCP localport=3233
>   cd %USERPROFILE%\village-flash
>   .\espota.exe -i <board-ip> -p 3232 -I 192.168.1.36 -P 3233 -a "<password>" -f ota-firmware.bin -r
>   ```
>   Verified end to end 2026-11-15: `Uploading: 100% Done`, board rebooted into the
>   new image. Build the image with `-e esp32doit-devkit-v1-ota`, copy it plus
>   `espota.exe` to that folder.
> - **Know which image is running, from the device itself — and read the right
>   endpoint.** `/api/v1/health` carries the `board`, `wifi`, `free_heap` and
>   `pin_map` blocks; **`/api/v1/status` does not, by design** (it stops after
>   `recent_events`). Checking `status` for `pin_map` and concluding "old image"
>   is a wrong diagnosis that cost an hour on 2026-11-15. Use `firmware` in
>   either payload for the version, and `health` for the pin map.
> - **`VILLAGE_OTA_PASSWORD` (16 chars in `secrets.h`) must be present**, or the
>   board refuses the upload even when the port is open.

### The board on the Windows Mobile Hotspot (2026-11-16)

**The point of this arrangement: it does not matter which Wi-Fi the laptop
joins.** The board has **one** compiled network credential — the hotspot's SSID
and password — and those never change. So at any venue (a home router, a phone
hotspot, a customer's Wi-Fi, no Wi-Fi at all) the board looks for, and finds,
the same network it always finds. The venue's Wi-Fi only changes **what the
hotspot shares upstream**; it never changes the hotspot's own subnet
(`192.168.137.0/24`), so neither the board's neighbourhood nor the relay's
target depends on where the laptop is. **No internet is needed for any of it** —
the board and the laptop only need to reach each other.

What does depend on the laptop: the **hotspot must be on**, and the **app must
be running**. Everything else (lease changes, the relay dying, the WSL address
moving, the hotspot being switched off) repairs itself — see below.

**Symptom, and it looks exactly like a dead board:** the app says
`connected false`, the Setup switches answer `DEVICE_UNREACHABLE`, and
`curl` from this container times out (`http_code 000`, exit 28) — while the
same request from Windows returns **200**. The board is healthy; the path is
not.

**Cause: Windows Mobile Hotspot is ICS**, and ICS does not route its
`192.168.137.0/24` from any other subnet. The board answers the Windows host
and refuses everything arriving from WSL, whose address is `172.29.x`. Do not
re-flash the board over this, and do not go looking for a fault in the
firmware.

**The fix in use: a relay on the Windows host.**

```bash
./scripts/relay.sh status    # is the board reachable through it?
./scripts/relay.sh start     # copy the relay to Windows and run it
./scripts/relay.sh stop
```

and in `.env`:

```
VILLAGE_DEVICE_URL=http://172.29.192.1:8090   # the relay, from this container
VILLAGE_DEVICE_DIRECT=http://192.168.137.168  # a first guess for the board's lease
```

`172.29.192.1` is the Windows host on the WSL network; `192.168.1.3` (its Wi-Fi
address) works too, because the relay binds `0.0.0.0`. `VILLAGE_DEVICE_DISCOVER`
must be **false**: the /24 sweep would sweep `172.29.192.0/24` and find nothing.
The relay source lives in `scripts/windows-device-relay.py`; `relay.sh` copies
it to `%USERPROFILE%\village-flash\tcp-relay.py` and starts it hidden.

**Why not the obvious alternatives** (each was considered, 2026-11-16):

- `netsh interface portproxy` does the same job but needs **administrator**;
  the Python relay binds a port with no elevation and no firewall prompt.
- WSL `networkingMode=mirrored` would also work but restarts WSL — which kills
  the session you are working in.
- Connecting the board to a *router* both machine and board are on is the
  permanent fix (it routes from WSL natively). It needs that network's password
  compiled in, and Windows withholds the stored key without elevation.

**Windows keeps this hotspot on by itself, mostly.** Measured 2026-11-16: switch
it off from the WinRT API and it comes **back on within ~14 s** while the laptop
has an internet connection to share. So a hotspot found `Off` is not a toggle
someone flipped — it is almost always the laptop having **no uplink** (Wi-Fi
dropped, or the machine was asleep), and the hotspot resumes as soon as it
returns. That is why the real test is `relay.sh status` (hotspot state + board),
not the toggle.

**A watcher keeps the link repaired for the life of a run**
(`./scripts/relay.sh watch`, started by `dev.sh` and `launch.sh`, killed by
`stop.sh` via `data/run/relay-watch.pid`). Every 30 s it probes the board and,
when the probe fails, re-runs `ensure` — which re-points the URL, restarts a dead
relay and asks for the hotspot. It logs to `data/logs/relay-watch.log`. Measured:
hotspot switched off by hand → board back through the relay **within 30 s** with
`link down: repairing … board reachable again` in that log.

**`ensure` now acts on any hotspot state that is not `On`**, not only on `Off`:
a WinRT read that fails while the hotspot is down used to fall through with no
repair at all, and switching it on is a no-op when it is already up.

**Gotchas, and each one is already handled:**

- The relay is a **Windows** process, so it dies when the laptop reboots. Nothing
  to remember: `dev.sh`/`launch.sh` call `relay.sh ensure` before the backend
  reads `.env`, which restarts it if it is gone (and repairs the URL, see the
  next paragraph).
- **The board's lease really does move** — it was `.168`, then `.197`, then
  `.222` within one session. `VILLAGE_DEVICE_DIRECT` is only the **first guess**:
  the relay probes it and, failing that twice, sweeps the subnet for the device
  API and switches to whatever it finds. Do not chase a changed address by hand.
- **The WSL gateway can change** when WSL restarts (the subnet is picked per
  boot), which is what `ensure` rewrites in `.env` before the backend starts.
- `scripts/relay.sh status` is the one command that says whether the whole chain
  works, and `windows hotspot -> Off` in its output is the tell for the failure
  that looks like a dead board.

### The hotspot itself is part of the chain (2026-11-16, the powerbank incident)

The board's **only** network credential is the hotspot's SSID, so when the
hotspot is switched off the board has no network at all — its Wi-Fi is not
"down", there is simply nothing to join. That failure is indistinguishable from
a dead board by looking at the app: `connected false`, no `192.168.137.x`
address on Windows, no ARP entry, nothing on the subnet. It happened on
2026-11-16 right after the board was moved to a powerbank; the board was
perfectly healthy, the **hotspot had been switched off**.

Diagnose it in this order, and do not start re-flashing:

```bash
./scripts/relay.sh status        # board ✓/✗, relay pid, hotspot On/Off, last discovery
./scripts/relay.sh hotspot       # just the hotspot state
./scripts/relay.sh hotspot-on    # switch it on (no admin, no UAC prompt)
```

`hotspot=NoInternetProfile` is the other case: the laptop has no uplink to
share, so the hotspot cannot run at all — join a network first.

**`ensure` (called by both start scripts) now fixes this too:** board not
reachable → ask the hotspot → if it is `Off`, start it and wait again (up to
`VILLAGE_RELAY_HOTSPOT_WAIT`, default 25 s). Measured end to end: hotspot off,
`./scripts/relay.sh ensure` alone → hotspot back `On`, board reachable, app
`connected true` in **39 s** (most of it the board's own ~15 s rejoin, plus the
relay's 10 s scan cooldown). `hotspot-on` from `Off` took **18 s**.

The hotspot is read and set through `scripts/windows-hotspot.ps1`
(`NetworkOperatorTetheringManager`, the WinRT API — `netsh wlan` cannot do
this), which needs no elevation for the interactive user.

**The lease really does move, and discovery is what saves it.** After the
hotspot came back the board rejoined at **`192.168.137.197`**, not `.168`; the
relay swept, logged `found the board at 192.168.137.197` and the app
reconnected with no intervention. That is the concrete reason the relay scans
rather than trusting `VILLAGE_DEVICE_DIRECT`. Moving the board onto the
powerbank also **rebooted** it (`boot b-c07581c2`, new boot id) — config
revision 23 and every calibration survived, as NVS settings should.

Two more facts worth keeping from that incident: a **powerbank is fine** for
this board (it ran for minutes at ~80–250 mA), and the board's **streetlights
stay under automatic control** across a power cut — after the reboot
`actuators.streetlights.commanded` was `true` again with the room dark.

### Driving the outputs by hand: the Test outputs page (2026-11-16)

**Start here, not with a bench build.** Setup → **Test outputs** has a master
switch and then one on/off switch per output — **Pump / motor D19, Organic LED
D21, Plastic LED D22, Paper LED D23, Streetlights D13**. Nothing moves a pin
until the master is on; past that the five switches go straight to the pins:

```
POST /api/v1/commands  {"type":"TEST_MODE","parameters":{"on":true}}   # the gate
POST /api/v1/commands  {"type":"TEST_OUTPUT","parameters":{"output":"pump","on":true}}
# output: pump | led_organic | led_plastic | led_paper | streetlights
```

Verified on the board 2026-11-16 over the app's own route: all four LEDs read
`on=true` then `off=false` in `status.test.leds.{organic,plastic,paper,streetlights}`,
and the pump reads `pump_pin=true` when switched on. `status.test` is
`{enabled, pump, pump_pin, leds{...}}`.

**`pump_pin` is `digitalRead(D19)` — the pad, not the intent, and it is why the
pump switch once looked broken.** `applyPump()` refuses to raise the gate unless
`VILLAGE_PUMP_COMMISSIONED` **and** `config.irrigation.pump_enabled` are both
true, and the commissioning gate is deliberately closed, so `TEST_OUTPUT
pump on` set the switch `true` while D19 stayed LOW (reported 2026-11-16). The
bench path writes the pad through a separate **`applyPumpDirect()`**, used in
exactly two places (the loop while test mode owns the outputs, and the
`TEST_OUTPUT` handler). **Every other caller must keep using `applyPump()`** —
otherwise the pump could run with the gate closed for reasons nobody asked for.
Measured after the fix: `TEST_MODE on` → every output off and `pump_pin=false`;
`pump on` → **`pump_pin=true`**; `pump off` → `false`.

Four things worth knowing before using it:

- **The master switch is the only gate** (added 2026-11-16 at the user's ask,
  after the five switches could be pressed with nothing in front of them).
  `TEST_OUTPUT` is answered `REJECTED` / `TEST_MODE_DISABLED` while
  `rt.test_enabled` is false. Past that there is deliberately no oversight of
  the soil probe, the tank probe, the commissioning gate, the cooldown or the
  kill switch: the pump runs while its switch is on and does not stop by itself
  ("I will take care of any protection manually").
- **Turning the master on forces every output off first**, then takes all five
  from the normal drivers — otherwise test mode inherits whatever was on (in a
  dark room, the streetlights), which is not the state anyone bench-tests in.
- **The master switch is session-only** — a reboot clears `test_enabled`, so a
  forgotten switch cannot survive a power cycle.
- **Enabling the master switch takes all five outputs at once** (there is no
  per-output latch: `rt.test_active` was removed in `8fd68b5`, because after the
  master switch existed it would have been a second flag that had to agree with
  the first). While it is on, the pump / streetlight / waste drivers stand down,
  otherwise the two would write the same pins every pass and the relay would
  chatter. Turning the master off — or rebooting — hands them back; no reboot is
  needed any more just to stop the panel owning the pins.
- `config.test` **no longer exists** — the gate it carried went with the gating.
  `DeviceConfig` is exactly what it was before test mode was invented, so config
  revision 23 survived the change.

The compile-time bench build below is now the fallback — use it only when the
app cannot reach the board at all (e.g. no network) and a pin must be held high
through a reboot.

### Holding the pump pin high to test the motor (2026-11-15, bench build)

The board exposes `health`, `status`, `config` and `commands`; there is still no
raw GPIO endpoint, so the bench build is the only way to hold the gate high
**from boot** without the app. Otherwise use the Test outputs page above:

```bash
cd uc
PLATFORMIO_BUILD_FLAGS="-DVILLAGE_PUMP_BENCH_DRIVE=1" \
  /home/ubuntu/.venvs/pio/bin/pio run -e esp32doit-devkit-v1-ota
```

then copy that `firmware.bin` to `%USERPROFILE%\village-flash\bench-ota.bin` and
run `espota.exe -i <board-ip> -p 3232 -I <windows-ip> -P 3233 -a "<pw>" -f bench-ota.bin -r`.
`GET /api/v1/health` then reports `board.pump_bench_drive: true`.

**The gate must be written on EVERY pass.** The bench block used to call
`applyPump(true)` once per 2 s report while the normal line above called
`applyPump(rt.irrigation.pumpOn())` — false — on every other pass, so the pin
chattered at loop rate, the relay buzzed and **the motor never turned**. The two
calls are now mutually exclusive (`#if VILLAGE_PUMP_BENCH_DRIVE == 1 … #else …`),
so `0` compiles byte-identically to before.

While the bench build runs, `actuators.pump.commanded` in `/api/v1/status` still
reports false: it is the *controller's* state, not the pin. Only the serial
readback (`[bench] pump gate GPIO n: latch HIGH, pad HIGH/LOW`) distinguishes
"the code wrote HIGH" from "the pad is HIGH", and that needs USB.

**Restore immediately afterwards** by OTA-ing `ota-firmware.bin` (the normal
build, kept in the same folder). This build drives the pump unconditionally —
that is the point — so nothing else can stop it, including the kill switch.

> **Power the motor from a separate supply.** Driving a pump from the same 5 V
> bank as the ESP32 browned the board out twice on 2026-11-15: the board
> rebooted mid-run (new `boot_id`) or vanished entirely until the motor was
> unplugged.

### The SSID can carry trailing spaces, and Windows hides them (2026-11-15)

Moving the venue to a phone hotspot cost a session because **`netsh wlan show
profiles` and the Windows UI both trim trailing whitespace from an SSID**, while
the ESP32 does not. The hotspot's name is

```
'motorola edge 30_3782    '   len 25   (four trailing spaces)
```

The firmware was compiled with the 21-character version and the board answered
**`station mode failed (status 1: not found)`** while the laptop sat at 89%
signal — the board was looking for a network that does not exist. The only
reliable reading is the board's own scan, which now prints at boot:

```
[net] scan: 5 network(s) visible
[net]   'motorola edge 30_3782    ' (len 25) rssi -21 ch 1 enc 3
```

`enc 3` is WPA2-PSK. A phone hotspot that offers only **WPA3-Personal** cannot be
joined at all — switch it to WPA2-Personal first. Two more things learned the
hard way: `WiFi.scanNetworks()` **fails with -2 while a join is in progress**, so
the scan must run at boot before `WiFi.begin`, not in the failure path; and
`WiFi.mode(WIFI_AP)` **resets the station status**, so `WiFi.status()` must be
read before it or it answers 255 and says nothing.

The backend finds the board by sweeping the /24 of `VILLAGE_DEVICE_URL`, so point
that at any address on the current LAN (not the old one) and discovery follows
the board's DHCP lease.

### Build

```bash
cd uc
/home/ubuntu/.venvs/pio/bin/pio run -e esp32doit-devkit-v1          # USB image
/home/ubuntu/.venvs/pio/bin/pio run -e esp32doit-devkit-v1-ota      # OTA image
```

- `esp32doit-devkit-v1` builds the normal app image at
  `uc/.pio/build/esp32doit-devkit-v1/firmware.bin`.
- `esp32doit-devkit-v1-ota` builds `firmware.bin` for over-the-air upload.
- Flash use is ~67% of the app partition; builds take seconds.
- Run `pio` **inside `uc/`**; from the repo root it says "Not a PlatformIO
  project".

### USB (COM3 / /dev/ttyUSB*)

This is the normal route when the board is plugged into the machine running
the command:

```bash
cd uc
# Windows
/home/ubuntu/.venvs/pio/bin/pio run -e esp32doit-devkit-v1 -t upload --upload-port COM3
# Linux
/home/ubuntu/.venvs/pio/bin/pio run -e esp32doit-devkit-v1 -t upload --upload-port /dev/ttyUSB0
```

**This WSL container cannot see the board's USB port.** `COM3` belongs to the
Windows host; there is no `/dev/ttyUSB*` or `/dev/ttyACM*` here, and WSL does
not pass the USB device through. That is why the USB command above is the
standard procedure, not something this container can execute. Run it on the
Windows host (or attach the USB device to the Linux host) when USB flashing is
wanted. Do **not** report "the board is broken" because `/dev/ttyUSB*` is
missing — check where the cable is plugged in first.

### Wi-Fi / OTA (verified on this machine, 2026-11-12)

The board joins `ASIANET Giga Fiber`. **Its address is DHCP and it moves**: it
has been 192.168.1.8, then 192.168.1.6, and on **2026-11-13 it was
192.168.1.4**. The Windows host is **192.168.1.6**. Do not trust a remembered
address — on 2026-11-13 the board looked "offline" for 90 minutes because the
backend still pointed at `.6` while the board was answering at `.4` with the
same `boot_id` it had before. Find it before concluding anything:

```bash
TOKEN="$(grep -oP 'VILLAGE_DEVICE_TOKEN "\K[^"]+' uc/include/village/secrets.h)"
# 1. which hosts answer on :80.  The whole /24 is reachable through the WSL
#    NAT, and the router at 192.168.1.1 answers too, so this also proves
#    whether the LAN itself is silent.
python3 - <<'PY'
import socket, concurrent.futures
def probe(h):
    s = socket.socket(); s.settimeout(0.35)
    try:
        s.connect((h, 80)); return h
    except OSError:
        return None
    finally:
        s.close()
hosts = [f"192.168.1.{i}" for i in range(1, 255)]
with concurrent.futures.ThreadPoolExecutor(max_workers=64) as pool:
    print([h for h in pool.map(probe, hosts) if h])
PY
# 2. the host that answers the device API with this token IS the board
curl -s -H "X-Device-Token: $TOKEN" http://<ip>/api/v1/status | head -c 200
```

Then point `VILLAGE_DEVICE_URL` in `.env` at the address found and restart the
backend — it reads that variable once at start-up. A DHCP reservation for the
board's MAC on the router is the permanent fix.

The OTA password is `VILLAGE_OTA_PASSWORD` in
`uc/include/village/secrets.h` (committed to this private repository — never copy
it into this file or a
commit).

**Why plain OTA from this container fails** (read this before retrying):

- This WSL container is behind NAT (`172.29.x`). The board can reach the
  Windows LAN (`192.168.1.x`), but it **cannot connect back to the container**
  to receive the image. `espota` authenticates, then reports
  `No response from device` — that is the callback, not the password.
- The Windows Wi-Fi profile is **Public** with inbound blocked. Even running
  `espota.exe` on Windows, the board's callback is dropped until an inbound
  rule exists for the host port.

**Working recipe** (run the upload from Windows, not from WSL):

1. Build the OTA image:
   ```bash
   cd uc
   /home/ubuntu/.venvs/pio/bin/pio run -e esp32doit-devkit-v1-ota
   ```
2. Copy the image and `espota.exe` somewhere Windows can read (the WSL path
   works too, but a plain Windows folder is easier):
   ```bash
   cp uc/.pio/build/esp32doit-devkit-v1-ota/firmware.bin /mnt/c/Users/<you>/village-firmware.bin
   cp /home/ubuntu/.platformio/packages/framework-arduinoespressif32/tools/espota.exe /mnt/c/Users/<you>/espota.exe
   ```
3. One-time firewall rule (admin) for the callback port. Pick a fixed host
   port so the rule is narrow:
   ```powershell
   netsh advfirewall firewall add rule name="village-ota-3233" dir=in action=allow protocol=TCP localport=3233
   ```
4. From PowerShell/cmd on Windows, with the board's IP and the **Windows**
   host IP:
   ```powershell
   Set-Location C:\Users\<you>
   .\espota.exe -i <board-ip> -p 3232 -I 192.168.1.6 -P 3233 `
     -a "<VILLAGE_OTA_PASSWORD>" -f village-firmware.bin -r
   ```
   Expected output: `Authenticating...OK`, progress, `Result: OK`,
   `Success`.
5. The board reboots. Wait ~10 s, then verify (below).

The equivalent PlatformIO one-liner works from a host on the same LAN with the
firewall allowed:

```bash
cd uc
export VILLAGE_OTA_PASSWORD="$(sed -n 's/.*VILLAGE_OTA_PASSWORD "\(.*\)"/\1/p' include/village/secrets.h)"
/home/ubuntu/.venvs/pio/bin/pio run -e esp32doit-devkit-v1-ota -t upload --upload-port <board-ip>
```

From WSL you can invoke Windows tools with `powershell.exe` / `cmd.exe`
(interop is enabled); that is how the verified upload was run without leaving
the session.

### Verify the board after flashing

The device API needs `X-Device-Token` (same value as `VILLAGE_DEVICE_TOKEN` in
`.env` / `secrets.h`). The state path is **`/api/v1/status`**, not `/state`:

```bash
TOKEN="$(grep -oP 'VILLAGE_DEVICE_TOKEN "\K[^"]+' uc/include/village/secrets.h)"
curl -s -H "X-Device-Token: $TOKEN" http://192.168.1.6/api/v1/status | python3 -m json.tool | head
curl -s -H "X-Device-Token: $TOKEN" http://192.168.1.6/api/v1/config | python3 -m json.tool | head
```

Through the backend (what the dashboard reads):

```bash
curl -s "http://127.0.0.1:8010/api/v1/state?mode=live" | python3 -m json.tool | head
```

Check `firmware`, `config_revision`, and
`status.sensors.light` (`raw`, `brightness`, `valid`, `age_ms`).

### Gotchas that cost time

- **Never `erase_flash` to prove which image is running — it wipes NVS.**  On
  2026-11-15 I erased the chip while chasing a false "the board is running an
  old image" diagnosis (the real answer was that `/api/v1/status` does not carry
  `pin_map`).  The erase threw away the soil and LDR calibration, the lamp
  flags and the config revision, and nothing could restore them: the backend
  logs only "Revision N acknowledged", not the values.  Read `firmware` from
  `/api/v1/health` or `/api/v1/status` instead; the only honest reason to erase
  is a genuinely corrupt flash, and even then say so before doing it.
- **A board with no OTA server cannot be updated remotely, and that is
  self-inflicted.** See the standing rule at the top of this section: build the
  USB image with OTA in it, and check port 3232 straight after flashing.
- **A reflash does not reset the stored config.** It lives in NVS and survives
  the update; `config_revision` stays the same. If a firmware default changed,
  save the config once from Setup (or reset the config) to apply it.
- **The board's IP is DHCP.** `192.168.1.6` is the usual address; confirm from
  the router or the backend's `VILLAGE_DEVICE_URL`.
- **The OTA callback is the hard part.** If `espota` says
  `Authenticating...OK` then `No response from device`, the board cannot reach
  the host: run the upload on the Windows LAN host, use `-I <windows-ip> -P
  <port>`, and add the inbound firewall rule. Do not keep retrying from WSL.
- **`VILLAGE_OTA_PASSWORD` is a secret.** Read it from `secrets.h`; do not
  print it in logs, commits, or this file.
- **Do not run `pio` from the repo root.** `cd uc` first.
- The backend's `device.py` uses `/api/v1/status` and `/api/v1/config`; the
  board does not implement `/api/v1/state` (the backend exposes that path to
  the browser). A bare `curl http://192.168.1.6/api/v1/state` returning
  `unknown endpoint` is expected, not a dead board.

## Bins are indicator LEDs only (2026-11-15)

There is **no waste-level sensing**, and there must not be: no time-of-flight
or ultrasonic rangefinder, no distance, no fill percentage, no "bin full"
alert.  A bin is something a person can see into; three LEDs (organic D21,
plastic D22, paper D23) say which category the camera last recognised.

- **The paper LED is blue now (2026-11-18).**  It was amber (`#e3b04b`, the
  same hex as `--warn`); the board's paper bin now uses a blue LED, so both
  the UI dot (`.bin-led-dot--paper`) and the `WasteBins` picture use
  `#4a90d9`.  Organic stays green `#6cc596`, plastic red `#e05b67`.  The
  `--warn` token is unchanged — that amber still means "warning", which is
  why the paper bin was moved off it.

- **The voice command went too (2026-11-18).** `BIN_STATUS` was the last thing
  claiming a bin reading could be asked for; it is gone from
  `shared/intents.json` (intent, `device_commands` and the `bins` aliases), from
  the help list and from the panel's catalogue.  “bin status” is now an ordinary
  unsupported request.
- Firmware 0.2.0 removed `bins.h`/`tof.h`, `BinState`, `BinConfig`/`BinModel`
  and the VL53L0X dependency.  `/api/v1/status` has no `sensors.bins`, no
  `BIN_*` events and no bin faults; `/api/v1/config` has no `bins` section.
- GPIO **4, 16, 17, 18, 26** are free again and listed in `pins.h` as
  `kFreePins` (a `static_assert` fails if one is also assigned).  11 pins are
  assigned; the pin map is `1.6.0-30pin`.
- The backend records no bin state and raises no bin alert; the dashboard,
  the Sensors page and Sara's narration no longer mention fill.
- Settings now live in NVS as **JSON** (0.2.1), not as a raw `DeviceConfig`
  dump.  The dump was tied to `sizeof(DeviceConfig)`, so adding the solar block
  (2026-11-13) and removing the bin settings (2026-11-15) each made the stored
  bytes unreadable and the next boot silently replaced every calibration with
  defaults.  JSON is self-describing: a missing key keeps its default, so a
  field may come or go without losing the rest.  `revision` is stored beside
  the settings (not inside them) so the optimistic-concurrency check survives a
  reboot.
- If a boot finds no stored configuration it adds a **`CONFIG_DEFAULTS`** event
  ("No saved configuration was found, so defaults are in use…").  A board that
  comes up uncalibrated now says so on the dashboard instead of looking like a
  dead sensor.
- A sensor that is deliberately **not fitted** is not a fault: the light fault
  line only appears when `light.sensor_fitted` is true.

## Soil calibration: the endpoints are stored INVERTED (2026-11-18)

The soil probe was calibrated for the first time on this board today, and the
first save read **0 % in wet soil** — the mapping is not what the Setup page
says it is.

- **`rises_with_moisture` is never persisted.** The flag exists in the C++
  struct (`uc/include/village/core/config.h`) and `soilPercent` honours it, but
  it appears **nowhere in `uc/src/config_json.cpp`** — so the NVS/API config
  never carries it, the Setup checkbox cannot set it, and `GET /config` never
  returns it. Every reading takes the `!rises` branch: `effective = 4095 - raw`.
- **So the two endpoints must be entered in that inverted domain**:
  `dry_raw = 4095 - measured_dry`, `wet_raw = 4095 - measured_wet`. Entering the
  measured values (as the hint tells you to) makes both ends clamp to 0 %.
  Measured today on this wiring (pull-up to 3V3, probe to GND, 10 kΩ):
  **dry 1597 (1.29 V), wet 770 (0.62 V)** → stored **2498 / 3325**, and the
  page then reads **83 % in wet soil**, falling as it dries. Revision 27.
- **`POST /api/v1/calibration/soil` has the same trap** — it stores the body's
  numbers verbatim, and it is the *page* that would have to invert.
- **FIXED, firmware 0.2.8 (OTA'd 2026-11-18).**  The flag is now written and
  read by `config_json.cpp`, so it survives NVS and appears in `/api/v1/config`
  (verified live: `"rises_with_moisture": false` came back after the flash, and
  the board reported `firmware 0.2.8` on a new `boot_id b-d4014bcd`).
  **The mapping is deliberately unchanged** (`effective = 4095 - raw` unless the
  flag is set): the mapping was self-consistent, and the trap was the *page*
  asking for the stored domain.  `pages/Sensors.tsx` now shows and accepts the
  **raw values the operator measures**, converting with the flag
  (`lib/soilEndpoints.ts`, `shownRaw`/`storedRaw`), and the polarity checkbox is
  gone — either wiring works because the mapping uses the sign of the pair.
  So today's endpoints are still `2498 / 3325` on the board but the page shows
  **1597 / 770**, and saving them again is a no-op.  Recalibration was not
  needed, and the board still reads 70 % at raw 1013.
  **Do not "fix" the stored numbers by hand**, and do not change `soilPercent`
  without a recalibration: the stored pair is in the inverted domain.

### The two probes, as left on 2026-11-18

Both are a divider with the **fixed resistor on the 3V3 side and the probe to
GND**, so **wet = lower voltage** on both. Measured that evening:

| probe | dry / out | wet / in | stored |
| --- | --- | --- | --- |
| rain water tank (GPIO 35, 15 kΩ) | **3145 mV** in air | **2760–2800 mV** in water | wet ≤ **2850**, dry ≥ **3000** (rev 24) |
| soil (GPIO 34, 10 kΩ) | **1597** counts (1.29 V) | **770** counts (0.62 V) | **2498 / 3325** (rev 27), reads 70–83 % wet |

The tank's margins are thin (only ~370 mV of swing) because this water conducts
weakly — the probes read ~77 kΩ in it. **A larger series resistor widens the
swing: 47 kΩ gives ~800 mV, 100 kΩ ~1.0 V. A smaller one narrows it** (an
earlier note in this file had that backwards). The soil probe needs no change:
~6.4 kΩ dry and ~2.3 kΩ wet against 10 kΩ is a healthy pair.

The board was disconnected at the end of that session; the app then shows
`connected false` and the kiosk **Offline** until it is back on the Windows
hotspot, which `relay.sh watch` repairs by itself (30 s).

## LDR calibration (this build)

The LM393 module was **replaced by a bare LDR and one pull-up resistor**
(2026-11-15) — the same change the soil probe had.  Wiring:
`3V3 -> resistor -> GPIO 32 -> LDR -> GND`, so the reading **falls** with
light:

- `output_type = analog`, `analog_bright_high = false`
- the pull-up value is not critical (4.7–47 kΩ); this build measures **raw
  800–890 in a lit room**, i.e. a brightness metric of **3200–3300**
  (`metric = 4095 − raw`)
- thresholds are on the **metric**, not the raw: `dark_threshold = 2100` and
  `bright_threshold = 2500`, `stable_ms = 4000`. **Re-measured 2026-11-15 in the
  room the board actually stands in**, because the lamps stayed on with the room
  light on: that room reads **2820–2950 lit** and **1820–1930 with the room light
  off** (dusk, daylight still coming in). The old `bright 2800` sat *inside* the
  lit reading, so it hovered at the boundary, the hysteresis kept the last
  decision ("dark") and the streetlights stayed on. 2100/2500 puts ~400 counts
  of margin either side of both measured states. A hand over the LDR still
  reaches metric ~1536, well under 2100, so covering it still means dark.
  **These numbers are a property of the room, not of the firmware** — a different
  room or a dimmer bulb needs its own two readings before the thresholds mean
  anything (`[net] scan`-style measurement: sample raw with the light on, then
  again with it off, and put the band between them).
- `light.sensor_fitted = true` must be saved or the board reports no brightness
  at all (by design: a floating pin reads plausible noise); `light.installed`
  is the **separate** fact that the five streetlight lamps are wired
- on this build both are now **true** (set 2026-11-15), so Auto drives D13 and
  the "lights not installed" event is gone; soil calibration is still pending

Opposite wiring (LDR to 3.3 V, resistor to GND) needs
`analog_bright_high = true`. See `docs/wiring.md` § "LDR (light sensor)".

**A chip tone is not a style.** `ChipTone` included `live` but `styles.css` had
no `.chip--live`, so every "Live"/"Available"/"Model ready" pill rendered as the
base grey chip while saying the opposite.  `web/frontend/src/components/
chipTones.test.ts` now reads the stylesheet (a CSS import is stubbed under
vitest, so `?raw` asserts nothing) and fails when a tone has no rule.  The same
round also made the solar pill say **Generating** in green only when current
actually flows, and **Not generating** in neutral when the panel reads volts but
no current — a red LED needs ~1.8 V before it conducts, so a dark panel honestly
reads 0 mA.

## Solar panel, measured (2026-11-15)

Panel voltage on **VN (GPIO 39)**, LED junction on **VP (GPIO 36)**, 330 Ω in
series with a red LED, `sense_ohms = 330`. Dark: both taps 142 mV, 0 mA.
Phone torch on the panel for 10 s:

| panel | junction | drop | current | power |
| ---: | ---: | ---: | ---: | ---: |
| 2019 mV | 1827 mV | 192 mV | 0.58 mA | 1.17 mW |

- The junction stopping at **~1.83 V** (red LED Vf) while the panel varied is
  the check that the LED is in the load path and the polarity is right; a
  reversed/open LED makes the junction follow the panel.  **The LED visibly lit
  at 0.58 mA** — dim, but clearly on — which is the human confirmation of the
  same fact.
- The current is small because the cell only reached **2.0 V** under a phone
  torch — `I = (Vpanel − Vf)/330`. The 4.5 mA / 15 mW in the wiring doc is the
  **3.3 V** case, not this one.
- `solar.installed` is now true (it gates nothing in the app; the card reads the
  numbers regardless).
- **Board off, panel lit, verified on the bench (2026-11-15):** USB unplugged
  with a torch on the panel, the LED glowed and the board stayed off — no
  phantom boot, and it came back normally when USB was reconnected.  The 10 kΩ
  taps limit the clamp current to ~0.26 mA each, which is why.

## Voice commands (natural language, 2026-11-15)

Sara understands phrasing, not just exact commands, without any **additional**
language model or cloud call.  Whisper is the only model and it only transcribes;
the meaning is decided by fixed rules.  The pipeline has four separate steps:

1. **transcription** — the browser records a WAV and posts it to
   `POST /api/v1/voice/transcribe`; the local whisper.cpp server returns text.
2. **parsing** — `web/backend/app/intents.py` (`IntentMatcher`) decides what the
   sentence *means*.  Typed text uses the same parser through
   `POST /api/v1/voice/interpret`, so the two paths cannot disagree.
3. **validation/execution** — the panel sends the command through
   `/api/v1/commands` with a **stable request id per utterance**; the firmware's
   command history answers DUPLICATE for a repeated id, so a double event cannot
   move anything twice.  All firmware gates (soil, low water, pump limits, kill
   switch) still apply — speech has no bypass.
4. **response** — pending / done / already / blocked wording from
   `shared/intents.json`; a reply is only "done" after the controller acks.

### The parser is a small grammar, not a phrase list

`shared/intents.json` holds the data: languages, **device aliases**, **on/off/
auto words**, politeness and question markers, negation and correction markers,
the reply wording, and per-intent example phrases (also used by the help list).
`intents.py` applies, in this order:

1. silence → NO_SPEECH;
2. hypothetical/conditional ("what happens if…", "should I…", "can I…") → no action;
3. explicit correction ("actually", "I mean", "rather", "instead") → ambiguous;
4. negation (English before the verb; Malayalam/Hindi anywhere, because they
   negate after it) → NEGATED, nothing sent;
5. two different states ("on… no, off", "on and off") → ambiguous (a question
   like "are the lights on or off?" is a status query instead);
6. one device (more than one → ambiguous); pronouns with no device → ask which;
7. question or status word → the device's status intent, never an action.  A
   polite request is a command, not a question: "Can you turn off the
   streetlights?" and "…ചെയ്യാമോ?" / "…कर सकते हैं?" execute, while "can I /
   should I…" is advice and does not;
8. copula with no imperative ("the lights are off") → statement, never an action;
9. exactly one device + one state → the command in `device_commands`;
10. otherwise fall back to whole-phrase catalogue matching (this is what keeps
    the hand-written Malayalam/Hindi phrases working), then UNKNOWN.

**Every language refuses a sentence with an unaccounted content word**
(`_unaccounted`), so "turn off the lights and open the gate", "വിളക്കുകൾ
അണയ്ക്കുക ഗേറ്റ് തുറക്കുക" and "लाइट बंद करो और गेट खोलो" all send nothing
instead of half of it.  The known-word set is per language, so an unfamiliar
inflected form is refused rather than guessed.

### Replies and exact wording

- unrecognised: “Please ask me to control a supported device or check its status.
  For other help, contact Gram Sahayak.”
- ~~bin fullness~~ — **the command is gone (2026-11-18).**  `BIN_STATUS` used to
  answer “Our model does not measure bin fullness…”, but a catalogue entry is a
  promise that asking does something and this one could only say it cannot.  The
  intent, its `device_commands` row and the `bins` device aliases are removed,
  so “are the bins full” is an ordinary unsupported request.  The bins are what
  they always were: three LEDs lit by the classifier.
- **A whole-phrase match must also cover the words no rule knows (2026-11-18).**
  Removing the bin device exposed it: `_phrase_fallback` accepted the one-word
  phrase “status” inside “bin status”, so the sentence was answered as a
  village-status question while the extra noun was ignored.  A candidate phrase
  now has to contain every token `_unaccounted` reported, and the bare-status
  branch (`status` / `what is happening`) requires the same, so a sentence about
  a thing this build has no reading for is refused rather than re-pointed.
- ambiguous between on and off: “Would you like the lights on or off?”
- statement / hypothetical / negation / disconnected / unconfirmed: in
  `shared/intents.json` under `messages`, translated for all three languages.
- a matched command carries `pending_text`, `done_text` and `already_text`; the
  panel says “already off” **without sending** only when the frame is connected,
  not stale and younger than 5 s.  A cached/stale frame never skips an action.
- one utterance carries one id: the recording's start for speech, the current
  typed text until the box clears for typing.  A retry of that utterance reuses
  it (the controller answers DUPLICATE); a later deliberate repetition is a new
  id and does run.

The parser returns `confidence` as 0.0 or 1.0 only, and the UI no longer shows a
percentage: this is a deterministic allowlist, not a model, and a percentage
would invent a probability.

### Known limits (state them, do not hide them)

- No conversation memory: “it”, “that”, “do the same” ask you to name the device.
- No arbitrary devices: only lights, pump/watering, and the status surfaces.
- The lexicon is conservative; a new synonym that is not in the JSON is treated
  as unsupported rather than guessed.
- Whisper transcription errors are the dominant failure mode in a noisy room;
  the parser cannot recover a word it never received.
- Malayalam/Hindi question detection uses the words (Hindi "क्या" is a word, not
  a suffix); Malayalam verbs can also carry the question suffix, so both are
  checked.  Negation is read by meaning, not by removing words.
- Free-form conversation, questions about the app in general and multi-step
  instructions are out of scope (Help and Sara's topics cover those).

### Adding a phrase or a device

- A new way to say an existing command: one line in that intent's `phrases`, and
  (for the structural path) the word in `devices` / `states`.
- A new device: its aliases in `devices`, a row in `device_commands`, and intents
  with labels/phrases for any actions. No Python change unless the sentence
  shape is new.

### Tests

```bash
cd web/backend && python -m pytest -q tests/test_intents.py   # 19 parser tests
cd web/frontend && npx vitest run src/components/VoicePanel.test.tsx
```

The parser tests are hardware-free; the panel tests mock the API and cover the
typed path, duplicate submission, already-off, disconnected, unconfirmed and a
rejected pump.  The live check is `POST /api/v1/voice/interpret` on the running
app (it needs no microphone), plus one real spoken sentence through Whisper.

## Soil moisture polarity

The soil probe is read as an analogue value on GPIO 34 (D34).  A bare
two-prong probe with a 10 kΩ resistor divider works directly — no LM393
module needed (its digital output was never used).

`SoilConfig` gained `rises_with_moisture` (default **false**, matching the
pull-up wiring: resistor to 3.3 V, probe to GND, raw falls with moisture).
When false, the firmware inverts the raw reading (`4095 - raw`) before
mapping, so calibration endpoints recorded with the opposite wiring still
work.  When true, no inversion is applied.

- `soilPercent()` applies the inversion via the flag.
- The Setup page has a **"The reading rises with moisture"** checkbox
  (ticking it sets the flag true; changing it clears the calibration).
- The simulator mirrors the flag and keeps its raw values inverted.
- `docs/wiring.md` and `docs/calibration.md` document both wirings.

If the soil reading is backwards, flip the checkbox in Setup → Sensors &
Calibration.  The calibration endpoints themselves are preserved.

## Waste classifier

**The repository is the master copy of the exhibit (2026-11-17).**  A fresh
clone on another laptop must run as this one was left, so these are committed
on purpose: `models/piper/` (Sara's voice, 293 MB), `models/waste/` +
`models/waste-resnet50/` (104 MB), `models/whisper/whisper-server`,
`data/village.db`, `data/waste-samples/` (1134 corrected photos — the only copy)
and the credentials `.env` + `uc/include/village/secrets.h`.  It is a **private**
repository: it holds one board's tokens.  **Do not publish it.**

The only thing that cannot be committed is the whisper **weights** —
`ggml-base.bin` is 142 MB and GitHub refuses any file over 100 MB (`small` is
466 MB, `large-v3-turbo` 1.6 GB).  `scripts/download_models.sh` fetches
`ggml-base.bin` on a new machine; `data/waste-captures/` (322 MB of rolling log)
and `data/cache|logs|run` stay ignored too.  `scripts/backup.sh` writes a second
copy — whisper weights, the crop log and a consistent database snapshot — to
another disk, and `docs/backup.md` is the runbook.

`models/waste/` holds the 11-class model trained in
`scripts/waste/`; the recycler classes (glass, metal, textile, leather,
footwear, thermocol, e-waste) all map to **Recycling agent** in the UI with no
bin LED. Medical waste is handled by the manual **Hazardous / medical** button,
not a model class. See `docs/waste-model.md` and `scripts/waste/README.md`.

The current install (2026-11-13, **V12**) was retrained after brown paper,
bottle caps, ball pens, a **car key read as Leather**, a **handkerchief that
never resolved**, a **business card read as Thermocol** and **folded paper** were
misread.
`build_waste_dataset.mjs` assembles the training tree from the bootstrap,
TrashNet's unused `cardboard` folder and Commons photos of caps, pens, paper
bags, foam, key fobs, keys, phones, watches, wallets and sunglasses; the
install repeated the **key-fob photos 6x** and left the phone/watch extras out
of its Ewaste tree (they pulled paper into e-waste). On the same 953 photos
V3 scores **85.6%**, V6 **85.1%**, V8 **86.7%** and V12 **90.9%**; item-level
action accuracy is **89.4% → 90.6% → 91.4% → 94.0%** (bin 91.8% → 87.4% → 86.0%
→ 90.6%, recycler 87.5% → 93.1% → 95.8% → 96.7%) and the 236-photo real-world
probe is **62.3% → 64.8% → 64.0% → 62.7%**. V8 added 20 handkerchief photos to
Textile; V9 added 20 business-card photos to Paper; V12 added 20 more handkerchief
and 20 more business-card photos plus 20 pin photos to Metal. The held-out
results are mixed: handkerchief **4/8 → 1/8 → 1/8 → 3/8**, business card **14/25 →
25/25 → 3/5 → 5/5**, car key **8/8 recycler in every build since V6**, pins
**3/8 Metal**. The pattern is the ceiling of this approach: adding photos of one
object dilutes another, and no single build is best on all three. **V8 is kept
as the backup for handkerchief accuracy; V9 is the best probe build.** The
installed V12 is the best general build (94.0% item action) and fixes business
cards and folded paper, at the cost of two handkerchief photos.
Backups: `models/waste-v8-20261113/`, `models/waste-v6-20261113/` (best probe)
and `models/waste-v3-20261113/` (best bin accuracy); restoring one is copying
four files. `evaluate_waste_model.mjs` reproduces the comparison and
`predict_waste_image.mjs` shows the top classes for one photo.

**The classifier is ResNet50 on the backend now (2026-11-13), not MobileNetV1
in the browser.** Measured on the same 953 held-out photos it is **91.5% exact,
95.5% item action, 91.8% bin, 98.5% recycler and 71.6% on the 236-photo probe**,
against 86.7 / 91.4 / 86.0 / 95.8 / 64.0 for the last MobileNetV1 build. It fixes
the **business card** (25/25, was 14/25) and improves **pins** (4/8, was 3/8); the
handkerchief is the one regression (1/8 against 4/8) and stays hard. The model is
`models/waste-resnet50/model.pt` (~95 MB, committed), loaded by
`web/backend/app/waste_resnet.py` and served by **`POST /api/v1/waste/classify`**
(about 50-85 ms per frame on this CPU, no internet). The browser sends the 224x224
crop as a JPEG data URL; `SortWaste.tsx` no longer imports TensorFlow, and
`@teachablemachine/image` + `@tensorflow/tfjs` were removed from package.json.
Reproduce with `scripts/waste/train_resnet50.py` then `export_resnet50.py`.

**The venue case is an item held in a hand, not an item on a table
(2026-11-13).** The user said so explicitly, and the numbers agreed: on 528
hand-held composites the old checkpoint scored **26.3% item action**, and **252
of 528 frames were read as "Background"** — "not a waste item" while somebody
held one up. The fix is training data, not architecture:
`scripts/waste/make_handheld_set.py` cuts each training object out (u2netp,
offline, **training only**) and composites it into a room photo with a drawn
arm and hand — 15 skin tones, random angle, fingers over the object, optional
sleeve, random scale/rotation/position, plus hand-only negatives.
`train_handheld_head.py` does 30 archive epochs then 18 more on archive +
composites at a small learning rate. Measured through the backend's own HTTP
route: hand-held **26.3% → 63.6%** item action, real probe **74.3% → 76.3%**,
withheld archive **91.1% → 90.5%** (all at JPEG quality 0.85).

**The browser's JPEG quality was worth more than the model** (2026-11-13): the
camera sends `toDataURL('image/jpeg', q)` and q 0.85 cost 4-5 points against
0.92 on every set (hand-held 63.6 → **67.6**, probe 76.3 → **77.6**, archive
90.5 → **91.7**); q 1.00 is no better than 0.92. `SortWaste.tsx` now sends
**0.92** and a component test pins it, so a future payload tidy-up cannot give
the accuracy back. The backend's resize filter is now `BILINEAR` like the
trainer's (it was `LANCZOS`; identical scores, but no train/serve skew). The previous checkpoint is at
`models/waste-resnet50-backup-v13/model.pt`. **The hands are drawn, not
photographed** — ten real photos of a person holding an item are still the
measurement that counts, and `scripts/waste/hand_eval.py` scores whatever model
the backend is serving.

**A venue mistake is now one press away from being training data (2026-11-16).**
Every crop the model judges was already kept (`data/waste-captures/`, ~24k reads
by 2026-11-16) but **unlabelled**, so a venue session could not teach anything.
The result card now offers **Wrong? It was…** (Organic / Plastic / Paper / Keep
it separate); pressing one posts `POST /api/v1/waste/correction` with the crop's
own file name — taken from the `file` field the classify response now returns, so
a correction can never land on "the most recent crop" — and the backend copies it
to `data/waste-samples/<Class>/venue-<stamp>.jpg`, appending
`data/waste-corrections.jsonl`. That tree is what
`train_handheld_head.py --extra-train` reads. `separate` is deliberately **not** a
training class: it is seven different materials, so those frames go to
`Separate/` for a human. `scripts/waste/venue_report.py` reads both logs and
reports reads/day, bin/referral/nothing/undecided shares at the app's own 0.70
and 0.50 bars, the top-class distribution and the said→really-is list; on the
home/office log it is **19.4% bin, 32.3% referral, 15.3% background, 33.0%
undecided**. That is the number a venue session is measured against — the photos
so far are all from home and the office, which is the known generalisation risk.

**A confident wrong answer is fixed with photographs, not with a rule**
(2026-11-13, the user's choice). A handkerchief read as Plastic 0.75 lit the
plastic bin, so a higher bar for bins was measured and **rejected**: 0.80 for the
hand-held path gains 1.3 points but diverts 35 of 528 correct bin items, and on
clean table photos the same bar costs 9.7. Routing is unchanged. The ceramic tea
cup (read Thermocol 0.95) is also left alone — ceramic is not one of the 11
classes and its *action*, hand it to the agent, was already right.

The path for a misread is one command now: photos in
`data/waste-samples/<Class>/` (the class the item **actually** is), then
`train_handheld_head.py --extra-train data/waste-samples`. New photos go into
**training only**, so the withheld set and the probe stay an honest measurement;
an unreadable file is skipped and named. Then export, restart, re-check with
`hand_eval.py`.

**A whole datum can be missing, not just under-represented** (2026-11-15, the
book). A book was refused at Paper 0.66 (four points under the bar) and accepted
at 0.79 on a second, better-lit look. The corpus held **no book at all** — 0 of
24,569 archive views, 0 of 141 Paper composites — and no newspaper or notepad
either; Paper was packaging (bags, brochures, cards, flyers, tissue, cardboard).
Seven venue frames plus 49 curated Commons photos went into
`data/waste-samples/Paper/`, and the served model moved to **71.0% exact / 78.8%
item action** on the 241-photo probe (was 68.5 / 77.6) with every probe class
equal or better. Two things to keep: **135 Commons photos were fetched and 86
discarded** — "newspaper" returns newspaper *offices* and vending boxes,
"notepad" returns Windows Notepad screenshots, "paperback book" returns scans of
typography-specimen grids, and a letter-grid would teach a shortcut that collides
with circuit boards, so a fetched photo is looked at before it is trusted; and
**the trainer's hand-held figure runs ~9 points above `hand_eval.py`'s** (53.6
in-process vs 45.7 over HTTP) because q0.92 JPEG hits a 224-px composite at the
exact resolution the model reads — that gap predates this build (52.9 vs 43.6),
so compare in-process with in-process and live with live. Checkpoint before this
change: `models/waste-resnet50-backup-v14/`.

**The frame can be the whole fault, and more photos of the object will not fix
it** (2026-11-15, the scrunchie). A cloth scrunchie was read Thermocol **0.89**
and accepted. The five saved frames are a child's face, a hand and a blown-out
window with the scrunchie a fifth of the picture — and `SortWaste.tsx` already
says this is a limit it cannot detect ("the person is the change and they are in
the middle"). Cropped to the item alone the same frame gives a **different**
answer: Leather 0.50, Paper 0.14, Plastic 0.13, Textile 0.09. So the confident
Thermocol was the room; and the item was not Textile either, because Textile held
only flat white cloth — 40 handkerchiefs, 30 napkins, 15 white cotton — with no
patterned or bunched fabric at all. **Growing Textile 88 → 131 (10 scrunchie /
hair-tie photos + 33 printed/knitted fabric, curated out of 160 fetched — 117
discarded: athletes, buildings, fossils, a man in a suit, bow ties, printing
blocks, looms, a bat, a tunnel) cost the probe 71.0 → 68.5 exact with Plastic
−3**, and moved the scrunchie frames not at all (Thermocol 0.72–0.89 →
0.65–0.85). It was **rejected and reverted** — model and samples tree back to
v15/88. The lesson worth keeping: **before adding photos, check what the
classifier was actually shown.** A scene crop makes the data irrelevant, and an
item-only crop upscaled from ~100 px is mush. What works is a clean photo of the
item filling the guide square with nobody behind it, and (offered, not built) a
guard that declines when the changed region covers most of the frame.

**The "What it is reading" box was blank, and a 60% bottle was called strong
(2026-11-16).** Two separate faults, both reported together as "the box is white
and it says plastic 60% but never decides":

- The box was painted **only on some of the ways out of `focusInput`** (not when
  the item was outside the guide square, not when focus was off), and its canvas
  had `background: #fff` — so a path that returned early left a white square
  captioned "What it is reading", which looks exactly like the model being handed
  a white plate. `drawPreview()` is now the one place it is painted, every path
  calls it, the background is neutral, and a 500 ms refresh keeps it showing the
  camera between reads.
- It **hid the reference to which bar was missed**, and 60% *was* shown because
  `strong` (which is what reveals the per-class list) used the generic 50%
  referral bar, while a bin needs `BIN_CONFIDENCE` 70%. `strong` and the row
  highlight now use `confidenceBar(confidence, guideFor(...))` — the bar that
  would actually accept that class — and the unsure line says *"A bin needs 70%
  on 2 frames in a row"*. **Do not re-name the material in that line**: naming it
  at 59% is what the venue read as "still thermocol".

The real bottle that prompted it: four saved captures read Plastic 0.7058 /
0.5152 / 0.3133 with Glass 0.13–0.28 behind them — a white/clear bottle splits
Plastic/Glass, and 0.70 twice in a row never happened. That is the model's honest
uncertainty, not a threshold bug: a bin must not be guessed. `waste_confidence`
cannot lower a bin's bar (it is a floor of 0.70 by design), so the fix for a
bottle is framing and light, not settings.

**Follow-up the same day: the not-sure line no longer names a material.** The
venue reported "still thermocol" three times while the press had chosen **no**
bin (Thermocol 0.59/0.59/0.40, mean 0.53 — under the 0.70 bar); what was being
read was the live preview line *"Best guess Thermocol at 59%"*. That is now
*"Not sure what this is — hold one item on its own, filling the square, and keep
still."* — no material, because the near-guess is a property of the crop, not of
the item. The same frame cropped to the scrunchie alone reads **Textile 0.35**
(0.39 tighter); grouped the way the app decides a referral, the seven recycler
materials sum to **0.64**, above the **0.50** referral bar, so **it is accepted
as Textile**. Same frame, same model, two crops: cloth or Thermocol 0.74. A bin
is held to 0.70 but a *referral* to 0.50, which is why a 0.35 top class is still
a decided answer. **The crop is the fix, not the model.**

**A class can be a junk drawer, and Thermocol was one** (2026-11-15). A frosted
plastic box read **Thermocol 0.95**, a scrunchie 0.74, corrugated card 0.45. The
class held 218 files but only **112 unique** (106 exact duplicates — a silent 2×
weight) and only ~**25 were thermocol**: the rest were **food photographs** (the
foam trays were shot *containing* curry, noodles, roast meat, coffee), **street
scenes and landscapes** (roads, rivers, rooftops, corridors, a bridge), **people**
(crowds, festivals, athletes), plus a circuit board, a laptop, an AMD chip, docs
and a truck. It had learned "a plate" and "a place", so anything pale or
scene-like came back Thermocol. Cleaned 218 → **25** genuine, composites rebuilt
150 → 96 from the clean 25, val deduplicated, and **50 curated foam photos**
added (out of 198 fetched: the searches return chemical diagrams, buildings,
tomatoes, a fire extinguisher). Live on the same 241-photo probe: exact **71.0 →
72.2%**, item action **78.8 → 80.5%**, Thermocol recall unchanged at **15/27**;
the box went 0.95 → 0.36 and the scrunchie 0.74 → 0.20. **Do not delete the junk
without replacing the photos** — an intermediate build at 25 photos dropped
Thermocol recall to 7/27 and the probe to 75.9%; that build was rejected. The
hand-held figure is no longer like-for-like (that set lost its junk composites:
129 photos, not 140).


**The room is learned, so it cannot be classified as an item** (2026-11-14).
Reported from the venue: *"Sara classified the background as textile and ignored
the key fob held in hand."* With no stored backdrop the page had no reference,
so it classified the wall. `web/frontend/src/lib/sceneMemory.ts` keeps a
slowly-updated average of the frame as the reference: the first ~8 frames are
the room (nothing is classified, the page says so), a door or a lamp drifts in,
the memory **freezes while an item is shown** so a held item is not absorbed,
and a moved camera relearns instead of classifying the blur. The crop and the
paint-out are the existing measured subtraction path — the learned room is just
a background that maintains itself.

**A skin-colour "is a hand present?" gate was measured and rejected first**: it
fired on **46 of 60** hand-free product photos, so it would not have stopped the
room. Do not re-add a skin gate without new evidence.

The empty table is still available as an **optional aid** (**Set background**)
for a fixed booth; the copy no longer tells the operator to clear a table they
do not have.

The Sort Waste camera can still **focus on a fixed table and paint it out**:
`web/frontend/src/lib/focus.ts` diffs each frame against **up to three**
empty-scene snapshots (`diffBoxMulti`), crops the changed box, and then
`objectMask` replaces every pixel **inside that crop that still matches the
stored empty scene** with a plain white plate — the same picture a cutout site
produces, by subtraction instead of by a model. `SortWaste.tsx` exposes **Set
background / Add background**, **Clear backgrounds** and **Focus on the
object**, and `lib/backgroundStore.ts` keeps the snapshots in `localStorage` so
they survive a reload until cleared. An unchanged scene is reported as “Not a
waste item” without asking the model. After a confirmed item the camera **stays
on**: removing the item re-arms the stabilizer and the next item is classified
without pressing Start Camera. The geometry has **21** unit tests (weighted-middle
crop, the edge-touch hand warning, and the four ways the mask can go wrong),
storage 5, and the controls/re-arming/the drawing order are component tested;
the live camera path is not exercised in this container (no webcam), so confirm
it in a browser at the exhibition/home table.

**An AI background remover was measured and rejected — do not re-add one
without new evidence.** On 222 scenes (a real object photo pasted onto a real
room photo) item-level action accuracy is **8.6%** whole frame, **32.9%** with
the crop alone, **52.7%** with a subject-cutout model (`u2net`) inside the crop,
and **about 60%** with the stored-scene subtraction. Run on the whole frame the
cutout keeps the largest salient object — the **furniture** — and deleted the
item in the test scenes; on the eight car-key photos it made the black plastic
shell semi-transparent (`u2netp`) or left holes (`u2net`), and it costs
4.4–168 MB plus 0.26–0.51 s per photo against a few milliseconds for the
subtraction. The subtraction also cannot make the picture emptier than the crop
already was: a moved camera makes everything differ (whole crop kept) and a mask
keeping under 2% is refused, both falling back to the plain crop.

The confidence is **action-level**: `lib/wasteActions.ts` adds the seven
recycler probabilities, so Ewaste 45% + Metal 35% is accepted as 80% recycling
and named by the stronger material. A bin still has to win on its own. This is
what stops a car-key fob split between Ewaste and Metal sitting on "not sure".

**A local vision model is not an option on this machine (measured 2026-11-19).**
The user asked whether one could replace the classifier. `SmolVLM-256M-Instruct`
(0.5 GB, native in transformers 5.22, no custom code) loaded in **73 s** and then
took **24 s per 224-px photo** on this CPU — no GPU, 8 cores, 9 GB free — and its
answers on the venue's own frames were `Box.` / `Cord.` / `Rock.` / `Bowl.` /
`Bolt.` / `Snowboard.` for a remote, a water pump, cardboard, tape, a solder spool
and the remote again. A 2B-class model (moondream2, Qwen2.5-VL-3B) would be
minutes per item. **Do not propose a local VLM for the exhibit again.** A *hosted*
vision model is a different trade (1–3 s, a key, internet at the venue, the photo
leaving the laptop) and it is the user's call; it would go behind
`VILLAGE_VISION_*`, off by default, with the local answer as the fallback.

**OpenCode Go's API is OpenAI-compatible, DeepSeek V4.1 Flash accepts images — and
the key on this machine has expired (measured 2026-11-19).**  The user asked
whether the app could sort waste with the key they use in OpenCode, so this was
taken as far as the credential allows:

- **Where it is:** `models.dev/api.json` lists `opencode-go` with
  `api: https://opencode.ai/inference/go/v1`, npm `@ai-sdk/openai-compatible`,
  env `OPENCODE_API_KEY`.  The console's own docs print the same base URL, and
  `…/inference/go/openai/v1` answers identically.
- **The model can see:** in the same metadata `deepseek-v4.1-flash` is
  `attachment: true`, input `text + image`, $0.15 / $0.60 per 1M tokens, **0-day
  retention**.  A 224-px crop is ~380 tokens, so a classification is a fraction
  of a cent.
- **The client gate is documented, not a mystery:** identify with your own user
  agent and send a stable `x-opencode-session` per conversation.  Measured: a
  `python-urllib` UA gets Cloudflare **403 `error code: 1010`**, and no session
  header gets **400 `MissingSessionID`**.  With both, the request reaches auth.
- **The blocker:** `~/.local/share/opencode/auth.json` holds one `sk-…` key for
  both `opencode` and `opencode-go`, and every path — `/go/v1`, `/go/openai/v1`,
  `/zen/v1` — answers **401 `api_key_expired`**.  So **no accuracy could be
  measured**; a fresh key from `opencode.ai/console/account#api-keys` is what
  unblocks it.
- **A caveat worth stating before it is wired in:** the Go docs say the plan is
  "designed for OpenCode and other coding agents that produce similar types of
  requests", with traffic monitored for abuse.  Sending item photos is not
  coding traffic, and that is the user's call to make, not a detail to discover
  later.

The same day's other attempts, all measured, all unusable: Kilo's free vision
model `nvidia/nemotron-3.5-super-vl:free` answered **2/6** on the venue's frames
at **8–42 s** per photo (a reasoning model that spends the budget thinking
before naming anything), and Kilo's paid `deepseek/deepseek-v4-flash-vision-exp`
answers **402 credits required**.  The local VLM note above closes the third
path.  **If a hosted vision model is wired in, it belongs behind
`VILLAGE_VISION_*`, off by default, with the local answer as the fallback and the
panel's privacy line saying the picture leaves the laptop.**

**A hosted vision model was measured against the classifier on the same photos,
and it is worse (2026-11-19).**  With a fresh key pasted into `.env`
(`VILLAGE_VISION_*`, base `https://opencode.ai/inference/go/v1`,
`deepseek-v4.1-flash`, own UA + a stable `x-opencode-session`), the venue's six
frames came back **4/6** at **5–12 s** each: it got the **remote** and the
**water pump** right — both of which the classifier missed — read the cardboard
as `bread = Organic`, and answered nothing on one frame even at 700 tokens (a
reasoning model, and the thinking can eat the budget).

Scored head-to-head on **41 photos sampled from the 236-photo probe**, same 224
crops at JPEG 0.92, same prompt:

| | exact | item-action |
| --- | ---: | ---: |
| local ResNet50 | **70.7 %** | **85.4 %** |
| deepseek-v4.1-flash | 43.9 % | 58.5 % |

and on the 23 of those where the local model was under its 0.70 bar, local was
still better (15 right against 12).  The reason is what the labels *are*: the
probe's classes are **materials** (Glass, Metal, Thermocol, Plastic) while a
vision model names **objects** — it beat the classifier on Metal (3/6 against
0/6) and lost on Glass, Leather, Thermocol and Plastic.  **So a vision model must
not be the live classifier, and a "second opinion" fallback is not justified by
this measurement either.**  Its honest use is as a **labeller for training
data** — it read the remote and the pump correctly, which is exactly the job the
venue's own frames need — and that is a script, not a runtime path.

**`scripts/waste/label_captures.py` proposes a label per take, and promotes
nothing (2026-11-19).**  It groups the saved captures into takes (`--since`,
`--gap` — a take is one item), asks the vision model to **name the object**,
prints `class · object` for each take with a numbered contact sheet, and stops
there.  The operator strikes out what is wrong and `promote_captures.py` files
what is left.  That division is the measurement: naming an object is the vision
model's strength, and the class is the part it gets wrong (43.9 % exact).
- **Use it on a fresh session, not on the archive.**  The first run over the only
  *real* venue session (18 Nov, `--since 2026-11-18T14:55`) found **7 takes**: a
  pipe (Plastic), a glue bottle (Plastic), the cardboard piece — which the model
  called `bread = Organic` while the operator says Paper — the remote
  (`Ewaste`, right), a pen (Plastic), a pencil (`Organic`, wrong) and one it
  could not answer.
- **The 40 takes from 13–15 Nov in the same log are NOT venue items** — they are
  the hand-held **evaluation set**: archive photos (high heels on a wooden floor,
  a bag, a pamphlet, a plate of food) and composites with a **drawn arm and
  hand**, pushed through `/waste/classify` by `hand_eval.py`, which is what saves
  a crop for every frame it scores.  Promoting them would train on the test set.
  A take that is only the bare red base is the other trap: the local model calls
  it `Paper 0.95` and the vision model invents `Baseball` / `Red high heel`.

**CLIP / SigLIP zero-shot was tried before and rejected — do not re-propose it.**
The user says so explicitly (2026-11-19). It is *not* in this file: the AI paths
recorded here are the `u2net` background remover above and the browser MobileNet
that ResNet50 replaced. Either it was tried in a session that did not write it
down, or it is being remembered as one of those two — either way it counts as
rejected, and the local options are exhausted until new evidence exists.

**The focus plate's colour is not why it reads as Paper (measured 2026-11-19).**
The operator set the background on a **white sheet**, placed the item on it, and
it was still called Paper. Recolouring the plate on six of those saved captures:
white → `Paper 0.57`, grey → `Paper 0.51`, red → `Paper 0.58` (one frame did move
to `Ewaste 0.28` with grey). So the cue is the **clean, flat, bright field
itself**, not its colour: the same remote on the red table reads `Plastic 0.45`,
and the model's Paper class is largely "a flat rectangular thing centred on a
plain background". Consequence for the venue: **do not use focus on a sheet** —
the red base, with the item filling the square, is the better condition, and the
`objectMask` white plate (which is why `focus.ts` warns that "a plain white
224x224 square is Paper 0.69") should be left unused in front of the bins.
