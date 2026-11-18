import { makeState } from './demoState';
import type { CommandResponse, EventsResponse, Mode, StateEnvelope } from '../types';

/**
 * The village with no village service behind it.
 *
 * The hosted copy of the dashboard (Cloudflare Pages) is a static bundle: there
 * is no controller to poll, no pump to run and no model to ask.  This file is
 * what the page talks to instead — a small, honest simulation that keeps the
 * cards alive so a visitor can see how the exhibit behaves.
 *
 * Two rules it exists to obey:
 *
 *  - **It is never Live.** Everything it answers is `mode: 'demo'`, the page
 *    says "Demo copy", and Live/Test are locked.  An invented reading must
 *    never be mistaken for the board's.
 *  - **It is only used when there is no backend at all** (`api.ts` switches to
 *    it after `/auth/session` cannot be answered).  The exhibit laptop always
 *    has its own service, so nothing here changes what it does.
 *
 * The rules are the *visible* ones, in a few lines: soil dries, a dry soil with
 * water starts a pulse, the pulse wets the soil and drains the tank, the lights
 * follow the daylight, the panel follows the light.  It is a demonstration, not
 * the controller — the firmware's pulse/soak bookkeeping is not reproduced.
 */

interface World {
  soilPct: number;
  tank: 'available' | 'low';
  lightMetric: number;
  solarMv: number;
  windMv: number | null;
  pump: 'auto' | 'on' | 'off';
  pumping: boolean;
  soakLeft: number;
  lights: 'auto' | 'manual_on' | 'manual_off';
  waste: 'organic' | 'plastic' | 'paper' | null;
  wasteLeft: number;
  /** Seconds of water taken from the tank; a full tank lasts a while. */
  pumpedSeconds: number;
}

const SOIL_DRY_PCT = 30;
const SOIL_DRY_PER_S = 0.18;
const SOIL_WET_PER_S = 1.2;
const SOAK_SECONDS = 18;
const PULSE_SECONDS = 5;
const TANK_SECONDS = 90;
const WASTE_SECONDS = 8;

function world(): World {
  return {
    soilPct: 27.6,
    tank: 'available',
    lightMetric: 1820,
    solarMv: 142,
    windMv: null,
    pump: 'auto',
    pumping: false,
    soakLeft: 0,
    lights: 'auto',
    waste: null,
    wasteLeft: 0,
    pumpedSeconds: 0,
  };
}

export class LocalVillage {
  private state: World = world();
  private pulseLeft = 0;
  private last = Date.now();
  private events: { at: string; kind: string; text: string }[] = [];

  // ---------------------------------------------------------------- the clock
  private advance(): void {
    const now = Date.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    // A backgrounded tab can come back with minutes of "time" passed; a jump
    // that large is a gap in the demo, not a drought.
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 5);
    // `dt` of zero is still worth a pass: the pump's rule is evaluated here too,
    // so the very first read of a dry village already shows the pulse starting.
    const s = this.state;

    if (s.wasteLeft > 0) s.wasteLeft = Math.max(0, s.wasteLeft - dt);
    if (s.wasteLeft === 0) s.waste = null;

    // The pump: the operator's switch, or the rule, with a soak between pulses.
    if (s.pumping) {
      this.pulseLeft -= dt;
      s.soilPct = Math.min(100, s.soilPct + SOIL_WET_PER_S * dt);
      s.pumpedSeconds += dt;
      if (s.pumpedSeconds >= TANK_SECONDS) {
        s.tank = 'low';
        s.pumping = false;
        this.note('TANK_LOW', 'The rain water tank is low, so watering stops.');
      }
      if (this.pulseLeft <= 0) {
        s.pumping = false;
        s.soakLeft = SOAK_SECONDS;
      }
    } else {
      s.soilPct = Math.max(4, s.soilPct - SOIL_DRY_PER_S * dt);
      if (s.soakLeft > 0) s.soakLeft = Math.max(0, s.soakLeft - dt);
      const wantsWater =
        s.pump === 'on' ||
        (s.pump === 'auto' && s.soilPct < SOIL_DRY_PCT && s.soakLeft === 0);
      if (wantsWater && s.tank === 'available') {
        s.pumping = true;
        this.pulseLeft = PULSE_SECONDS;
        this.note('IRRIGATION_STARTED', 'A short watering pulse is running.');
      }
    }

