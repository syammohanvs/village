import type { AppSettings, StateEnvelope } from '../types';

export interface StateOptions {
  connected?: boolean;
  stale?: boolean;
  ageMs?: number | null;
  watering?: boolean;
  pumpCommissioned?: boolean;
  pumpCommanded?: boolean;
  soilPercent?: number | null;
  soilState?: 'dry' | 'adequate' | 'wet' | 'uncalibrated' | 'unavailable';
  soilCalibrated?: boolean;
  reservoirState?: 'available' | 'low' | 'uncalibrated' | 'unavailable';
  lightBrightness?: 'bright' | 'dark' | 'unknown';
  lightsMode?: 'auto' | 'manual' | 'unknown';
  lightsCommanded?: boolean;
  lastError?: string | null;
  sourceKind?: string;
  sourceLabel?: string;
}

export function makeState(options: StateOptions = {}): StateEnvelope {
  const {
    connected = true,
    stale = false,
    ageMs = 420,
    watering = false,
    pumpCommissioned = true,
    pumpCommanded = false,
    soilPercent = 27.6,
    soilState = 'dry',
    soilCalibrated = true,
    reservoirState = 'available',
    lightBrightness = 'dark',
    lightsMode = 'auto',
    lightsCommanded = false,
    lastError = null,
    sourceKind = 'esp32',
    sourceLabel = 'ESP32 over Wi-Fi',
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
          valid: lightBrightness !== 'unknown',
          raw: 1980,
          brightness: lightBrightness,
          output_type: 'analog',
          age_ms: 240,
          fault: null,
        },
        bins: [
          {
            id: 'organic',
            installed: true,
            valid: true,
            distance_cm: 38.4,
            fill_pct_estimate: 45.5,
            state: 'available',
            age_ms: 310,
            fault: null,
            near_blind_zone: false,
          },
          {
            id: 'plastic',
            installed: true,
            valid: true,
            distance_cm: 14,
            fill_pct_estimate: 95.8,
            state: 'full',
            age_ms: 760,
            fault: null,
            near_blind_zone: false,
          },
          {
            id: 'paper',
            installed: true,
            valid: false,
            distance_cm: null,
            fill_pct_estimate: null,
            state: 'unavailable',
            age_ms: 2400,
            fault: 'no echo',
            near_blind_zone: false,
          },
        ],
      },
      actuators: {
        pump: {
          commanded: pumpCommanded,
          commissioned: pumpCommissioned,
          feedback: 'none',
        },
        streetlights: {
          mode: lightsMode,
          commanded: lightsCommanded,
          led_count: 4,
          installed: true,
          feedback: 'none',
        },
        waste_indicator: {
          category: null,
          active: false,
          remaining_ms: 0,
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

export function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    language: 'en',
    tts_enabled: false,
    waste_model_path: '/models/waste/',
    camera_device_id: null,
    waste_confidence: 0.62,
    waste_stability_frames: 4,
    waste_cooldown_ms: 8000,
    updated_at: '2026-11-07T10:00:00Z',
    ...overrides,
  };
}
