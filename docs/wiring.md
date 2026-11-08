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

## 2. GPIO allocation (18 signals)

| Function | GPIO | Header label | Direction | Why this pin |
| --- | ---: | --- | --- | --- |
| Soil moisture analogue | **34** | D34 | ADC input | ADC1_CH6, input-only |
| Reservoir probe sense | **35** | D35 | ADC input | ADC1_CH7, input-only |
| Reservoir probe excitation | **25** | D25 | Digital output | Safe output; high-Z between reads |
| LDR analogue/digital | **32** | D32 | ADC/digital input | ADC1_CH4 |
| Pump MOSFET gate | **26** | D26 | Digital output | Safe output, boot-low |
| Streetlight LED 1 | **13** | D13 | Digital output | Safe output |
| Streetlight LED 2 | **14** | D14 | Digital output | Safe output |
| Streetlight LED 3 | **19** | D19 | Digital output | Safe output |
| Streetlight LED 4 | **21** | D21 | Digital output | Safe output |
| Waste LED — organic | **33** | D33 | Digital output | Safe output |
| Waste LED — plastic | **22** | D22 | Digital output | Safe output |
| Waste LED — paper | **23** | D23 | Digital output | Safe output |
| Bin 1 trigger (organic) | **4** | D4 | Digital output | Safe output |
| Bin 1 echo | **36** | VP | Digital input | Input-only; **needs divider** |
| Bin 2 trigger (plastic) | **16** | D16 | Digital output | Safe output (WROOM only) |
| Bin 2 echo | **39** | VN | Digital input | Input-only; **needs divider** |
| Bin 3 trigger (paper) | **17** | D17 | Digital output | Safe output (WROOM only) |
| Bin 3 echo | **18** | D18 | Digital input | Safe input; **needs divider** |
| Spare | 27 | D27 | — | One safe output left free |

### Why not other pins

| GPIO | Reason not used |
| --- | --- |
| 0 | BOOT strapping; not broken out on this 30-pin board. |
| 1, 3 | UART0 TX/RX used by the USB programmer and serial log. |
| 2, 5, 12, 15 | Boot-strapping pins; 2/15 also pulse at boot. Kept free. |
| 6–11 | Connected to the SPI flash; not exposed. |
| 34, 35, 36, 39 | Input-only. Used only for inputs (34/35 analogue, 36/39 echo). |

All analogue measurements use **ADC1** (GPIO 32, 34, 35). ADC2 shares hardware
with the Wi-Fi radio and is not reliable while Wi-Fi is active. GPIO 25 and 26
are ADC2-capable but are used only as digital outputs here, which is safe.

The firmware's `uc/include/village/pins.h` encodes all of this and has
`static_assert` checks for ADC1, input-only, strapping, flash and duplicate
pins. A bad edit fails the build.

**GPIO budget:** 25 GPIOs are exposed (23 excluding UART0). 18 are assigned;
4 of the remaining 5 are strapping pins deliberately avoided; 1 (GPIO 27) is a
spare safe output. There is no shortage for this build.

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

## 4. Pump driver — the unidentified component

The exact three-legged power component purchased with the pump has **not been
identified**. Do not assume it is a MOSFET, do not assume its pinout, and do
not connect it until it is identified.

Required driver interface:

| Property | Requirement |
| --- | --- |
| Type | Logic-level N-channel MOSFET (preferred) or a driver module with a transistor/optocoupler. |
| Gate threshold | Must switch fully on at **Vgs ≤ 3.3 V**. |
| Current | Rated above the pump's measured stall current, with margin. |
| Gate resistor | 220 Ω–1 kΩ in series from GPIO 26. |
| Gate pull-down | 10 kΩ from gate to GND, so the pump is off while the ESP32 boots. |
| Flyback | Diode across the pump, cathode to +5 V. |
| Ground | MOSFET source to the common ground. |

Good candidates for a small 3–6 V pump are AO3400, IRLML2502 or a comparable
logic-level MOSFET. An IRF520 module is often sold as “3.3 V compatible” but
its threshold is marginal at 3.3 V; measure it rather than trusting the label.

If the component turns out to be a linear regulator, a BJT without a base
resistor, or a module with an unknown pinout, **do not use it**. Replace it
with a known logic-level MOSFET or a relay module and document the change.

## 5. Sensors

### Soil moisture probe

- Interface board VCC to **3.3 V** (preferred) and GND to common ground.
- AO to **GPIO 34**. If the board is powered from 5 V, measure AO first: it may
  exceed 3.3 V, in which case use a divider (e.g. 10 kΩ / 20 kΩ) or power the
  board from 3.3 V.