    // Daylight drifts slowly, so the lamps have something to follow.
    s.lightMetric = Math.max(
      300,
      Math.min(3300, s.lightMetric + Math.sin(now / 45_000) * 12),
    );
    // The panel's volts follow the light; a red LED needs ~1.8 V to conduct.
    const wanted = s.lightMetric > 2100 ? 1800 + s.lightMetric / 3 : 142;
    s.solarMv = Math.round(s.solarMv + (wanted - s.solarMv) * Math.min(1, dt / 2));
  }

  private note(kind: string, text: string): void {
    this.events.unshift({ at: new Date().toISOString(), kind, text });
    this.events = this.events.slice(0, 40);
  }

  // ------------------------------------------------------------------ reading
  frame(mode: Mode = 'demo'): StateEnvelope {
    this.advance();
    const s = this.state;
    const dark = s.lightMetric < 2100;
    const lightsCommanded =
      s.lights === 'manual_on' ? true : s.lights === 'manual_off' ? false : dark;
    const mv = s.solarMv;
    const current = mv > 1800 ? (mv - 1800) / 330 : 0;
    const soilPct = Math.round(s.soilPct * 10) / 10;

    const state = makeState({
      connected: false,
      stale: false,
      ageMs: 0,
      watering: s.pumping,
      pumpMode: s.pump,
      pumpCommanded: s.pumping,
      soilPercent: soilPct,
      soilState: soilPct < SOIL_DRY_PCT ? 'dry' : soilPct > 70 ? 'wet' : 'adequate',
      reservoirState: s.tank,
      lightBrightness: dark ? 'dark' : 'bright',
      lightsMode: s.lights,
      lightsCommanded,
      solarMillivolts: Math.round(mv),
      solarCurrentMa: Math.round(current * 100) / 100,
      solarPowerMw: Math.round(Math.max(0, mv - 1830) * current * 100) / 100,
      lightMetric: Math.round(s.lightMetric),
      sourceKind: 'demo',
      sourceLabel: 'Demo copy (no controller)',
      lastError: 'No village service in this copy',
      wasteCategory: s.waste,
    });

    state.mode = mode;
    state.physical = false;
    state.simulator = {
      // Setup's own lab speaks these names; keeping them means the sliders and
      // the quick demonstrations keep working in this copy.
      soil_pct: soilPct,
      tank: s.tank,
      light_metric: Math.round(s.lightMetric),
      solar_light: Math.round(s.lightMetric),
      wind_speed: 0,
      lights_mode: s.lights,
    };
    state.connection.last_error = 'No village service in this copy — showing a built-in demo.';
    return state;
  }

  // ----------------------------------------------------------------- controls
  command(
    type: string,
    parameters: Record<string, unknown>,
    mode: Mode,
  ): CommandResponse {
    this.advance();
    const s = this.state;
    const ack = (reason_code: string, reason: string): CommandResponse => ({
      confirmed: true,
      mode,
      physical: false,
      ack: { result: 'ACCEPTED', reason_code, reason },
      error: null,
      state: this.frame(mode),
    });

    switch (type) {
      case 'LIGHTS_ON':
        s.lights = 'manual_on';
        return ack('LIGHTS_ON', 'The streetlights are held on.');
      case 'LIGHTS_OFF':
        s.lights = 'manual_off';
        return ack('LIGHTS_OFF', 'The streetlights are held off.');
      case 'LIGHTS_AUTO':
        s.lights = 'auto';
        return ack('LIGHTS_AUTO', 'The streetlights follow the daylight again.');
      case 'PUMP_ON':
        s.pump = 'on';
        return ack('PUMP_ON', 'The pump is held on.');
      case 'PUMP_OFF':
        s.pump = 'off';
        s.pumping = false;
        return ack('PUMP_OFF', 'The pump is held off.');
      case 'PUMP_AUTO':
        s.pump = 'auto';
        return ack('PUMP_AUTO', 'The pump follows the readings again.');
      case 'IRRIGATION_REQUEST':
        s.pump = 'on';
        return ack('IRRIGATION_STARTED', 'A watering pulse will run while the tank has water.');
      case 'IRRIGATION_STOP':
        s.pump = 'off';
        s.pumping = false;
        return ack('IRRIGATION_STOPPED', 'Watering stopped.');
      case 'INDICATE_WASTE': {
        const category = String(parameters.category ?? '');
        if (category !== 'organic' && category !== 'plastic' && category !== 'paper') {
          return {
            confirmed: false,
            mode,
            physical: false,
            ack: null,
            error: { code: 'BAD_CATEGORY', message: 'A bin needs organic, plastic or paper.' },
          };
        }
        s.waste = category;
        s.wasteLeft = WASTE_SECONDS;
        return ack('INDICATE_WASTE', `The ${category} bin is lit.`);
      }
      default:
        return {
          confirmed: false,
          mode,
          physical: false,
          ack: null,
          error: {
            code: 'UNSUPPORTED_IN_DEMO',
            message: `This demo copy cannot run ${type}.`,
          },
        };
    }
  }

  /** Setup's simulation lab: the sliders and the quick demonstrations. */
  scenario(patch: Record<string, unknown>): StateEnvelope {
    this.advance();
    const s = this.state;
    if (typeof patch.soil_pct === 'number') s.soilPct = Math.max(0, Math.min(100, patch.soil_pct));
    if (patch.tank === 'available' || patch.tank === 'low') {
      s.tank = patch.tank;
      if (patch.tank === 'available') s.pumpedSeconds = 0;
    }
    if (typeof patch.light_metric === 'number') s.lightMetric = patch.light_metric;
    if (typeof patch.solar_light === 'number') s.lightMetric = patch.solar_light;
    if (patch.lights_mode === 'auto' || patch.lights_mode === 'manual_on' || patch.lights_mode === 'manual_off') {
      s.lights = patch.lights_mode;
    }
    return this.frame('demo');
  }

  reset(): StateEnvelope {
    this.state = world();
    this.pulseLeft = 0;
    this.last = Date.now();
    return this.frame('demo');
  }

  eventsResponse(limit = 100): EventsResponse {
    this.advance();
    return {
      events: this.events.slice(0, limit).map((event, index) => ({
        id: index + 1,
        ts: event.at,
        kind: event.kind,
        text: event.text,
        severity: 'info',
      })),
      total: this.events.length,
    };
  }
}

/** One village per page, so every panel reads the same world. */
export const localVillage = new LocalVillage();
