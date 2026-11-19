# Languages: how speech in, speech out and "translation" actually work

A brief for a reviewing agent. It describes the three languages the exhibit
speaks — **English, Hindi, Malayalam** — end to end: what hears a sentence, what
decides what it means, what says the answer, and where the words in each language
come from. Read `docs/waste-approach.md` for the waste page itself; this file is
about the language layer that the waste page, Sara's panel and the voice commands
all share.

Everything below is a path in the repository, a measured number, or an explicit
decision. Where something is an assumption it says so.

---

## 1. The one-minute version

1. The visitor records **one sentence** in the language chosen on screen.
2. That recording is transcribed **in that language, by a model chosen for that
   language** — never auto-detected, never sent to the cloud.
3. The transcript is parsed by a **deterministic grammar** (a small rule set over
   a vocabulary file, not a language model), so a sentence either maps to a known
   command/question or is refused.
4. The reply is a **hand-written sentence per language** from one table; Sara
   speaks it with a **local neural voice** for that language.
5. There is **no machine translation anywhere in the running app**. "Translation"
   here means a three-column message catalogue written by a person, plus a parser
   that has vocabulary in all three languages.

That last point is the most important thing for a reviewer to hold on to: nothing
at runtime translates one language into another, so a sentence that is not in a
table cannot be invented in another language. It falls back to English, or is
refused.

---

## 2. Speech in — which model hears which language

Recording, validation and routing live in `web/backend/app/voice.py` and the
`/api/v1/voice/transcribe` route in `main.py`.

**The language is always sent, never inferred.** `request_fields(language)`
sends `language=<code>` to whisper.cpp. Measured 2026-11-18: the same Malayalam
clip answers "Vila Google Cut Tikuga" with `language=en`, and a request using the
field name `lang=ml` is ignored and falls back to auto-detection. The page always
posts the language it is set to.

| language | model | where | measured |
| --- | --- | --- | --- |
| English `en` | `ggml-base.bin` (multilingual) | whisper.cpp on `:8181` | ~1.1 s per command |
| Hindi `hi` | `ggml-small.bin` (multilingual) | **second** whisper.cpp server on `:8182`, 4 threads | 5–7 s per command |
| Malayalam `ml` | `kavyamanohar/whisper-small-malayalam` (fine-tune, ~1 GB) | in-process on the laptop, `web/backend/app/ml_asr.py` | 2.5–2.9 s per sentence, 6/6 on the catalogue |

- **Why Hindi has its own server:** `base` writes "राट बंद करो" for "लाइट बंद करो"
  and "बाटाटू" for "लाइट ऑटो"; `small` writes "लाइट बंद करो।" and "लाइट अटो". A
  second `whisper-server` is started by `scripts/whisper.sh`
  (`VILLAGE_WHISPER_MODEL_HI`, `VILLAGE_WHISPER_URL_HI`), with
  `VILLAGE_WHISPER_THREADS_HI=4` so the two servers do not both claim all eight
  cores. **If that server is missing, Hindi falls back to the main one** — slower
  to be wrong rather than refusing to listen.
- **Why Malayalam is a different engine:** the multilingual `ggml-base` cannot
  write Malayalam. It hears the sentence and spells the sounds in Tamil,
  Devanagari or Arabic letters (measured: **2/6** catalogue sentences parse).
  The fine-tune writes Malayalam script and parses **6/6**. Any failure in
  `ml_asr` falls back to whisper.cpp, because a missing model must never stop the
  exhibit listening.