- The probe is resistive and will corrode if continuously powered. Power it
  from 3.3 V only while the exhibit is running, and keep the probe out of
  standing water when not in use.
- Calibration is two raw readings: dry soil and wet soil. The firmware accepts
  either polarity.

### Reservoir probes (two wires, one level)

```
 GPIO 25 ──[ 47 kΩ ]──●──── probe A
                       │
                  GPIO 35 (ADC1, 11 dB)
                       │
                    probe B ── GND
```

- Drive GPIO 25 HIGH for a short measurement, wait **≥ 5 ms** for the node to
  settle, average several ADC samples, then set GPIO 25 to `INPUT` (high
  impedance, no pull-up/pull-down).
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

### LDR module

- VCC 3.3 V, GND common, AO to **GPIO 32**.
- **The controller starts with the LDR and streetlights marked as not
  installed.** A board with nothing on GPIO 32 reads plausible-looking noise,
  so it reports no light level and keeps the lamps off rather than inventing a
  "dark" observation. Once the module and the four LEDs are wired, tick
  **The LDR and streetlight lamps are wired** on **Sensors** (or set
  `light.installed` to `true` in the configuration) and save.
- If the module has only a digital output, connect DO to GPIO 32 and set
  `light.output_type` to `digital` in the configuration.
- Typical modules output HIGH in darkness on DO; the configuration has
  `digital_dark_when_high` for this. Verify with a lamp and a hand.
- Analogue polarity differs between modules. Set `analog_bright_high`
  according to the measured behaviour. Hysteresis and a 4 s stable delay stop
  the streetlights flickering at dusk.

### HC-SR04 bins

- VCC **5 V**, GND common. Trig accepts a 3.3 V pulse.
- Echo is a **5 V output**. Reduce it before the ESP32:

```
 Echo (5 V) ──[ 1 kΩ ]──●── ESP32 GPIO (36 / 39 / 18)
                        │
                     [ 2 kΩ ]
                        │
                       GND
```

  Vout = 5 × 2 / (1 + 2) = **3.33 V**, within the 3.3 V input range. Do not
  connect Echo directly to any ESP32 pin.
- Mount each sensor above its bin looking down. Measure the distance to the
  **empty floor** (`empty_cm`) and to the **full line** (`full_cm`) with a
  ruler. The fill figure is an **estimated height**, not a measured volume.
- Read the three sensors **one at a time**, at least 100 ms apart, to avoid
  cross-talk. The firmware does this.
- The HC-SR04 has a near blind zone of roughly 2–4 cm. A reading inside it is
  treated as “full at the sensor” and flagged, not as a healthy empty bin.
- A missing echo sets the bin to **unavailable**. It never becomes an empty
  bin.

## 6. LEDs

Each LED needs its own series resistor:

```
 GPIO ──[ 220 Ω ]──▶|── GND        (3.3 V LED, ~6 mA)
```

- Four streetlight LEDs on GPIO 13, 14, 19, 21, each with 220 Ω.
- Organic = GPIO 33, plastic = GPIO 22, paper = GPIO 23, each with 220 Ω.
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
  the bin. The indicator LED is a prompt, not a disposal record.
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
5. Test each LED with the Controls page; measure the resistor current.
6. Test each HC-SR04 with a hand at 10 cm, 30 cm and beyond range; confirm
   “unavailable” when disconnected, never “empty”.
7. Test the pump driver with a **dummy load** (a 5 V lamp or a resistor + LED)
   before the pump. Confirm the gate switches, the flyback diode is the right
   way round, and the MOSFET does not overheat.
8. Connect the pump **in water**, never dry. Measure the running and stall
   current. Confirm the 5 V supply holds up.
9. Calibrate soil (dry and wet), reservoir (dry and wet), and all three bins.
10. Run the acceptance tests in `docs/bench-test.md`, then commission the pump.

## 9. Commissioning the pump

The pump is protected by two independent gates:

1. Compile-time: `VILLAGE_PUMP_COMMISSIONED` in
   `uc/include/village/build_config.h` is `0` by default.
2. Runtime: `config.irrigation.pump_enabled` is `false` by default and is
   stored in NVS.

After the bench test passes:

1. Set `VILLAGE_PUMP_COMMISSIONED 1` and reflash.
2. In **Controls → Pump commissioning**, read the safety checklist and enable
   the pump. The device accepts this only when the compile-time gate is open.
3. Fill the reservoir, place the probes, and run one short pulse with the
   pump in water while watching the current.
4. Record the result in `docs/bench-test.md`.

If either gate is closed, every irrigation start is rejected with
`IRRIGATION_BLOCKED_PUMP_NOT_COMMISSIONED`; the rest of the village still runs.
