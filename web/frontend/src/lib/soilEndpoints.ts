import type { DeviceConfig } from '../types';

/**
 * The two soil endpoints are *stored* in whichever domain the controller's
 * `rises_with_moisture` flag names: with the flag false the firmware inverts
 * the reading (`effective = 4095 - raw`), so the stored numbers are
 * `4095 - raw`.  The page used to ask for the stored ones, so typing the values
 * actually measured gave a backwards calibration — 0 % in wet soil, measured on
 * the board 2026-11-18.
 *
 * The operator measures raw ADC counts, so the page converts both ways and
 * never shows the stored domain.  Either polarity still works: the mapping uses
 * the sign of the pair.
 */
export function shownRaw(stored: number, config: DeviceConfig): number {
  return config.soil.rises_with_moisture ? stored : 4095 - stored;
}

export function storedRaw(shown: number, config: DeviceConfig): number {
  return config.soil.rises_with_moisture ? shown : 4095 - shown;
}