- **Decoder prompts are per language, and they are not symmetrical** (all in
  `voice.py` / `ml_asr.py`):
  - **English** gets whole phrases ("Lights on. Lights off. … Stop irrigation.
    Automatic.") — this fixed `Stop Illusion!` → `Stop irrigation.`,
    `BOM status!` → `Pump status.`, `Lead status.` → `Lights status.` on the same
    base model with no extra latency. The list deliberately has **no** soil,
    water or village phrases: adding them turned a music clip into
    "Water status.", and `[Music]` must stay noise.
  - **Hindi** gets whole phrases too, because a bare word list still lost the
    device ("लाइट बंद करो" → "राट बंद करो").
  - **Malayalam gets no prompt from `voice.py`, and its own short prompt in
    `ml_asr.py`.** The multilingual prompt hurts Malayalam (Whisper names the
    language with the *Devanagari* token, so a Malayalam prompt pulls the decoder
    toward the wrong tokens); the fine-tune has a six-phrase prompt that settles
    its spelling and must stay short — a longer one produced Persian/Tamil output.
- **Which server answered is recorded.** `/transcribe` returns `engine`
  (`whisper` or `malayalam-asr`) and the parser's result; the page shows neither
  to a visitor.

**Refusals happen before the model is asked**, where they can be honest:
`wav_info` rejects a clip of **≤ 0.15 s** as `NO_SPEECH`, a clip longer than
`VILLAGE_VOICE_MAX_SECONDS` (12 s) with its own message, and a payload over
`VILLAGE_VOICE_MAX_BYTES` (5 MB). On the page, `peakLevel` (threshold `0.02`)
refuses a recording that never moved, and `usableTranscript` refuses a transcript
with no Latin or Indic character (kana/Han/Hangul/Thai/Cyrillic are what the
model invents from near-silence). A **sister script is deliberately usable** —
Tamil letters for Malayalam go through `phonetics.py`'s fixed Unicode shift — so
that path still runs the command.

---

## 3. Understanding — a grammar, not a translator

`web/backend/app/intents.py` (`IntentMatcher`) is the only thing that decides
what a sentence *means*, and it is the same code for typed text
(`/api/v1/voice/interpret`) and for speech (`/transcribe` → same matcher), so the
two paths cannot disagree.

- Vocabulary lives in **`shared/intents.json`**: device aliases, on/off/auto
  words, question and negation markers, politeness, correction words, the reply
  wording, and per-intent example phrases — each in `en`, `hi`, `ml`.
- The matcher is a small ordered rule set (silence → hypothetical → correction →
  negation → two states → device → question/status → copula → one device + one
  state → catalogue phrase → otherwise refuse). It never guesses: a content word
  the language's vocabulary does not know refuses the whole sentence.
- `phonetics.py` romanises each script (with varga merging and a Tamil→Malayalam
  shift) so the same word can be matched however the model spelled it. This is
  what makes "വിളക്കുകൾ"/"விலக்குகள்" and the model's own misspellings meet.
- **`shared/intents.json` is the translation for commands.** Every reply,
  confirmation and refusal has `done_text` / `already_text` / `pending_text` in
  all three languages, next to the intent it belongs to.

The parser's confidence is **0.0 or 1.0 only** — it is a deterministic allowlist,
not a model, and the UI never shows a percentage.

---

## 4. Speech out — one speaker family, three languages

Text to speech is local: **Piper** (VITS), invoked by
`web/backend/app/tts.py` from `POST /api/v1/voice/speak`, which answers a WAV.
The browser page (`web/frontend/src/lib/speech.ts`) calls that route and plays
the audio; it never uses a cloud TTS.

| language | voice | notes |
| --- | --- | --- |
| English | `en_US-lessac-medium` ("sara") or `en_IN-spicor-medium` ("indian") | Indian accent is the exhibit default (a server setting, `english_voice`); if the Indian file is missing the request falls back to Sara's, so a request can never silence her |
| Hindi | `hi_IN-priyamvada-medium` | same speaker family as Sara |
| Malayalam | `ml_IN-meera-medium` | same speaker family |

- All medium models at 22,050 Hz, chosen so the three sound like one speaker.
- **Synthesis timing** is `length_scale` (Piper's inverse rate); the page maps its
  `rate` (0.98 default) to it. Output is **cached by (language, voice, scale,
  text)**, so a repeated sentence is served from disk.
- **Speech is not always the on-screen text**: `spokenText()` rewrites two English
  words for pronunciation only — `Sara → Sahra` (the English phonemiser reads
  "Sara" as /ˈsɛrə/, the American name) and a **sentence-final** `you → yoo`
  (an unstressed final pronoun measured 140 ms / 13.3 % of the sentence peak).
  The screen keeps the written spelling in both cases.
- **Fallback order is deliberate.** Before the first user gesture an `<audio>`
  element cannot start, so the browser's own voice is tried first in exactly that
  case; after a tap, Piper is tried for **every** language, and the browser voice
  is only the fallback for a machine without the models. If Piper produced audio
  but playback was refused, the page retries once and then stays silent rather
  than switching accent mid-sentence (reported as "one line came out in a weird
  accent").
- A late synthesis is inert: every call takes a ticket and stops whatever is
  playing, so two replies cannot talk over each other.

---

## 5. "Translation" — one table, three columns, English as the fallback

`web/frontend/src/lib/messages.ts` holds every visitor-facing sentence as
`'key': [en, hi, ml]`; `translate.ts` resolves a key for the chosen language and
**falls back to English** (column 0) when a translation is missing, so a gap is
never a blank screen or a raw key. `messages.test.ts` fails the build when:

- a key lacks a language or has an empty one;
- the three languages disagree about which `{placeholders}` a key takes;
- a sentence would be displayed as its raw key.

Five rules make this hold together:

1. **Whole sentences, never glued fragments.** Word order differs between the
   three languages, so `page.soilWithValue` is `'Soil: {state} · {percent}'`, not
   three pieces concatenated in the component.
2. **Routing never reads translated text.** `wasteGuide.guideFor()` and
   `wasteDecision` decide from stable English class labels and return message
   **keys**; components translate. A Hindi page cannot send an item to a
   different bin.
3. **Numbers and units are untouched** (330 Ω, 1.8 V, mA, mW, %) — a test asserts
   the measured figures survive translation.
4. **One language for the whole app.** `voiceUi` holds it; the selector, the
   panel, the page and Sara's voice all read the same state, and `<html lang>` is
   set from it. Loading a stored value is validated (`isLang`), never trusted.
5. **A request finishes in the language it began in.** The voice panel captures
   the language when recording starts and threads it through transcription, the
   reply template and the spoken reply, so changing the selector mid-sentence
   cannot re-read an utterance.

**The language names are written in their own script** (English · हिन्दी ·
മലയാളം) so a visitor who cannot read English can still find their own.

**Operator pages stay English on purpose** (Setup, Sensors, About, Admin,
What Happened, Help). A visitor never sees them, and translating them would
double the surface a maintainer must keep correct. The firmware's own `reason`
strings and backend error text also stay English; the page shows a translated
sentence in their place where one exists.

---

## 6. The two languages in the voice panel

- **Sara's reply is built from the parser's localized text**, not from the
  controller's English reason. A Malayalam command is confirmed in Malayalam
  (`done_text`), never by an English sentence read with the Malayalam voice.
- **A refusal is shown and spoken in the visitor's language** (`reason.<CODE>`
  keys in `messages.ts`); the English detail is printed **only** when this build
  has no translation for the code, so a missing key is visible rather than silent.
- Status questions are answered **from the live frame** in the visitor's language
  (`lib/lia.ts`), and the same sentences narrate the dashboard, so the panel and
  the page cannot disagree.

---

## 7. What is verified, and how

| claim | evidence |
| --- | --- |
| the language is sent, not detected | `voice.py::request_fields`; test pins the field; measured with `lang=` ignored |
| Hindi is served by its own server, with fallback | `scripts/whisper.sh` starts both; `voice.py` falls back when the second is unreachable |
| Malayalam is read by the fine-tune and falls back | `tests/test_ml_asr.py` pins availability, routing and fallback without loading the model |
| each language's examples parse | `tests/test_voice_examples.py` sends every sentence the panel shows through the real `IntentMatcher` |
| the message table is complete | `messages.test.ts` (three translations, identical placeholders, no raw keys, English fallback) |
| the panel's own words are complete | `voiceCopy.test.ts` |
| Piper has a voice per language | `/api/v1/voice/readiness` reports `languages` and `english_voices`; live: `Piper is ready for en, hi, ml`, `[sara, indian]` |

**Not verifiable here:** how a *new* speaker sounds, and recognition of an accent
or dialect this laptop has not recorded. The exhibit keeps the last
`VILLAGE_VOICE_CLIPS` recordings (100, ≤ 64 MB) with a JSON sidecar, and
`scripts/voice_replay.py` re-runs them, which is how every vocabulary fix in this
project was made.

---

## 8. Invariants — do not change these without measuring

1. **Never auto-detect the language**; the page always sends the chosen one.
2. **Never send audio or text to a cloud service.** STT and TTS are local; only
   the waste page's naming call leaves the laptop, and that is a picture, not
   speech.
3. **One prompt policy per language** (English/Hindi phrases, Malayalam none from
   whisper.cpp, short in the fine-tune). A prompt is a decoder prior, not a
   friendly hint: it can invent a command out of music.
4. **A missing model falls back, never fails**: Hindi → main whisper server,
   Malayalam → whisper.cpp, English voice → Sara's own model.
5. **Fixed vocabulary beats guessing.** An unknown content word refuses the
   sentence; it is never mapped onto the nearest command.
6. **Never show a raw key or a percentage**, and never speak the controller's
   English reason instead of the translated sentence.
7. **Translations are hand-written.** Do not add a machine-translation call, and
   do not "fill in" a missing language at runtime.
8. **The UI language and Sara's language are one setting**, not two.

---

## 9. File map

| path | what it is |
| --- | --- |
| `web/backend/app/voice.py` | whisper.cpp client: per-language fields, prompts, Hindi routing and fallback |
| `web/backend/app/ml_asr.py` | the Malayalam fine-tune (lazy load, prompt, fallback) |
| `web/backend/app/tts.py` | Piper: voice per language, English variants, cache |
| `web/backend/app/voice_clips.py` | the bounded recording store used to diagnose wording |
| `web/backend/app/intents.py`, `phonetics.py` | the grammar and the romaniser |
| `shared/intents.json` | command vocabulary and replies in en/hi/ml |
| `web/frontend/src/lib/speech.ts` | record/play, `spokenText`, device fallback order |
| `web/frontend/src/lib/messages.ts`, `translate.ts`, `lang.ts`, `i18n.ts` | the three-column table, resolver, codes, `useT` |
| `web/frontend/src/lib/voiceUi.tsx` | the one language state (page + panel + voice), `<html lang>` |
| `web/frontend/src/lib/lia.ts` | localized narration for the dashboard and status questions |
| `scripts/whisper.sh` | starts one whisper-server per model, with thread budgets |
| `scripts/voice_replay.py` | replays stored transcripts after a model or vocabulary change |
