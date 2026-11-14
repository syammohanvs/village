# Wiring and power

> **Status: proposed, not yet physically verified.** The pin *numbers* below are
> checked against the 30-pin board's documented and photographed layout, and
> the firmware refuses to compile if they violate the ESP32 rules. The actual
> board still has to be checked for module marking, header continuity and
> analogue behaviour before the exhibit is powered with the pump connected.

## 1. The board we have

The purchased board is the **30-pin NodeMCU-style ESP32 development board**
listed at
<https://roboticscomp.in/product/nodemcu-wifi-development-board-esp32/>.

Evidence collected on 2026-11-07:

- product title: “Nodemcu Wifi Development Board Esp32 30pin”;
- product photo: **ESP32-WROOM-32** shield, AMS1117 3.3 V regulator, micro-USB,
  two buttons (EN and BOOT), 30 header pins;
- listing: 32 Mbit (4 MB) flash, 5 V input, 3.3 V logic;
- silkscreen on the photographed board:
  - one row: `EN VP VN D34 D35 D32 D33 D25 D26 D27 D14 D12 D13 GND VIN`
  - other row: `D23 D22 TX0 RX0 D21 D19 D18 D5 D17 D16 D4 D2 D15 GND 3V3`

`Dn` on the silkscreen means GPIO *n*. This project uses **GPIO numbers only**;
never wire by counting header positions, because the physical order is not the
logical order.

### Still to check on the real board (commissioning)

1. Read the metal shield: it must say **ESP32-WROOM-32** (not WROVER). A WROVER
   uses GPIO 16/17 for PSRAM, which would require moving the bin triggers.
2. Confirm 4 MB flash and identify the USB-serial chip (CP2102 or CH340) so the
   right driver is installed on the laptop.
3. Confirm the two header rows match the silkscreen above, with a continuity
   check from each labelled pin to the module/regulator where possible.
4. Flash a minimal sketch and read `/api/v1/health`: it reports the chip model,
   revision, flash size, MAC and the compiled pin map.
5. Measure the 3.3 V rail under the LED load, and check every analogue input is
   at or below 3.3 V before connecting it.

## 2. GPIO allocation (11 assigned signals)

| Function | GPIO | Header label | Direction | Why this pin |
| --- | ---: | --- | --- | --- |
| Soil moisture analogue | **34** | D34 | ADC input | ADC1_CH6, input-only |
| Reservoir probe sense | **35** | D35 | ADC input | ADC1_CH7, input-only |
| Reservoir probe excitation | **25** | D25 | Digital output | Safe output; high-Z between reads |
| LDR analogue/digital | **32** | D32 | ADC/digital input | ADC1_CH4 |
| Solar panel voltage | **39** | VN | ADC input | ADC1_CH3, input-only |
| Solar current sense | **36** | VP | ADC input | ADC1_CH0, input-only |
| Pump MOSFET gate | **19** | D19 | Digital output | Safe output, boot-low |
| Streetlight lamps (all five) | **13** | D13 | Digital output | Safe output; one pin drives the loom |
| Waste LED — organic | **21** | D21 | Digital output | Safe output |
| Waste LED — plastic | **22** | D22 | Digital output | Safe output |
| Waste LED — paper | **23** | D23 | Digital output | Safe output |
| *Left over* | 33 | D33 | ADC/digital | The named spare; can also drive an output |
| *Left over* | 4, 16, 17, 18, 26 | D4, D16, D17, D18, D26 | Digital I/O | Freed when the bin rangefinders were removed |

### Why not other pins

| GPIO | Reason not used |
| --- | --- |
| 0 | BOOT strapping; not broken out on this 30-pin board. |
| 1, 3 | UART0 TX/RX used by the USB programmer and serial log. |
| 2, 5, 12, 15 | Boot-strapping pins; 2/15 also pulse at boot. Kept free. |
| 6–11 | Connected to the SPI flash; not exposed. |
| 34, 35, 36, 39 | Input-only. They carry the soil, reservoir, solar-current and solar-voltage inputs. |

