import { describe, expect, it } from 'vitest';
import { shownRaw, storedRaw } from './soilEndpoints';
import type { DeviceConfig } from '../types';

function config(rises: boolean): DeviceConfig {
  return { soil: { dry_raw: 0, wet_raw: 0, rises_with_moisture: rises } } as unknown as DeviceConfig;
}

/**
 * The boxes on Setup → Sensors show the numbers you measured; the controller
 * stores them inverted unless its flag says otherwise.  Typing measured values
 * used to give 0 % in wet soil (measured 2026-11-18).
 */
describe('the soil endpoints the page shows', () => {
  it('shows and stores the measured values when the reading rises with moisture', () => {
    expect(shownRaw(1597, config(true))).toBe(1597);
    expect(storedRaw(1597, config(true))).toBe(1597);
  });

  it('converts both ways for the pull-up wiring, where the controller inverts', () => {
    expect(shownRaw(2498, config(false))).toBe(1597);   // 4095 - 1597
    expect(storedRaw(1597, config(false))).toBe(2498);
    // A save of what is shown changes nothing.
    expect(storedRaw(shownRaw(3325, config(false)), config(false))).toBe(3325);
  });
});
