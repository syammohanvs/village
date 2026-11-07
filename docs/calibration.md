# Calibration

Calibration is stored on the ESP32 after validation. The dashboard shows the
saved revision and any unsaved draft separately. A calibration change is not
accepted until the controller acknowledges it.

## 1. Soil moisture (two raw points)

The probe is a **relative** sensor, not a laboratory volumetric measurement.
The firmware maps the raw ADC reading between two calibrated endpoints:

- `dry_raw` → 0 %
- `wet_raw` → 100 %

Either polarity is accepted. If the raw value rises with moisture, the wet
reading will be larger than the dry reading; the mapping handles it without a
polarity switch.

1. Put the probe in **dry soil** (the soil the village will actually use).
2. Read the raw value on **Sensors**.
3. Put the probe in **wet soil** and let it settle.
4. Read the raw value again.
5. Enter both values and Save.
6. The endpoints must differ by at least `min_span_raw` (default 400 counts),
   be within 0–4095 and not be identical. The controller rejects a bad pair.
7. Water a little and confirm the percentage rises; let it dry and confirm it
   falls.

The percentage is clamped to 0–100 %. The state is `dry` at or below the
dry-start threshold, `wet` at or above the stop threshold, `adequate` between
them, and `uncalibrated`/`unavailable` when the data is not usable.

## 2. Reservoir (two wire probes)

The probes detect **one minimum water level**, not a continuous level. The
dashboard only shows **Available**, **Low**, **Uncalibrated** or
**Unavailable**. There is deliberately no percentage, litre or capacity field.

Proposed circuit (see `wiring.md`): GPIO 25 → 47 kΩ → probe A; probe A →
GPIO 35; probe B → GND. The firmware excites the probes for a few
milliseconds, averages seven ADC samples, then returns the pin to high
impedance.

1. With the probes **dry in air**, note the millivolt reading.
2. With the probes **in water at the real spacing**, note the millivolt
   reading.
3. Enter a wet threshold comfortably above the wet reading and a dry threshold
   comfortably below the dry reading. The dry threshold must be at least
   100 mV above the wet threshold. The UI saves `calibrated: true`.
4. Confirm the state changes when the probes are lifted out and dipped back in.
5. Confirm irrigation is blocked with **Low water** and that a running pulse
   stops immediately when the probes are lifted.

Water resistance is not zero, and the reading depends on probe area, spacing
and water conductivity. Re-calibrate if the probes are moved. A broken probe
wire can look dry, and a shorted pair can look wet; this simple circuit cannot
distinguish every wiring failure.

Place the probes at the minimum safe level above the pump intake. Keep the
reservoir's maximum water surface below the drip outlets to reduce siphoning.

## 3. Bins (three HC-SR04 sensors)

For each bin, measure with a ruler:

- `empty_cm`: distance from the sensor to the **empty floor**.
- `full_cm`: distance from the sensor to the **full line**.

Rules:

- `full_cm` must be at least 2 cm below `empty_cm`.
- `max_range_cm` must be at least the empty distance.
- Keep the HC-SR04's blind zone (roughly 2–4 cm) in mind; an object inside it
  is reported as full-at-the-sensor with a flag, not as an empty bin.
- The firmware reads the three sensors sequentially, filters each with a
  median, and requires repeated readings before a state change.
- A missing echo produces **unavailable**, with no distance and no fill
  percentage. It never becomes an empty bin.

The fill percentage is an **estimated fill height** from the measured
distance, not a measured waste volume.

## 4. Streetlight LDR

- For an analogue module, `output_type = analog`. Set
  `analog_bright_high` according to the actual module (most increase with
  light, but verify with a lamp).
- For a digital-only module, set `output_type = digital` and
  `digital_dark_when_high` according to the DO behaviour (typical modules
  output HIGH in darkness).
- `dark_threshold` and `bright_threshold` define the hysteresis band; the
  bright threshold must be above the dark threshold.
- `stable_ms` (default 4 s) prevents flicker at dusk. The dashboard reports
  Bright/Dark, the selected mode and the commanded LED state separately.
- If the reading is stale, auto mode switches the LEDs **off** and says the
  sensor is not ready; manual On/Off still works.
- The firmware has no current feedback. “Off” is a commanded GPIO state, not
  proof that an LED is connected. That is why the bench test checks every LED.

## 5. Irrigation defaults (starting values, not calibrated facts)

| Setting | Default | Meaning |
| --- | ---: | --- |
| Dry start | 35 % | At or below this, a session may start |
| Stop | 55 % | At or above this after a soak, the session completes |
| Dry confirmation | 30 s | How long “dry” must persist before auto starts |
| Pulse | 4000 ms | Pump-on time per pulse |
| Maximum pulse | 8000 ms | Hard per-pulse cap |
| Soak | 45 s | Wait before checking moisture again |
| Max cumulative | 15 s | Total pump-on time per session |
| Max pulses | 4 | Finite session limit |
| Cooldown | 5 min | Wait before another session (30 min after a failure lockout) |
| Manual link timeout | 30 s | A manual session stops if the laptop disappears |

Change these only after observing the real soil and pump. The pump cannot run
until both commissioning gates are open.
