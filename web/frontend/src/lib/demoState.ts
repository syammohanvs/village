import type { StateEnvelope, WindReading } from '../types';

/**
 * A complete, plausible village frame — the shape `/api/v1/state` answers with.
 *
 * Born as a test fixture, and used by the browser-only demo copy as well: one
 * definition of "what a frame looks like", so the hosted page cannot show a
 * shape the real backend never sends.
 */
export interface StateOptions {
  connected?: boolean;
  stale?: boolean;
  ageMs?: number | null;
  watering?: boolean;
  pumpCommissioned?: boolean;
  pumpCommanded?: boolean;
  /** The pump's own switch: auto (the rules), on or off (the operator). */
  pumpMode?: 'auto' | 'on' | 'off';
  soilPercent?: number | null;
  soilState?: 'dry' | 'adequate' | 'wet' | 'uncalibrated' | 'unavailable';
  soilCalibrated?: boolean;
  reservoirState?: 'available' | 'low' | 'uncalibrated' | 'unavailable';
  lightBrightness?: 'bright' | 'dark' | 'unknown';
  lightInstalled?: boolean;
  /** Panel volts on VN. Omit for "no solar reading yet". */
  solarMillivolts?: number | null;
  /** Wind **resistor** millivolts (the ADC tap); null means no reading at all. */
  windMillivolts?: number | null;
  windInstalled?: boolean;
  solarCurrentMa?: number;
  solarPowerMw?: number;
  solarValid?: boolean;
  lightsMode?: 'auto' | 'manual_on' | 'manual_off';
  lightsCommanded?: boolean;
  lastError?: string | null;
  sourceKind?: string;
  sourceLabel?: string;
  testEnabled?: boolean;
  testPump?: boolean;
  wasteCategory?: 'organic' | 'plastic' | 'paper' | null;
  lightMetric?: number;
}

/**
 * The wind circuit, calculated the same way the board calculates it.
 *
 * generator + → blue LED → ADC junction → 47 Ω → ground, so the ADC reads the
 * resistor: I = Vr / 47, V = Vr + 2.8, P = V × I — and below the noise floor
 * there is no current, so there is no generator voltage to report (`voltage_v`
 * is null, not 2.8).
 */
function windReading(resistorMv: number, installed: boolean): WindReading {
  const senseOhms = 47;
  const ledForwardMv = 2800;
  const noiseFloorMv = 150;
  const measuring = resistorMv > noiseFloorMv;
  const currentMa = measuring ? resistorMv / senseOhms : 0;
  const voltageMv = measuring ? resistorMv + ledForwardMv : null;
  return {
    installed,
    raw: 0,
    resistor_millivolts: resistorMv,
    millivolts: resistorMv,
    sense_ohms: senseOhms,
    led_forward_millivolts: ledForwardMv,
    noise_floor_millivolts: noiseFloorMv,
    measuring,
    voltage_millivolts: voltageMv,
    voltage_v: voltageMv === null ? null : voltageMv / 1000,
    current_ma: currentMa,
    power_mw: voltageMv === null ? 0 : (voltageMv / 1000) * currentMa,
    generating: installed && measuring,
    valid: installed,
  };
}

export function makeState(options: StateOptions = {}): StateEnvelope {
  const {
    connected = true,
    stale = false,
    ageMs = 420,
    watering = false,
    pumpCommissioned = true,
    pumpCommanded = false,
    pumpMode = 'auto',
    soilPercent = 27.6,
    soilState = 'dry',
    soilCalibrated = true,
    reservoirState = 'available',
    lightBrightness = 'dark',
    lightInstalled = true,
    windMillivolts = null,
    windInstalled = false,
    solarMillivolts = 142,
    solarCurrentMa = 0,
    solarPowerMw = 0,
    solarValid = true,
    lightsMode = 'auto',
    lightsCommanded = false,
    lastError = null,
    sourceKind = 'esp32',
    sourceLabel = 'ESP32 over Wi-Fi',
    testEnabled = false,
    testPump = false,
    wasteCategory = null,
    lightMetric = 1820,
  } = options;

  return {
    mode: 'live',
    physical: true,
    source: { kind: sourceKind, label: sourceLabel },
    server_time: '2026-11-07T12:34:56.789Z',
    connection: {
      connected,
      stale,
      age_ms: ageMs,
      last_success_at: '2026-11-07T12:34:56.300Z',
      last_error: lastError,
      boot_id: 'b-test-1',
      device_id: 'village-test',
      reconnects: 1,
    },
    status: {
      protocol_version: 1,
      device_id: 'village-test',
      boot_id: 'b-test-1',
      uptime_ms: 84_210,
      sample_seq: 512,
      config_revision: 4,
      // Test mode (Setup → Test outputs): absent in an older payload, so the
      // page must treat "no block" as off.
      test: {
        enabled: testEnabled,
        pump: testPump,
        pump_pin: testPump,
        leds: { organic: false, plastic: false, paper: false, streetlights: false },
      },
      sensors: {
        soil: {
          valid: soilState !== 'unavailable',
          calibrated: soilCalibrated,
          raw: 2310,
          percent: soilCalibrated ? soilPercent : null,
          state: soilState,
          age_ms: 180,
          fault: null,
        },
        reservoir: {
          valid: reservoirState !== 'unavailable',
          calibrated: reservoirState !== 'uncalibrated',
          state: reservoirState,
          millivolts: 640,
          conductive: reservoirState === 'available',
          age_ms: 820,
          fault: null,
        },
        light: {
          installed: lightInstalled,
          valid: lightInstalled && lightBrightness !== 'unknown',
          // The metric the exhibit's slider speaks; the page derives the same
          // number from `raw` when a real board omits it.
          raw: lightInstalled ? Math.max(0, 4095 - lightMetric) : null,
          metric: lightMetric,
          brightness: lightBrightness,
          output_type: 'analog',
          age_ms: 240,
          fault: null,
        },
        solar:
          solarMillivolts === null
            ? undefined
            : {
                installed: true,
                raw: 0,
                millivolts: solarMillivolts,
                volts: solarMillivolts / 1000,
                junction_millivolts: solarCurrentMa > 0 ? 1800 : solarMillivolts,
                sense_ohms: 330,
                drop_millivolts: 0,
                current_ma: solarCurrentMa,
                power_mw: solarPowerMw,
                valid: solarValid,
              },
        wind:
          windMillivolts === null
            ? undefined
            : windReading(windMillivolts, windInstalled),
      },
      actuators: {
        pump: {
          // A running session and a manual On both put the pad high; the
          // fixture keeps the two facts consistent so a test can say either.
          commanded: pumpCommanded || watering,
          mode: pumpMode,
          pin_high: pumpCommanded || watering,
          commissioned: pumpCommissioned,
          feedback: 'none',
        },
        streetlights: {
          mode: lightsMode,
          commanded: lightsCommanded,
          led_count: 5,
          installed: true,
          feedback: 'none',
        },
        waste_indicator: {
          category: wasteCategory,
          active: wasteCategory !== null,
          remaining_ms: wasteCategory ? 8000 : 0,
        },
      },
      irrigation: {
        auto_enabled: true,
        state: watering ? 'pumping' : 'idle',
        session: watering ? 'manual' : 'none',
        pulses_done: watering ? 1 : 0,
        pulse_limit: 4,
        cumulative_pump_ms: watering ? 4000 : 0,
        max_cumulative_pump_ms: 15_000,
        cooldown_remaining_ms: 0,
        reason_code: watering ? 'IRRIGATION_STARTED' : 'IDLE_SOIL_DRY',
        reason: watering
          ? 'Soil is dry and water is available. A short pulse is running.'
          : 'Soil is dry and water is available, so the controller is ready to start a pulse.',
        last_session: null,
      },
      faults: [],
      recent_events: [
        {
          at_uptime_ms: 82_000,
          code: 'IDLE_SOIL_DRY',
          text: 'Soil is dry and water is available, so the controller is ready to start a pulse.',
        },
      ],
    },
  };
}
