import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalVillage } from './localVillage';

/**
 * The village the hosted copy runs on.
 *
 * It exists so a student can see the exhibit without a backend.  What it must
 * never do is claim to be one: every frame is `demo`, `physical` is false, and
 * the source says what it is.  The rules are checked because a page that
 * invents numbers and does not move them is a screenshot, not a demonstration.
 */
describe('the built-in demo village', () => {
  let village: LocalVillage;
  let clock = 1_000_000;

  beforeEach(() => {
    clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    village = new LocalVillage();
  });

  function tick(seconds: number) {
    clock += seconds * 1000;
  }

  it('says what it is, in every frame', () => {
    const frame = village.frame('demo');
    expect(frame.mode).toBe('demo');
    expect(frame.physical).toBe(false);
    expect(frame.source.kind).toBe('demo');
    expect(frame.connection.last_error).toMatch(/no village service/i);
    expect(frame.status?.sensors.soil?.percent).toBeTypeOf('number');
  });

  it('waters a dry soil once, then lets it soak', () => {
    // It starts dry and the pump is on auto, so the first read starts a pulse.
    const first = village.frame('demo');
    expect(first.status?.actuators?.pump?.commanded).toBe(true);
    expect(first.status?.irrigation.state).toBe('pumping');

    tick(1);
    const wetter = village.frame('demo');
    expect(wetter.status?.sensors.soil?.percent ?? 0).toBeGreaterThan(
      first.status?.sensors.soil?.percent ?? 0,
    );

    // The pulse is short: after it, the pump rests even though the soil is
    // still under the threshold - that is the soak.
    tick(10);
    const soaking = village.frame('demo');
    expect(soaking.status?.actuators?.pump?.commanded).toBe(false);
  });

  it('holds the pump on when the operator asks, and stops when asked', () => {
    village.command('PUMP_OFF', {}, 'demo');
    tick(30);
    const off = village.frame('demo');
    expect(off.status?.actuators?.pump?.commanded).toBe(false);

    const on = village.command('PUMP_ON', {}, 'demo');
    expect(on.confirmed).toBe(true);
    expect(on.ack?.result).toBe('ACCEPTED');
    expect(on.state).toBeTruthy();
    tick(1);
    expect(village.frame('demo').status?.actuators?.pump?.commanded).toBe(true);

    village.command('IRRIGATION_STOP', {}, 'demo');
    tick(1);
    expect(village.frame('demo').status?.actuators?.pump?.commanded).toBe(false);
  });

  it('lights the lamps when the daylight goes, and obeys a hand', () => {
    const dark = village.frame('demo');
    // The demo starts at dusk, so Auto has them on.
    expect(dark.status?.actuators?.streetlights?.commanded).toBe(true);

    village.scenario({ light_metric: 3000 });
    tick(1);
    expect(village.frame('demo').status?.actuators?.streetlights?.commanded).toBe(false);

    village.command('LIGHTS_ON', {}, 'demo');
    expect(village.frame('demo').status?.actuators?.streetlights?.commanded).toBe(true);
    village.command('LIGHTS_AUTO', {}, 'demo');
    expect(village.frame('demo').status?.actuators?.streetlights?.mode).toBe('auto');
  });

  it('takes the simulation lab’s own quick buttons, and reset puts the world back', () => {
    // These are the exact bodies the lab sends (`POST /demo/scenario`): "Low
    // water" is `reservoir: 'low'` and "Night" is `light: 'dark'`, and the
    // first version of this file silently ignored both.
    const low = village.scenario({ reservoir: 'low' });
    expect(low.status?.sensors.reservoir?.state).toBe('low');
    expect(low.status?.actuators.pump?.commanded).toBe(false);

    const dry = village.scenario({ soil_pct: 80 });
    expect(dry.status?.sensors.soil?.percent).toBe(80);

    const night = village.scenario({ light: 'dark' });
    expect(night.status?.sensors.light?.brightness).toBe('dark');
    expect(night.status?.actuators.streetlights?.commanded).toBe(true);
    const day = village.scenario({ light: 'bright' });
    expect(day.status?.sensors.light?.brightness).toBe('bright');
    expect(day.status?.actuators.streetlights?.commanded).toBe(false);

    const reset = village.reset();
    expect(reset.status?.sensors.soil?.percent).toBeCloseTo(27.6, 1);
    expect(reset.status?.sensors.reservoir?.state).toBe('available');
  });

  it('stops a pulse that is running when the tank is made low', () => {
    // The controller stops on `IRRIGATION_STOPPED_LOW_WATER`; the demo does the
    // same rather than emptying a tank it has just been told is empty.
    expect(village.frame('demo').status?.actuators.pump?.commanded).toBe(true);
    const low = village.scenario({ reservoir: 'low' });
    expect(low.status?.actuators.pump?.commanded).toBe(false);
    expect(low.status?.irrigation.state).toBe('idle');
  });

  it('lights a bin LED and refuses a category that is not a bin', () => {
    const lit = village.command('INDICATE_WASTE', { category: 'plastic' }, 'demo');
    expect(lit.confirmed).toBe(true);
    expect(village.frame('demo').status?.actuators?.waste_indicator?.category).toBe('plastic');

    const refused = village.command('INDICATE_WASTE', { category: 'glass' }, 'demo');
    expect(refused.confirmed).toBe(false);
    expect(refused.error?.code).toBe('BAD_CATEGORY');
  });

  it('refuses a command it has no rule for, rather than pretending', () => {
    const refused = village.command('TEST_OUTPUT', { output: 'pump', on: true }, 'demo');
    expect(refused.confirmed).toBe(false);
    expect(refused.error?.message).toMatch(/demo copy/i);
  });
});