All analogue measurements use **ADC1** (GPIO 32, 34, 35, 36, 39). ADC2 shares
hardware with the Wi-Fi radio and is not reliable while Wi-Fi is active.
GPIO 25 is ADC2-capable but is used only as a digital output here, which is
safe.

The firmware's `uc/include/village/pins.h` encodes all of this and has
`static_assert` checks for ADC1, input-only, strapping, flash and duplicate
pins. A bad edit fails the build.

**GPIO budget:** 25 GPIOs are exposed (23 excluding UART0). **11 are assigned**.
Removing the bin rangefinders freed **GPIO 4, 16, 17, 18 and 26**, and moving
the solar panel to VN freed **GPIO 33**; all six are unassigned and recorded in
`pins.h` as free, with a compile-time check that nothing claims one by accident.
Anything added next has six pins to choose from.

## 3. Power

```
 5 V 2 A power bank
   ├── USB / 5 V ──▶ ESP32 board (VIN or USB)
   ├── +5 V ───────▶ pump driver + pump
   └── GND ────────▶ common ground rail
                         ▲
 ESP32 GND ──────────────┘
```

- The pump is powered from the **5 V supply through its driver**, never from a
  GPIO and never from the ESP32 3.3 V regulator.
- The power branch happens **before** the development board. All grounds are
  common at one star point.
- A 2 A power bank is the minimum. A small pump can draw a large stall current;
  measure it, or use a supply with headroom.
- Add a **flyback diode** across the pump (cathode to +5 V, anode to the
  MOSFET drain) and a 100 nF / 100 µF capacitor across the pump terminals if
  the pump is noisy.
- Do **not** back-feed the board's 5 V pin while USB is connected unless the
  board documentation explicitly allows it. Powering through USB is the
  simplest safe arrangement for the exhibit.

## 4. Pump driver — 2N7000 (measured), IRFZ44N as the fallback

The pump is a **DC 3–6 V mini submersible** rated **130–220 mA**, maximum lift
**40–110 mm**. It is powered from **VIN** with the 5 V 2 A power bank; the GPIO
only drives the gate. Its winding measures **28 Ω** cold.

**Measured on the real pump, 2026-11-10** — the fitted part is a **2N7000**
(TO-92, **S · G · D** left→right, flat face towards you):

| Measurement | Value |
| --- | --- |
| D19 ↔ GND (gate driven) | 3.30 V |
| Gate ↔ source | 3.27 V |
| Vds, 23.5 Ω dummy load (157 mA) | 1.3 V |
| Pump from the 5 V 2 A bank | runs; Vds ≈ 1.3 V |

The **IRFZ44N** (TO-220, G-D-S, tab = drain) is the fallback. Its on-resistance
is specified at **Vgs = 10 V**, not 3.3 V, so it must be measured at 3.3 V
before it is used; in practice it needs a 5 V gate driver (a 2N2222A as an
inverting level shifter). A 2N3904 is also in the kit and is **not** a suitable
pump switch: 200 mA is below the pump's running current and its start-up surge.

**Two traps found the hard way — neither is a transistor fault:**

1. **A resistor dummy load is not a motor test.** A 23.5 Ω resistor draws a
   steady 171 mA and works where the pump gets 1.3 V on identical wiring,
   because a motor wants several times its running current for a fraction of a
   second while it spins up. Size the supply for the **surge**.
2. **Never power the pump from the PC's USB port.** Measured: on USB the rail
   collapses and the pump sees **1.3 V**, which reads as a dead MOSFET. On the
   5 V 2 A bank the same circuit runs normally. Grounds must be common.

Required driver interface:

| Property | Requirement |
| --- | --- |
| Type | Logic-level N-channel MOSFET (preferred) or a driver module with a transistor/optocoupler. |
| Gate threshold | Must switch fully on at **Vgs ≤ 3.3 V** — for the IRFZ44N that is a measurement, not an assumption. |
| Current | Rated above the pump's measured stall current, with margin. |
| Gate resistor | 220 Ω–1 kΩ in series from GPIO 19. |
| Gate pull-down | 10 kΩ from gate to GND, so the pump is off while the ESP32 boots. |
| Flyback | Diode across the pump, cathode to +5 V. |
| Ground | MOSFET source to the common ground. |

