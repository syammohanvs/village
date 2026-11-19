// Central pin map for the 30-pin ESP32-WROOM-32 DevKit V1 board.
//
// Every entry is a GPIO number, never a physical header position.  The
// physical order of a 30-pin NodeMCU-style board is not the same as the
// logical GPIO order, so the wiring table in docs/wiring.md and this header
// are the authority.
//
// Board evidence (recorded 2026-11-07):
//   product page : roboticscomp.in "Nodemcu Wifi Development Board Esp32 30pin"
//   module photo : ESP32-WROOM-32 shield, AMS1117 regulator, micro-USB,
//                  30 pins, 32 Mbit (4 MB) flash.
//   silkscreen   : EN VP VN D34 D35 D32 D33 D25 D26 D27 D14 D12 D13 GND VIN
//                  D23 D22 TX0 RX0 D21 D19 D18 D5 D17 D16 D4 D2 D15 GND 3V3
//
// The physical board still has to be checked against this map before it is
// treated as verified: module marking (WROOM-32 not WROVER), the USB-serial
// chip, header continuity, and the actual ADC behaviour of this clone.
#pragma once

#include <cstddef>
#include <cstdint>

namespace village {
namespace pins {

inline constexpr const char* kBoardProfile = "esp32doit-devkit-v1";
inline constexpr const char* kBoardDescription =
    "30-pin NodeMCU-style ESP32-WROOM-32 DevKit V1";
inline constexpr const char* kPinMapVersion = "1.6.0-30pin";
inline constexpr std::size_t kHeaderPins = 30;

inline constexpr bool isAdc1(int gpio) {
  switch (gpio) {
    case 32:
    case 33:
    case 34:
    case 35:
    case 36:
    case 39:
      return true;
    default:
      return false;
  }
}

inline constexpr bool isAdc2(int gpio) {
  switch (gpio) {
    case 0:
    case 2:
    case 4:
    case 12:
    case 13:
    case 14:
    case 15:
    case 25:
    case 26:
    case 27:
      return true;
    default:
      return false;
  }
}

inline constexpr bool isInputOnly(int gpio) {
  return gpio == 34 || gpio == 35 || gpio == 36 || gpio == 39;
}

inline constexpr bool isFlashPin(int gpio) {
  return gpio >= 6 && gpio <= 11;
}

inline constexpr bool isStrappingPin(int gpio) {
  switch (gpio) {
    case 0:   // BOOT button; not broken out on most 30-pin boards
    case 2:   // must not be held high at boot
    case 5:   // outputs a boot log pulse
    case 12:  // MTDI; must be low at boot on 3.3 V flash boards
    case 15:  // strapping; outputs a boot log pulse
      return true;
    default:
      return false;
  }
}

inline constexpr bool isUart0(int gpio) { return gpio == 1 || gpio == 3; }

// GPIOs broken out on the 30-pin board photographed for this project.
inline constexpr bool isExposed(int gpio) {
  switch (gpio) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 12:
    case 13:
    case 14:
    case 15:
    case 16:
    case 17:
    case 18:
    case 19:
    case 21:
    case 22:
    case 23:
    case 25:
    case 26:
    case 27:
    case 32:
    case 33:
    case 34:
    case 35:
    case 36:
    case 39:
      return true;
    default:
      return false;
  }
}

// An output we are willing to drive.  Avoids flash, input-only, strapping
// and the UART0 pins used by the USB programmer.
inline constexpr bool isSafeOutput(int gpio) {
  return isExposed(gpio) && !isFlashPin(gpio) && !isInputOnly(gpio) &&
         !isStrappingPin(gpio) && !isUart0(gpio);
}

// GPIO12 is the one strapping pin allowed, and ONLY for a source-wired lamp:
//
//   GPIO12 ──[ R ]──▶|── GND
//
// At reset the pin is high-impedance and that path pulls it LOW, which is the
// level the flash-voltage strapping needs.  Never wire a lamp the other way
// (3V3 -> lamp -> pin): that pulls the pin HIGH at boot and the board may not
// start.  Every other strapping pin stays banned for outputs.
inline constexpr bool isSafeLampOutput(int gpio) {
  return isSafeOutput(gpio) || gpio == 12;
}

// Analog use is restricted to ADC1 because Wi-Fi is active for the whole
// exhibition.  ADC2 is shared with the radio and is not usable reliably.
inline constexpr bool isSafeAnalog(int gpio) {
  return isExposed(gpio) && isAdc1(gpio);
}

// ---------------------------------------------------------------------------
// Proposed allocation.  All numbers are GPIO numbers.
// ---------------------------------------------------------------------------

// Analogue sensors (ADC1 only).
inline constexpr int SOIL_MOISTURE_ADC = 34;   // ADC1_CH6, input-only
inline constexpr int RESERVOIR_SENSE_ADC = 35; // ADC1_CH7, input-only
// VN (GPIO 39) rather than D33: it is input-only like VP, so the two solar taps
// sit together on the header, and D33 goes back to being free.  Same 0-3.3 V
// range and the same 10k protection.
inline constexpr int SOLAR_PANEL_ADC = 39;     // ADC1_CH3, input-only (solar panel voltage, 0-3.3V)
inline constexpr int SOLAR_CURRENT_ADC = 36;   // ADC1_CH0, input-only (junction between sense resistor and LED)
inline constexpr int LDR_ADC = 32;             // ADC1_CH4, analogue or digital

// Reservoir probe excitation.  Driven HIGH only for a short measurement,
// then returned to high impedance (INPUT, no pull).
inline constexpr int RESERVOIR_EXCITE = 25;

// Pump MOSFET gate.  The pump itself is powered from the 5 V rail through
// the driver; this GPIO only carries the logic signal.  D19 sits on the free
// header side beside the waste LEDs, so the low-current signal leaves the
// board on one edge.
inline constexpr int PUMP_GATE = 19;

// All five streetlight lamps are driven from ONE GPIO (D13), each with its
// own series resistor.  One pin carries the combined current (about 9 mA for
// white LEDs at 220 Ohm each), which is inside the ESP32's 20 mA per-pin
// recommendation, so a single pin is enough and D12/D14/D27 stay free.
inline constexpr int STREETLIGHT_LED_PIN = 13;
inline constexpr int STREETLIGHT_LAMP_COUNT = 5;

// Three waste-category indicator LEDs.
//
// They sit together on the free header side (D21, D22, D23) so the three
// indicator cables leave the board on one edge, away from the lamp loom and
// the sensor headers.  None of the three is a strapping pin.
inline constexpr int WASTE_LED_ORGANIC = 21;
inline constexpr int WASTE_LED_PLASTIC = 22;
inline constexpr int WASTE_LED_PAPER = 23;

// The bins have INDICATOR LEDS ONLY.  There is no level sensing of any kind:
// no time-of-flight or ultrasonic rangefinders, no fill percentage and no
// "bin full" alert.  A bin is a container a person can see into; the three LEDs
// say which category the camera last recognised, nothing more.
//
// The five pins the rangefinders used are now free: GPIO 4 and 16 (the old I2C
// bus) and 17, 18 and 26 (the old XSHUT lines).  They are left unassigned so a
// later addition has somewhere to go.
//
// GPIO 2/5/15 are strapping pins that stay unused, and GPIO 1/3 remain the USB
// serial console.  D33 is the named spare.
// The last free ADC1 pin, and the only one left: every other ADC1 pin carries a
// sensor, and ADC2 cannot be used while Wi-Fi runs.  Since 2026-11-20 this is
// the wind **current** tap (the voltage across the 47 ohm resistor), not the
// generator's own voltage -- see docs/wiring.md section 11.
inline constexpr int SPARE_INPUT = 33;
inline constexpr int WIND_ADC = SPARE_INPUT;  // ADC1_CH5, input-only

// Pins deliberately left free for future work.  Kept as a list so a build that
// starts using one fails the uniqueness check rather than colliding silently.
inline constexpr int kFreePins[] = {4, 16, 17, 18, 26};

// ---------------------------------------------------------------------------
// Compile-time checks.  A bad edit fails the build rather than the exhibit.
// ---------------------------------------------------------------------------

static_assert(isSafeAnalog(SOIL_MOISTURE_ADC),
              "soil moisture must be on an exposed ADC1 pin");
static_assert(isSafeAnalog(RESERVOIR_SENSE_ADC),
              "reservoir sense must be on an exposed ADC1 pin");
static_assert(isSafeAnalog(LDR_ADC), "LDR must be on an exposed ADC1 pin");
static_assert(isSafeAnalog(SOLAR_PANEL_ADC),
              "solar panel voltage must be on an exposed ADC1 pin");
static_assert(isSafeAnalog(SOLAR_CURRENT_ADC),
              "solar current sense must be on an exposed ADC1 pin");
static_assert(isSafeAnalog(WIND_ADC),
              "wind generator voltage must be on an exposed ADC1 pin");
static_assert(isSafeOutput(RESERVOIR_EXCITE),
              "reservoir excitation must be a safe output");
static_assert(isSafeOutput(PUMP_GATE), "pump gate must be a safe output");
static_assert(isSafeOutput(WASTE_LED_ORGANIC), "organic LED must be a safe output");
static_assert(isSafeOutput(WASTE_LED_PLASTIC), "plastic LED must be a safe output");
static_assert(isSafeOutput(WASTE_LED_PAPER), "paper LED must be a safe output");
// The spare used to have to be input-only, because every output-capable pin was
// taken.  Moving the solar panel to VN (39) freed D33, which can drive things --
// so the rule is now "exposed and unassigned", not "input-only".
static_assert(isExposed(SPARE_INPUT), "the spare pin must be on the header");

static_assert(isSafeLampOutput(STREETLIGHT_LED_PIN),
              "the streetlight LED pin must be a safe lamp output");

// Every assigned pin, for the uniqueness check and for diagnostics.
inline constexpr int kAssignedPins[] = {
    SOIL_MOISTURE_ADC, RESERVOIR_SENSE_ADC, LDR_ADC,
    SOLAR_PANEL_ADC,   SOLAR_CURRENT_ADC,
    RESERVOIR_EXCITE,  PUMP_GATE,
    STREETLIGHT_LED_PIN,
    WASTE_LED_ORGANIC, WASTE_LED_PLASTIC, WASTE_LED_PAPER,
};
inline constexpr std::size_t kAssignedPinCount =
    sizeof(kAssignedPins) / sizeof(kAssignedPins[0]);

constexpr bool assignedPinsAreUnique() {
  for (std::size_t i = 0; i < kAssignedPinCount; ++i) {
    for (std::size_t j = i + 1; j < kAssignedPinCount; ++j) {
      if (kAssignedPins[i] == kAssignedPins[j]) return false;
    }
  }
  return true;
}
static_assert(assignedPinsAreUnique(),
              "the same GPIO must not be assigned to two functions");

static_assert(kAssignedPinCount == 11,
              "expected 11 assigned GPIOs for this build (bins are LEDs only)");
static_assert(kAssignedPinCount < kHeaderPins,
              "the 30-pin header must still have spare pins");

constexpr bool freePinsAreUnassigned() {
  for (int free : kFreePins) {
    for (int used : kAssignedPins) {
      if (free == used) return false;
    }
  }
  return true;
}
static_assert(freePinsAreUnassigned(),
              "a pin listed as free must not also be assigned");

}  // namespace pins
}  // namespace village
