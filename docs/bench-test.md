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

- [ ] Each of the four streetlight LEDs has its own resistor (220 Ω nominal).
- [ ] Each lights from the Controls page.
- [ ] Organic, plastic and paper LEDs light individually and only for the
      correct category.
- [ ] All LEDs are off after boot.
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

- [ ] 47 kΩ resistor between GPIO 25 and probe A.
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

- [ ] Each echo passes through a divider: 1 kΩ series, 2 kΩ to GND.
- [ ] Trigger and echo GPIOs match the wiring table.
- [ ] Empty distance measured for each bin: organic ____ plastic ____ paper ____
- [ ] Full distance measured for each bin: organic ____ plastic ____ paper ____
- [ ] Each bin reports Available/Nearly full/Full as the level changes.
- [ ] Disconnecting an echo reports **unavailable**, not empty.
- [ ] Object inside the blind zone is flagged, not treated as healthy.
- [ ] The three sensors are read sequentially; no cross-talk.

## G. Pump driver and pump

- [ ] The three-legged power component is **identified** (marking/datasheet).
      If it is not a logic-level MOSFET or a suitable driver, do not use it.
- [ ] Gate threshold is specified at ≤ 3.3 V, or the measured gate voltage
      switches it fully on.
- [ ] Gate resistor 220 Ω–1 kΩ; gate pull-down 10 kΩ.
- [ ] Flyback diode across the pump, cathode to +5 V.
- [ ] Driver tested with a dummy load (lamp/resistor) before the pump.
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