### Measure the driver before trusting it

Use a dummy load (5 V lamp, or 47 Ω / 1 W resistor), **not** the pump:

```
VIN (+5 V) ── dummy load ──┬── drain   (2N7000: right leg · IRFZ44N: middle/tab)
                           │
GPIO 19 / 3V3 ──[220 Ω]── gate     (2N7000: middle · IRFZ44N: left)
                           │
                       [10 kΩ]
                           │
GND ───────────────────── source   (2N7000: left · IRFZ44N: right)
```

With the gate held at **3.3 V**, measure Vds across the load-on MOSFET:

| Vds | Decision |
| --- | --- |
| < 0.3 V | fully on — use it |
| 0.3–1.4 V | usable at ~200 mA with the pump on the 2 A bank (the 2N7000 measures 1.3 V at 157 mA and runs the pump); it will warm |
| > 1.5 V, or a dim lamp | not switching at 3.3 V — use a logic-level part |

**Beware the dummy load passing while the pump fails.** The resistor draws a
steady 171 mA; the pump's start-up surge is several times that, so a supply
that is marginal on USB passes the resistor test and collapses on the motor.
That is a supply problem, not a transistor one — measured: 4.0 V on the
resistors, 1.3 V on the pump, same wiring, USB feed.

If the driver fails at 3.3 V, use a **logic-level** part (IRLZ44N drop-in, or
an AO3400/IRLML2502 module), or drive an IRFZ44N's gate from 5 V through a
2N2222A. **Do not** use the 2N3904 as the switch, and **do not** pull the gate
up to 5 V directly: at reset the GPIO is an input, so a 5 V pull-up would turn
the pump on during boot and put 5 V on a 3.3 V pin.

### Wiring once Vds passes

```
VIN (+5 V) ──┬──────── pump +
             │
          [1N4007]   cathode → +5 V, anode → drain
             │
GPIO 19 ──[220 Ω]── gate
             │
         [10 kΩ]
             │
GND ─────────┴── source ─── pump −
```

- Pump **+** to VIN, pump **−** to the drain; source to the common ground.
- 1N4007 across the pump is mandatory (band/cathode to **+5 V**, plain end to
  the drain); 100 µF across the pump terminals is optional and tames the
  start-up surge.
- Power bank into **VIN** with USB unplugged. OTA is used for firmware, so the
  cable never has to be connected while the pump is powered.
- Keep the intake above the sludge line and **below** the reservoir probes'
  low level, so “Available” means the pump is submerged. Never run it dry.
- The outlet must be within about **10 cm** of the water surface; this pump
  cannot lift higher.

## 5. Sensors

### Soil moisture probe — GPIO 34

The input is **GPIO 34** (header `D34`, ADC1 channel 6). It is input-only and
3.3 V only: never feed it more than 3.3 V.

**A. LM393 interface board (module) — VCC / GND / DO / AO:**

- `VCC` → **3V3**, `GND` → **GND**, `AO` → **GPIO 34**. `DO` is not connected.
- **Use AO, not DO.** AO is the analog soil reading; DO is only the
  comparator's wet/dry threshold set by the blue potentiometer and would
  discard the analog information.
- **Power the module from 3.3 V.** At 5 V VCC the AO pin can rise above 3.3 V.
- The module is just a convenience (comparator + potentiometer); the firmware
  never uses its digital output.

**B. Bare two-prong probe (no module) — recommended:**

Build a divider with one fixed resistor. Recommended **10 kΩ**:

```
 3V3 ──[ probe ]──●── GPIO 34 (D34)
                  │
              [ 10 kΩ ]
                  │
                 GND
```

- Probe on the **3.3 V side**, 10 kΩ to **GND** → the reading rises with
  moisture (probe resistance falls when wet).
- Swapping the two (10 kΩ to 3V3, probe to GND) inverts the reading. **Either
  is fine** — the firmware accepts either polarity during calibration, so do
  not worry which way the voltage moves; just record which reading came from
  dry soil and which from wet soil.
