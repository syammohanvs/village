# Hardware bench test

> **No hardware verification is claimed by the repository.** The firmware
> compiles and its safety core is tested on the host, but the physical board,
> pump, probes and sensors must be checked by the builder. Record the results
> below and only then open the pump gate.

Do this in order. Use the 5 V 2 A power bank and keep the pump **disconnected**
until step 8.

## A. Visual and power

- [ ] Board marking is **ESP32-WROOM-32**, not WROVER.
- [ ] USB-serial driver installed; the board appears as a COM/tty port.
- [ ] No loose strands, reversed polarity or shorts.
- [ ] 5 V rail measured at the power branch.
- [ ] 3.3 V rail measured at the board.
- [ ] All grounds meet at one star point.
- [ ] Pump power comes from the 5 V branch through the driver, not from a GPIO
      or the 3.3 V regulator.

## B. LEDs

- [ ] Each of the four streetlight LEDs has its own resistor (**100 Ω** on this
      build; 220 Ω is also fine).
- [ ] Each lights from the Controls page.
- [x] Organic, plastic and paper LEDs light individually and only for the
      correct category (green D21, red D22, yellow D23 — verified 2026-11-09,
      see `docs/verification.md`).
- [x] All LEDs are off after boot.
- [ ] LED current measured; the board regulator is not overheating.

## C. Light sensor

- [ ] LDR module powered at 3.3 V (or its output measured ≤ 3.3 V).
- [ ] Analogue polarity confirmed: `analog_bright_high` matches reality.
- [ ] Cover/uncover the sensor; Bright/Dark changes only after the stable delay.
- [ ] Auto mode does not flicker at dusk or under a hand.
- [ ] Stale/unplugged sensor makes auto mode switch off and report unknown.
- [ ] Manual On/Off still works with the sensor unplugged.

## D. Soil probe

- [ ] Probe interface powered at 3.3 V, or output divided to ≤ 3.3 V.
- [ ] Dry raw reading recorded: __________
- [ ] Wet raw reading recorded: __________
- [ ] Endpoints differ by at least the minimum span.
- [ ] Percentage rises when watered and falls when drying.
- [ ] Sensor unplugged → `unavailable`, and irrigation is blocked.
- [ ] Calibration saved and acknowledged; revision increments.

## E. Reservoir probes

- [ ] **15 kΩ** between GPIO 25 and probe A (47 kΩ also works, with a narrower
      wet/dry window).
- [ ] Probe A also connects to GPIO 35.
- [ ] Probe B connects to GND.
- [ ] Dry millivolts recorded: __________
- [ ] Wet millivolts recorded: __________
- [ ] Thresholds set with a comfortable dead band.
- [ ] Available/Low changes when the probes are dipped/lifted.
- [ ] Irrigation is blocked when low.
- [ ] A running pulse stops immediately when the probes are lifted.
- [ ] Excitation pin is high impedance between measurements (measure it).
- [ ] Probes are at the minimum safe level, above the pump intake.
- [ ] Maximum water surface is below the drip outlets (no siphon).

## F. HC-SR04 bins

- [ ] Each echo passes through a divider: **1 kΩ series, 2 kΩ to GND**
      (10 kΩ / 20 kΩ also gives 3.33 V and is fine).
- [ ] Trigger and echo GPIOs match the wiring table.
- [ ] Empty distance measured for each bin: organic ____ plastic ____ paper ____
- [ ] Full distance measured for each bin: organic ____ plastic ____ paper ____
- [ ] Each bin reports Available/Nearly full/Full as the level changes.
- [ ] Disconnecting an echo reports **unavailable**, not empty.
- [ ] Object inside the blind zone is flagged, not treated as healthy.
- [ ] The three sensors are read sequentially; no cross-talk.

## G. Pump driver and pump

**Part in hand: IRFZ44N** (standard-level N-channel MOSFET, TO-220, G-D-S),
with a **2N3904** small-signal NPN also available.

- The pump is a **DC 3–6 V mini submersible**, rated **130–220 mA**, maximum
  lift **40–110 mm**. Its outlet must sit within about 10 cm of the water
  surface; above that it stalls.
- The **2N3904 is not used as the pump switch**: its 200 mA rating is below the
  pump's running current and its start-up surge.
- The IRFZ44N is specified at **Vgs = 10 V**, so it has to be measured at
  3.3 V before it is trusted:

  | Measured Vds (dummy load, gate at 3V3) | Decision |
  | --- | --- |
  | < 0.3 V | usable as-is |
  | 0.3–0.8 V | usable at 200 mA; it will warm |
  | > 1 V, or a dim lamp | replace with a logic-level part (IRLZ44N, AO3400) |

- [ ] Driver tested with a **dummy load** (5 V lamp or 47 Ω / 1 W resistor)
      before the pump, gate tied to 3V3.
- [ ] Alternatively, build with `VILLAGE_PUMP_BENCH_DRIVE 1` to have the
      firmware drive D19 HIGH at boot (`board.pump_bench_drive` in
      `/api/v1/health`). That build bypasses both pump gates: the pump must be
      disconnected, and it must be reflashed with the flag back at `0`.
- [ ] Measured Vds: __________ (record it; see the table above).
- [ ] Gate resistor **220 Ω**; gate pull-down **10 kΩ**.
- [ ] Flyback diode (**1N4007**) across the pump, cathode to +5 V.
- [ ] Pump powered from **VIN** with the 5 V 2 A power bank, USB unplugged;
      the board's 3.3 V regulator is not in the pump path.
- [ ] Pump connected **in water**, never dry.
- [ ] Running current: __________ Stall current: __________
- [ ] 5 V rail holds up; the MOSFET does not overheat.
- [ ] Firmware pump output is LOW at boot and after reset.
- [ ] Pump stops on Stop, low water, invalid sensor, maximum runtime and
      maximum pulses.

## H. Safety behaviours on the real device

- [ ] Wet soil blocks a manual and a voice start.
- [ ] Low reservoir blocks and stops irrigation.
- [ ] Unplugging the soil or reservoir sensor stops a running session.
- [ ] Maximum cumulative pump time stops the session.
- [ ] The pulse limit / lockout prevents endless watering when moisture never
      rises.
- [ ] Two Start requests with the same command id do not start twice.
- [ ] A second Start while active is refused as already active.
- [ ] Stop interrupts the state machine immediately.
- [ ] Power-cycle leaves the pump OFF and does not resume the session.
- [ ] Manual session stops when the laptop stops polling (link timeout).
- [ ] Automatic operation continues when the laptop is off, with all sensors
      valid.
- [ ] Wi-Fi station mode reconnects; the board does not switch to AP during a
      demonstration.

## I. Commissioning

- [ ] All checks above pass and are recorded.
- [ ] Set `VILLAGE_PUMP_COMMISSIONED 1` in
      `uc/include/village/build_config.h`.
- [ ] Reflash.
- [ ] Enable the pump in **Controls → Pump commissioning**.
- [ ] Run one short pulse in water while watching the current.
- [ ] Record final timings and thresholds in `docs/calibration.md`.

## Record

| Date | Builder | Board MAC | Result | Notes |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |
