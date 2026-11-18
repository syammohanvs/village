import type { AppSettings, DeviceConfig, DeviceConfigDocument } from '../types';
import { makeState, type StateOptions } from '../lib/demoState';

// The frame builder lives in `lib/demoState.ts` because the browser-only demo
// copy uses it too; the fixture re-exports it so tests import one thing.
export { makeState };
export type { StateOptions };

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

export function makeConfig(overrides: Partial<DeviceConfig> = {}): DeviceConfig {
  return {
    soil: { dry_raw: 4095, wet_raw: 1460, min_span_raw: 400, samples: 9, max_age_ms: 5000, calibrated: true, rises_with_moisture: false },
    reservoir: {
      wet_threshold_mv: 2300,
      dry_threshold_mv: 2800,
      confirm_readings: 3,
      max_age_ms: 5000,
      calibrated: true,
    },
    light: {
      installed: true,
      sensor_fitted: true,
      output_type: 'digital',
      analog_bright_high: true,
      digital_dark_when_high: true,
      dark_threshold: 1600,
      bright_threshold: 2400,
      stable_ms: 4000,
      max_age_ms: 5000,
    },
    irrigation: {
      auto_enabled: true,
      pump_enabled: false,
      dry_start_pct: 35,
      stop_pct: 55,
      dry_confirm_ms: 30000,
      pulse_ms: 8000,
      max_pulse_ms: 8000,
      soak_ms: 45000,
      max_cumulative_ms: 30000,
      max_pulses: 4,
      cooldown_ms: 300000,
      link_timeout_ms: 30000,
    },
    waste: { indicate_ms: 8000 },
    ...overrides,
  };
}

export function makeConfigDocument(revision = 4, overrides: Partial<DeviceConfig> = {}): DeviceConfigDocument {
  return { protocol_version: 1, device_id: 'village-test', config_revision: revision, config: makeConfig(overrides) };
}