- Any value from 4.7 kΩ to 47 kΩ works; 10 kΩ gives a wide usable range with
  a typical resistive probe. If the probe is very high resistance, use a
  larger resistor (e.g. 47 kΩ) to keep the reading in range.
- **Power is negligible** (the probe draws microamps through 10 kΩ); no
  regulator load.

**Common to both:**

- The probe is resistive and corrodes under continuous DC. The supplied probe
  is nickel-plated to slow this, but keep it out of standing water and unplug
  it when the exhibit is not running. Continuous sampling is fine for a
  two-day event.
- Insert the prongs to a **consistent depth** and mark that depth: the reading
  depends on how much metal is in the soil.
- Calibration is two raw readings: dry soil and wet soil. The firmware accepts
  either polarity, so do not worry which way the voltage moves — just record
  which reading came from dry soil and which from wet soil.
- Only the prongs go in the soil. Never bury the interface board (if used).

**After wiring, tick “The soil probe is wired” in Setup → Sensors & Calibration and save**, otherwise the
controller still reports no moisture level. The controller starts with the probe
marked as not wired; that is deliberate, because a floating ADC pin reads
plausible-looking noise and must not claim a moisture reading.

### Reservoir probes (two wires, one level)

```
 GPIO 25 ──[ 15 kΩ ]──●──── probe A
                       │
                  GPIO 35 (ADC1, 11 dB)
                       │
                    probe B ── GND
```

- 15 kΩ was fitted on this build; 47 kΩ works too and gives a lower wet
  voltage. Drive GPIO 25 HIGH for a short measurement, wait **≥ 5 ms** for the
  node to settle, average several ADC samples, then set GPIO 25 to `INPUT`
  (high impedance, no pull-up/pull-down).
- Measured here: **3145 mV in air**, **~1600 mV in well water**; thresholds
  **2300 / 2800 mV**.
- Wet water conducts: probe A is pulled down through the water, so the ADC
  voltage falls. Dry: no current, the 47 kΩ pulls the node up, so the ADC
  voltage rises. The actual voltage depends on water conductivity, probe area
  and spacing. **Water resistance is not zero.**
- The firmware classifies wet/dry from configured millivolt thresholds and
  exposes only **available / low / uncalibrated / unavailable** — never a
  percentage, litre or capacity value.
- Short DC pulses reduce electrolysis, but this simple circuit cannot detect
  every wiring failure (a broken probe wire can look dry; a shorted probe can
  look wet). The UI must show “unavailable” when readings are stale, not
  “low” or “available” by default.
- Place the probes at the **minimum safe water level, above the pump intake**.
- Keep the reservoir's maximum water surface **below the drip outlets** so the
  drip line cannot continue siphoning after the pump stops.

### LDR (light sensor) — GPIO 32

The input is **GPIO 32** (header `D32`, ADC1 channel 4). It is 3.3 V only:
never feed it 5 V.

**This build fits B below — a bare LDR and one pull-up resistor, no module.**
The module in A is kept for reference because it is the part most kits ship
with, and the firmware still supports it.

**A. LM393 "digital LDR module"** (the common 3-pin board: VCC / GND / DO) —
*not used on this build*:

- `VCC` → **3V3**, `GND` → **GND**, `DO` → **GPIO 32**.
- **Power it from 3.3 V, not 5 V.** The comparator's output swings to whatever
  VCC is, so a 5 V supply puts 5 V on DO and that would exceed the ESP32's
  3.6 V pin limit. At 3.3 V the output is already safe and **no resistor is
  needed**.
- If it must run from 5 V, divide DO before the pin: `DO → 10 kΩ → GPIO 32`
  with `20 kΩ` from GPIO 32 to GND (about 3.33 V at the pin). A 1 kΩ / 2 kΩ
  pair works the same way.
- Set `light.output_type` to `digital`. This module is threshold-only: it
  reports *light* or *dark*, not a continuous brightness.
- **Polarity varies between batches.** Some drive DO HIGH in light, some HIGH
  in darkness. Cover the sensor and watch the reading, then set
  `digital_dark_when_high` to match (`true` means a HIGH pin is reported as
  dark). The on-board potentiometer sets the trigger level.
- It draws about 15 mA, which the board's 3.3 V regulator supplies easily.
- **Measured on this build:** DO is **0 V in light** and **3.3 V covered**, so
  `digital_dark_when_high = true`. The on-board potentiometer must be set so
  the output switches at the light level you care about.
- The module also exposes **AO** (a real analog level, roughly 1.23 V lit and
  2.4 V covered here). If you ever want a brightness reading instead of just
  light/dark, connect AO to GPIO 32 instead, set `light.output_type` to
  `analog` and `light.analog_bright_high` to **false** (the voltage rises in
  the dark).

**B. Bare two-leg LDR — fitted on this build** (no board):

One fixed resistor and one LDR make a divider. The resistor is the *pull-up*
(on the 3.3 V side) and the LDR goes to ground:

```
 3V3 ──[ 10 kΩ ]──●── GPIO 32 (D32)
                   │
               [ LDR ]
                   │
                  GND
```

- Resistor to **3.3 V**, LDR to **GND** → the reading **falls with light**, so
  `analog_bright_high = false` — which is the firmware's default.
- **Measured on this build (2026-11-15), daylight-lit room:** raw **800–890**
  on the 0–4095 scale, which the firmware turns into a brightness metric of
  **3200–3300** (`metric = 4095 − raw`). That reads **bright**, as it should.
- The thresholds are on the **metric**, not the raw value: `dark_threshold`
  (default 1800, i.e. raw ≥ 2295) and `bright_threshold` (default 2800, i.e.
  raw ≤ 1295). The 1800 default is measured on this build: a hand over the
  bare LDR reaches raw ~2560 (metric ~1536), and the older 1500 default missed
  it by 36 counts, so covering the sensor changed nothing. Cover yours, read
  the raw value, and move the thresholds to sit either side of your own two
  readings if they do not separate cleanly.
- A very dark LDR climbs toward raw 4095 (metric 0); a bright one falls toward
  raw 0 (metric 4095). The 4 s `stable_ms` delay stops the lamps flickering at
  dusk.
- Any pull-up from 4.7 kΩ to 47 kΩ works; a larger resistor puts the daylight
  end nearer the top of the ADC range.
- Swapping the two parts (LDR to 3V3, resistor to GND) makes the reading rise
  with light; then set `analog_bright_high = true` instead of rewiring.

**After wiring, tick “The LDR is wired” in Setup → Sensors & Calibration and save**, otherwise the
controller still reports no light level.
- **The controller starts with the LDR and the lamps marked as not wired.**
  These are two separate facts and two separate tick boxes in **Setup → Sensors & Calibration**:
  **The streetlight lamps are wired** (`light.installed`) and **The LDR is
  wired** (`light.sensor_fitted`). A board with nothing on GPIO 32 reads
  plausible-looking noise, so an unticked LDR reports no light level rather
  than inventing a "dark" observation; an unticked lamps box keeps the four
  outputs off.
- With the bare divider there is nothing to configure but the two tick boxes
  and the thresholds: `output_type = analog`, `analog_bright_high = false`.
- Hysteresis and the 4 s stable delay stop the streetlights flickering at dusk.

### Bins — indicator LEDs only, no level sensing

There is **no fill sensing of any kind** on this build: no time-of-flight or
ultrasonic rangefinder, no distance measurement, no fill percentage and no
"bin full" alert. A bin is a container a person can see into.

What each bin has is **one indicator LED** (organic D21, plastic D22, paper
D23 — see §6). The camera lights the LED for the category it just recognised,
so the prompt travels with the item. Nothing in the app claims to know how much
is in a bin, and nothing should be added that pretends to.

The five pins the old rangefinders used (4, 16, 17, 18, 26) are now free; see
the GPIO budget in §2.

## 6. LEDs

Each LED needs its own series resistor:

```
 GPIO ──[ 220 Ω ]──▶|── GND        (3.3 V LED, ~6 mA)
```

- **Streetlights: all five lamps are driven from one GPIO — GPIO 13 (D13) —
  with a separate 220 Ω resistor in series with each lamp.** One pin carries
  the combined current (about 1.8 mA per white LED, ~9 mA total), which is
  inside the ESP32's 20 mA per-pin recommendation, so a single pin is
  enough and D12/D14/D27 stay free. Each lamp still gets its own resistor
  so one shorted LED cannot take the others down.

```
 GPIO 13 ──┬──[ 220 Ω ]──▶|── GND      lamp 1
           ├──[ 220 Ω ]──▶|── GND      lamp 2
           ├──[ 220 Ω ]──▶|── GND      lamp 3
           ├──[ 220 Ω ]──▶|── GND      lamp 4
           └──[ 220 Ω ]──▶|── GND      lamp 5
```

  One resistor per LED, never one shared resistor for lamps wired in parallel.

  **Colour matters for 220 Ω:** it suits white/blue LEDs (Vf ~2.9-3.0 V,
  ~1.4-1.8 mA each). For red/yellow/green (Vf ~1.8-2.2 V) the same
  resistor would push ~5-7 mA per lamp (~25-35 mA total) and exceed the
  pin's limit — use 330 Ω for those colours instead.

- **Current with 220 Ω** at a 3.3 V GPIO: `I = (3.3 − Vf) / 220`, about
  **1.4–1.8 mA** per white/blue LED here (Vf ≈ 2.9–3.0 V), so five lamps
  draw roughly **7–9 mA** in total — inside the ESP32's 20 mA per-pin
  recommendation with margin to spare. That is a comfortable indicator
  brightness for a 5 mm LED.

  | LED colour | Vf (approx) | Current at 220 Ω | 5 lamps total |
  | --- | ---: | ---: | ---: |
  | White | 2.9 V | ~1.8 mA | ~9.0 mA ✔ |
  | Blue | 3.0 V | ~1.4 mA | ~7.0 mA ✔ |
  | Green | 2.2 V | ~5.0 mA | ~25 mA (**too high**) |
  | Yellow | 2.1 V | ~5.5 mA | ~27.5 mA (**too high**) |
  | Red | 1.8 V | ~6.8 mA | ~34 mA (**too high**) |

  220 Ω suits **white or blue** LEDs. For red/yellow/green use 330 Ω, which
  gives ~3–4.5 mA per lamp. This build is measured with white LEDs at
  Vf ≈ 2.93 V.

- **Current budget:** one pin carries all five lamps, so the combined
  current (~9 mA for white) is the number to watch. Stay under 20 mA per
  pin; if a lamp is ever swapped for a lower-Vf colour, raise the resistor
  (330 Ω or higher) rather than adding a second pin.
- The GPIO is the only supply: each LED's current returns through the board's
  ground, so keep the ground wire short and common with the board.
- Organic = GPIO **21** (green), plastic = GPIO **22** (red), paper = GPIO
  **23** (yellow), each with its own **330 Ω** series resistor. The three sit
  together on the free header edge, so the indicator loom leaves the board on
  one side.
- **Wiring aid: `VILLAGE_WASTE_LEDS_ALWAYS_ON`.** In
  `uc/include/village/build_config.h`, `1` holds all three pins HIGH so each
  LED lights as soon as it is connected; `0` is the exhibit setting, where the
  LEDs follow the recognised category and are otherwise dark. It is **`0` in
  the current build**. `GET /api/v1/health` reports the switch as
  `board.waste_leds_always_on`.
- Total LED current is small (~40 mA) and can come from the board's 3.3 V
  regulator. If brighter LEDs or a 5 V LED strip are used, switch them with a
  transistor/MOSFET from the 5 V rail instead, and keep the GPIO only as the
  control signal.
- The firmware has no current or voltage feedback for the LEDs. A commanded
  “off” is a GPIO state, not proof that the LED is connected. The dashboard
  therefore says “commanded off”, and a failed LED must be found in the bench
  test.

## 7. Bin and tank placement

- Three bins: one per category, labelled **Organic**, **Plastic**, **Paper**.
  The camera only recognises waste; it does not prove that the item was put in
  the bin. The indicator LED is a prompt, not a disposal record, and **no
  sensor measures how full a bin is**.
- The reservoir is a real container; the pump intake sits above the sludge
  line, and the two probes sit at the minimum safe level above the intake.
- Keep all electronics above the water line and strain-relieve the cables.

## 8. Bench test before water

Do this in order, with the pump **disconnected** until step 7:

1. Visual inspection; no power. Check for shorts, reversed polarity, loose
   strands.
2. Confirm module markings and header labels.
3. Power the ESP32 alone from USB; measure 5 V and 3.3 V rails.
4. Flash the firmware with the pump disabled. Confirm `/api/v1/health` reports
   the expected chip and pin map; confirm the pump gate is LOW at boot.
5. Test each LED on the Our Village page; measure the resistor current.
6. Trigger each bin indicator LED from the camera (or the API) and confirm the
   matching bin lights. There is no fill sensor to test.
7. Test the pump driver with a **dummy load** (a 5 V lamp or a resistor + LED)
   before the pump. Confirm the gate switches, the flyback diode is the right
   way round, and the MOSFET does not overheat.
8. Connect the pump **in water**, never dry. Measure the running and stall
   current. Confirm the 5 V supply holds up.
9. Calibrate soil (dry and wet) and the reservoir (dry and wet). The bins need no calibration: they have indicator LEDs only.
10. Run the acceptance tests in `docs/bench-test.md`, then commission the pump.

## 9. Commissioning the pump

The pump is protected by two independent gates:

1. Compile-time: `VILLAGE_PUMP_COMMISSIONED` in
   `uc/include/village/build_config.h` is `0` by default.
2. Runtime: `config.irrigation.pump_enabled` is `false` by default and is
   stored in NVS.

After the bench test passes:

1. Set `VILLAGE_PUMP_COMMISSIONED 1` and reflash.
2. In **Setup → Advanced → Pump commissioning**, read the safety checklist and enable
   the pump. The device accepts this only when the compile-time gate is open.
3. Fill the reservoir, place the probes, and run one short pulse with the
   pump in water while watching the current.
4. Record the result in `docs/bench-test.md`.

If either gate is closed, every irrigation start is rejected with
`IRRIGATION_BLOCKED_PUMP_NOT_COMMISSIONED`; the rest of the village still runs.

## 10. Solar panel — VN/GPIO 39 (volts) and VP/GPIO 36 (current)

A small photovoltaic cell lights a red LED, and two ADC taps make the power it
generates measurable. **Two parallel branches**, not one series chain: the
resistor into an ADC pin carries no current, so it is protection only.

```
                    ┌─── 10 kΩ ─────────────► GPIO 39   (VN)   panel volts
 panel + ───────────┤
                    │
                    └─── 330 Ω ────┬────────► GPIO 36   (VP)   LED anode
                                   │
                                  LED
                                   │
 panel − ──────────────────────── GND
```

- **GPIO 39 (`VN`)** reads the **panel voltage**. The 10 kΩ in front of it is
  the *only* thing between the panel and the pin, and it carries no current
  because an ADC input draws almost none. Its job is protection: if the panel
  slips above 3.3 V the pin clamps, and the 10 kΩ limits that fault current to
  `(V − 3.6) / 10 kΩ` — about 0.24 mA at 6 V. Use a second 10 kΩ in front of
  **GPIO 36** for the same reason.
- **GPIO 36 (`VP`)** reads the **LED anode** — the far side of the `330 Ω`.
- The voltage **across the 330 Ω** is `V33 − V36`, so
  `I = (V33 − V36) / 330` and `P = V33 × I`.

**If the panel reaches 3.3 V** with a red LED (~1.8 V forward): junction
≈ 1.8 V, drop ≈ 1.5 V, current ≈ **4.5 mA**, power ≈ **15 mW**.

**Measured on this build (2026-11-15), phone torch held on the panel:**

