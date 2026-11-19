# Prompt for the waste-page reviewer (second pass)

Copy everything between the lines into your reviewing agent.

---

You are reviewing the waste-sorting page of a village exhibition app (FastAPI +
React + ESP32). Your previous review raised nine points; this asks you to review
**the current state**, not to re-raise decisions that have been settled by the
operator or by measurement.

## Read first

- `docs/waste-approach.md` — the handoff brief (pipeline, decision rules, both
  models, teaching, measurements, retrain commands, invariants, §15 table of what
  is verified vs new).
- `web/frontend/src/pages/SortWaste.tsx` — one press, both calls, decision,
  speech, lamp, clear.
- `web/frontend/src/lib/wasteDecision.ts`, `wasteTiming.ts`, `messages.ts`
- `web/backend/app/vision.py`, `waste_resnet.py`, `main.py` (`/waste/*`),
  `simulator.py` (the waste indicator and `CLEAR_WASTE`), `protocol.py`
- `uc/include/village/core/waste.h`, `uc/src/api.cpp` (`INDICATE_WASTE`,
  `CLEAR_WASTE`), `uc/test/test_waste_commands.cpp`
- `web/backend/tests/test_api.py` (waste tests), `tests/test_waste_vision.py`
- `web/frontend/src/pages/SortWaste.test.tsx`

## What was done in response to your nine points

1. **Clear the previous bin LED — implemented, end to end.**
   Firmware 0.2.9 adds `WasteIndicator::clear()` and a `CLEAR_WASTE` command
   (`WASTE_INDICATOR_CLEARED`); the existing `indicate_ms` auto-off is untouched.
   `POST /api/v1/waste/clear` sends it and reports the board's own acknowledgement
   (`cleared`, `confirmed`, `ack`, `note`) instead of assuming one; an offline
   controller answers `cleared: false` and the check still runs. The page sends it
   at the start of every check, **awaits it before that check's lamp command**, and
   `checkSeq` is now tested *before* sending a lamp, so an older press cannot send
   one. The simulator implements the command, so Simulation matches Live.
   **The OTA image is built and its OTA marker verified; the board was not
   reachable, so this one command still needs a press on the board.** That is the
   only hardware item outstanding.
2. **Unusable name → local fallback.** `"container"` has no special-care cue, no
   object route and no material word, so `decide()` reaches the classifier's own
   thresholds (0.70 bin / 0.50 material). Documented and pinned by a test that
   asserts `source: 'local'`, the bin and the payload.
3. **Empty scene vs naming failure.** `vision.identify` returns `empty: true` when
   the model literally answered "nothing" (and the cache keeps that flag);
   `decide({itemEmpty})` returns `status: 'nothing'` **before** the classifier
   branch; the page shows its own "Nothing to sort" block with **no bin, no lamp,
   no recognition record and no training crop**. A refusal ("I cannot tell") and
   `unknown` are deliberately *not* empty — they are unusable and fall back.
4. **Timeouts aligned with the chain.** Measured on this laptop: Workers AI
   1.6–2.0 s (4.7 s cold after a restart), OpenCode Go / DeepSeek 8.1 s, 10.2 s and
   0.9 s. Backend: 8 s per Workers AI attempt, 12 s for the last resort, 14 s for
   the whole chain (`VILLAGE_VISION_TIMEOUT_SECS`, `…_TIMEOUT_LAST_SECS`,
   `…_TOTAL_SECS`); an attempt that cannot finish in the remaining budget is not
   started. Page: 15 s (`web/frontend/src/lib/wasteTiming.ts`). Late names still
   appear only in Model details and never change the answer, speech or lamp.
5. **Documentation corrected.** "lights the bin indicator" (the LED, not the bin);
   no claim that model disagreement causes refusal; hosted-name routing and local
   fallback thresholds stated as two separate regimes; human involvement described
   as **operator supervision with corrections when needed** ("silence means no
   error was reported"); collecting a photo is explicitly *not* model learning;
   the duplicated invariant number is fixed; the operator's already-verified LED
   selection is recorded; §15 lists verified vs new.

Additionally, after that pass: the bin lamp's duration is now an explicit rule —
`WASTE_LAMP_MS = 8000` is what `INDICATE_WASTE` sends, the board's own timer ends
it, and both a backend test (still lit at 7 s, out at 8 s after moving the
simulator clock) and a firmware test (on at 7999 ms, off at 8000 ms) pin it.
`CLEAR_WASTE` is only the *early* clear for a check that starts sooner.

## Decisions that are settled — do not re-raise them

- Hosted name first: special-care rules → object-specific routes → **first
  recognised material word**. No mixed-material parsing, no model-agreement
  requirement and no extra confidence gate in the named branch. The local
  classifier keeps 0.70 / 0.50 when there is no usable name.
- The three bins, colours and GPIOs (organic/green/D21, plastic/red/D22,
  paper/blue/D23), English/Hindi/Malayalam, and the simple visitor interface.
- **Human feedback is correction-only**: no confirmation buttons, no approval
  steps, no per-image verification prompts. Please do not propose any.
- The bin indicators' **selection** has been verified on the board by the
  operator. Do not ask for it to be re-tested, and do not count it as unverified.
  The 8-second window and the automatic switch-off are the same verified
  behaviour.
- The only hardware behaviour awaiting a physical check is the new `CLEAR_WASTE`
  command.
- The lamp must stay lit for 8 seconds and go out by itself; do not propose a
  shorter or "tap to dismiss" window.

## What to look for

Report only defects you can point at, with `file:line` and how to reproduce:

1. **Claims that are not true of the code** (comments, docs, UI copy, messages in
   en/hi/ml). The last round found several; look for the same class again.
2. **The new behaviours, read as code and as tests**: clear ordering and stale
   results; empty vs failure vs unusable; the fallback for a name with no usable
   word; the chain's timeout arithmetic (no attempt may start with no time left,
   and no attempt may exceed the page's deadline); the 8 s window and auto-off.
3. **Consistency between the three layers** for the waste routes: what the page
   sends, what `RecognitionRequest` accepts and stores, what the event says, and
   what the simulator/firmware does. A field that is accepted but never stored,
   or stored but misnamed, is a finding.
4. **Dead code and dead copy**: unused exports/constants, message keys nothing
   renders, comments describing behaviour that no longer exists.
5. **Anything that could open a bin without a decision**: a path that posts a
   bin category without `allowLamp`, a lamp for `other`/`medical`, a stale answer
   sending a command after a newer check, the clear landing after the lamp.
6. Tests that would still pass if the behaviour were removed (a guard that
   proves nothing).

## Tests you can run

```bash
./scripts/test_firmware.sh                     # host core, 68 tests / 513 checks
cd web/backend && /home/ubuntu/.venvs/aivillage/bin/python -m pytest -q
cd web/frontend && npm run typecheck && npx vitest run && npm run build
```

The app runs at `http://127.0.0.1:8010/waste` (sign-in `mahi$haru` / `village`).

## Output

A numbered list of findings, each with: severity (blocker / should-fix / nit),
`file:line`, what is wrong, and the smallest fix. Then a short list of the things
you checked and found correct, so the next reader knows what was covered. If you
find no defect in an area, say so plainly instead of padding it.
