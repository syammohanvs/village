# Troubleshooting

Start with the **Setup** checklist in the dashboard. It checks the controller,
calibration, pump gate, Whisper, waste model and optional reply audio.

## The dashboard does not open

- Check `data/logs/backend.log`.
- Confirm the port: `VILLAGE_PORT` in `.env` (default 8010 here). If another
  project owns 8000, keep 8010. `./scripts/launch.sh` refuses to kill an
  unrelated process.
- Verify the backend directly:
  `curl http://127.0.0.1:8010/api/v1/system/health`.

## The controller is unreachable

1. Serial monitor the ESP32 at 115200 baud; note the printed IP.
2. Set `VILLAGE_DEVICE_MODE=real` and `VILLAGE_DEVICE_URL=http://<that IP>`.
3. Confirm the token in `.env` exactly equals `VILLAGE_DEVICE_TOKEN` in
   `uc/include/village/secrets.h`.
4. `curl http://<ip>/api/v1/health` from the laptop. This endpoint is public;
   `/status` requires the token.
5. If station mode failed, the board starts `Village-Setup` (password in
   `secrets.h`). Connect to it only for recovery. The board does not switch
   back automatically; reboot it after fixing the router.
6. The dashboard shows **stale** and **disconnected** rather than inventing a
   zero. That is deliberate.

## Pump does not start

The controller refuses with a reason. Check, in order:

- `Irrigation blocked: the pump has not been commissioned.` — the build flag
  `VILLAGE_PUMP_COMMISSIONED` is still 0, or the runtime switch is off, or both.
  Complete `docs/bench-test.md` before opening either gate.
- `reservoir water is low` / `state is unknown` — calibrate the probes and make
  sure probe B is grounded and probe A is on the 47 kΩ/ADC node.
- `soil moisture is not calibrated` — capture dry and wet endpoints.
- `the soil is already wet enough` — the reading is at or above the dry-start
  threshold. This is correct behaviour.
- `a required sensor reading is stale or invalid` — check the probe wiring and
  the age shown on Sensors.
- `a watering session is already running` — press Stop first.
- `the post-session lockout is still active` — wait for the cooldown; after a
  no-rise failure it is 30 minutes. Fix the probe and/or wet the soil to clear
  the failure lockout.

## Pump stops immediately

Look at the last stop reason: low water, invalid sensor, maximum runtime,
maximum pulses, manual link loss, or explicit stop. Low water and sensor
failure are hard safety stops. The link-loss stop applies only to a manual
session; local automatic watering continues if the laptop disappears.

## Soil percentage behaves oddly

- Confirm the probe interface is powered at 3.3 V, or that its analogue output
  cannot exceed 3.3 V.
- Dry and wet endpoints must differ by at least the minimum span. Either
  polarity is accepted.
- A resistive probe in continuously wet soil can corrode; power it only while
  the exhibit runs.
- The reading is a calibrated relative value, not a laboratory measurement.

## Reservoir always says low or unavailable

- Check the 47 kΩ resistor and that probe B goes to GND.
- Measure the ADC node with a multimeter while the probes are dry and wet.
- The excitation pin must be high impedance when not measuring. The firmware
  does this; a wiring short to 3.3 V would keep the node high.
- Set thresholds from the measured millivolts; the defaults are starting
  values.
- A calibration of “uncalibrated” blocks irrigation. That is deliberate.

## A bin says unavailable

- Check 5 V, GND, the trigger GPIO and the echo divider (1 kΩ series,
  2 kΩ to GND). Never connect a 5 V echo directly.
- A missing echo is **unavailable**, not empty. Measure the distance with a
  ruler and set `empty_cm`/`full_cm`.
- The three sensors are read one at a time; keep them apart to reduce
  cross-talk.
- Inside the blind zone the bin is reported full-at-the-sensor and flagged.

## Streetlights flicker or stay off

- Auto mode uses hysteresis and a 4 s stable delay. A brief change should not
  flip the LEDs.
- If the reading is stale, auto mode stays off and says the sensor is not
  ready.
- For a digital LDR module set `output_type=digital` and the correct
  `digital_dark_when_high` value.
- For an analogue module verify `analog_bright_high` with a lamp; some modules
  are inverted.
- A commanded off state is not a connectivity test. Check the LED and resistor
  in the bench test.
- **Everything reads “Not installed” and the lamps never switch on:** the
  controller starts with both hardware facts false on purpose. A floating ADC
  pin reads plausible noise, so an unwired LDR must not report “dark”, and
  unwired lamps must not be driven. Tick the matching box on **Sensors** —
  **The streetlight lamps are wired** for the four outputs, **The LDR is
  wired** for the sensor — then save. They are independent: you can test the
  lamps before the LDR is fitted.

## Wireless update says “No response from device”

- Run the uploader from **Windows**, not from WSL. The board sends the image
  back over UDP to the machine that invited it, and WSL is behind a NAT the
  LAN cannot reach.
- The uploader must tell the board a reachable host address. `tools\ota_flash.py`
  detects it automatically; a raw `espota.py` call needs `-I <this-pc-lan-ip>`.
- Check the board is on the same network and still answers
  `http://<board-ip>/api/v1/health`.
- `Authenticating...OK` followed by silence means the invitation was accepted
  and the return path failed — that is the host-address problem above, not a
  wrong password. A wrong password fails before authentication.
- If Windows Defender Firewall blocks the inbound UDP reply, allow Python on
  private networks, or use USB flashing.

## Voice does not work

- `curl http://127.0.0.1:8181/health` should return `{"status":"ok"}`.
- Check `data/logs/whisper.log` and `VILLAGE_WHISPER_BIN`.
- The model must be `models/whisper/ggml-base.bin` (multilingual), not
  `ggml-base.en.bin`.
- Allow microphone permission in the browser. Use Chromium if speech
  recognition or audio capture is restricted.
- Push-to-talk records for at most 10 seconds; silence returns “No speech was
  detected”.
- Unsupported, ambiguous or negated phrases intentionally do nothing. The
  panel shows the support sentence.
- Malayalam/Hindi need testing with the child's real speech; edit
  `shared/intents.json` if the words differ.
- The app will not record while it is speaking a reply. If the microphone
  button is disabled, wait for the reply to finish.

## The camera says “Recognition model not installed”

Copy `model.json`, `metadata.json` and `weights.bin` into `models/waste/`, then
reload. The app never substitutes random predictions. See
`docs/waste-model.md`.

## The camera opens but predictions are poor

- Train with the same lighting and backgrounds used at the exhibition.
- Include a real `Background` class with empty scenes, hands and the table.
- Increase the confidence threshold and the stable-frame count.
- One item is counted once; remove it (show background) before the next item.
- The camera identifies waste, not people, and does not prove deposition.

## Demo mode

Demo mode uses a separate simulator. Its commands can never reach the ESP32.
The banner and the “Simulator” badge make this visible. If you see simulated
data during the real part of the talk, turn Demo mode off and confirm the
source badge changes.

## Logs and data

- `data/logs/backend.log` — API, polls, sampler.
- `data/logs/whisper.log` — Whisper server.
- `data/village.db` — SQLite events, recognitions, settings, demo data.
- No raw microphone or camera recordings are stored by default.