| Tap | Dark | Torch |
| --- | ---: | ---: |
| panel (VN) | 142 mV | **2019 mV** |
| junction (VP) | 142 mV | **1827 mV** |
| drop across 330 Ω | 0 mV | 192 mV |
| current | 0 mA | **0.58 mA** |
| power | 0 mW | **1.17 mW** |

Two things to read from that. The junction sat at **~1.83 V** — a red LED's
forward drop — while the panel moved, which is the proof the LED is in the load
path and the polarity is right (a reversed or missing LED would let the junction
follow the panel). And the current is **0.58 mA, not ~4.5 mA**, because the cell
only reached **2.0 V** under a phone torch, not 3.3 V: `I = (Vpanel − Vf) / 330`,
so there is simply less voltage left across the resistor. Brighter light (real
sun) or a smaller sense resistor both raise it. **The red LED visibly lit at
0.58 mA** (dim but clearly on, confirmed at the bench) — a human check on the
same fact the junction voltage reports. The dashboard shows all five figures and
they fall back to zero when the light is removed.

**The 330 Ω is the sense resistor, so `sense_ohms` must be 330** — not 10 000.
`solar.sense_ohms` is part of the stored config (default 330), which is what lets
one build work with a different resistor.

**Do not put the sense resistor after the 10 kΩ.** That is the arrangement this
section used to draw, and it is worse in every way: the LED current then has to
pass through the 10 kΩ, so it is ~0.15 mA (invisible LED), the drop across the
330 Ω is only ~48 mV (about 9 ADC counts, ±20% with noise), and `sense_ohms`
would have to be 10 330 to get the number right.

**Both taps must stay below 3.3 V.** A bare cell is fine. A larger panel needs a
divider on each tap — and then the volts shown are the tap, not the panel, so
scale accordingly. The ESP32's ADC is also non-linear over roughly the top
200 mV: a panel that sits right at 3.3 V reads ~4095 and stops rising, which is
another reason to leave headroom with a divider.

**`GPIO 36` is silkscreened `VP` and `GPIO 39` is `VN`, not `D36`/`D39`** — they
are the two input-only ADC1 pins, with no internal pull-ups and no 5 V
tolerance, and they sit next to each other so both taps leave the board on one
edge. See §1 for the header order; `VP` is immediately right of `EN`, `VN` is
next to that.

### Leaving the panel connected with the board switched off

It is acceptable with this wiring, but understand what happens.

Each ADC tap has a **10 kΩ series resistor**, and that is what makes it safe: a
pin's ESD clamp starts to conduct once the pin is more than ~0.3 V above the
supply rail, and with the board unpowered the rail is 0 V. The clamp current is
therefore `(Vpanel − 0.7) / 10 kΩ` — about **0.26 mA per tap at 3.3 V**, 0.52 mA
for both. That is far too little to power the ESP32 (it needs tens of mA to
run), and far below the few mA an ESD diode tolerates.

Two consequences, both harmless:

- **The red LED still glows in light.** That branch (`panel → 330 Ω → LED →
  GND`) does not involve the board at all, so the panel lights the LED even with
  USB unplugged. It is a good demonstration that the cell is doing the work.
- The ADC pins are being held above their own rail through the clamps. That is
  outside the datasheet's "no voltage on a pin before VDD" guidance, so it is
  not a state to leave it in for months — but at 0.26 mA it cannot damage the
  part, and the board simply stays off.

**Measured on the bench (2026-11-15):** USB unplugged, torch on the panel — the
red LED glowed and the board stayed off. No phantom boot, no reset when USB was
reconnected, and the readings returned to normal. That is the whole chain
working with the controller out of the picture.

If you want the pins electrically isolated when unpowered (the belt-and-braces
option), a small Schottky in series with each tap — anode to the panel side,
cathode to the pin — blocks the back-feed. It costs a ~0.2 V drop (so the volts
read low and `sense_ohms`-style scaling would need a correction) and its reverse
leakage adds a few counts at low light; a low-leakage part (e.g. BAV199) is
better than a BAT54 here. The simpler answer for an exhibit is a **panel
disconnect** when it is packed away, or just keep the board powered whenever the
panel is in the light.
