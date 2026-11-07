import type { DeviceStatus } from '../types';
import { titleCase } from './format';

export type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'gold';

export interface Explanation {
  key: string;
  label: string;
  headline: string;
  detail: string;
  tone: Tone;
}

export function isWatering(status: DeviceStatus | null): boolean {
  if (!status) return false;
  const state = status.irrigation?.state ?? 'idle';
  return state === 'pumping' || state === 'soaking';
}

export function soilLabel(state: string | undefined): string {
  switch (state) {
    case 'dry':
      return 'Dry';
    case 'adequate':
      return 'Adequate';
    case 'wet':
      return 'Wet';
    case 'uncalibrated':
      return 'Not calibrated';
    default:
      return 'Unavailable';
  }
}

export function reservoirLabel(state: string | undefined): string {
  switch (state) {
    case 'available':
      return 'Available';
    case 'low':
      return 'Low';
    case 'uncalibrated':
      return 'Not calibrated';
    default:
      return 'Unknown';
  }
}

export function binLabel(state: string | undefined): string {
  switch (state) {
    case 'available':
      return 'Collecting';
    case 'nearly_full':
      return 'Nearly full';
    case 'full':
      return 'Full';
    case 'not_installed':
      return 'Not installed';
    default:
      return 'Unavailable';
  }
}

export function lightModeLabel(mode: string | undefined): string {
  if (mode === 'auto') return 'Auto';
  if (mode === 'manual') return 'Manual';
  return 'Unknown';
}

export function explainIrrigation(status: DeviceStatus): Explanation {
  const irrigation = status.irrigation;
  const state = titleCase(irrigation.state);
  let tone: Tone = 'neutral';
  if (irrigation.state === 'pumping' || irrigation.state === 'soaking') tone = 'good';
  if (irrigation.reason_code?.startsWith('IRRIGATION_BLOCKED')) tone = 'warn';
  if (status.sensors?.soil?.state === 'dry') tone = tone === 'neutral' ? 'warn' : tone;
  return {
    key: 'irrigation',
    label: 'Irrigation',
    headline: state,
    detail: irrigation.reason || 'No reason has been reported by the controller.',
    tone,
  };
}

export function explainPump(status: DeviceStatus): Explanation {
  const pump = status.actuators?.pump;
  const commanded = Boolean(pump?.commanded);
  const commissioned = Boolean(pump?.commissioned);
  return {
    key: 'pump',
    label: 'Pump',
    headline: commanded ? 'Commanded on' : 'Off',
    detail: commissioned
      ? 'Pump output is allowed by the firmware commissioning gate.'
      : 'The commissioning gate is closed, so the firmware refuses to switch the pump on.',
    tone: commissioned ? (commanded ? 'good' : 'neutral') : 'warn',
  };
}

export function explainLights(status: DeviceStatus): Explanation {
  const lights = status.actuators?.streetlights;
  const brightness = status.sensors?.light?.brightness ?? 'unknown';
  const mode = lights?.mode ?? 'unknown';
  const commands = lights?.commanded ? 'commanded on' : 'commanded off';
  let detail: string;
  if (mode === 'auto') {
    detail =
      brightness === 'dark'
        ? `Auto mode follows the light sensor, which reads dark. Output is ${commands}.`
        : brightness === 'bright'
          ? `Auto mode follows the light sensor, which reads bright. Output is ${commands}.`
          : `Auto mode is waiting for a valid light reading. Output is ${commands}.`;
  } else {
    detail = `Manual mode. The last command left the lights ${commands}.`;
  }
  return {
    key: 'lights',
    label: 'Streetlights',
    headline: `${lightModeLabel(mode)} · ${titleCase(brightness)}`,
    detail,
    tone: lights?.commanded ? 'gold' : 'neutral',
  };
}

export function explainReservoir(status: DeviceStatus): Explanation {
  const reservoir = status.sensors?.reservoir;
  const state = reservoir?.state ?? 'unavailable';
  const detail =
    state === 'available'
      ? 'The two probes are covered, so the minimum water level is present.'
      : state === 'low'
        ? 'The probes are dry, so the water is at or below the minimum level.'
        : 'No usable probe reading. The dashboard does not guess a level.';
  return {
    key: 'reservoir',
    label: 'Reservoir',
    headline: reservoirLabel(state),
    detail,
    tone: state === 'available' ? 'good' : state === 'low' ? 'warn' : 'neutral',
  };
}

export function explainWaste(status: DeviceStatus): Explanation {
  const indicator = status.actuators?.waste_indicator;
  if (indicator?.active && indicator.category) {
    return {
      key: 'waste',
      label: 'Waste indicator',
      headline: `Indicating ${indicator.category}`,
      detail: `${Math.max(0, Math.round(indicator.remaining_ms / 1000))}s of the indication remain. This only lights the bin LED.`,
      tone: 'gold',
    };
  }
  return {
    key: 'waste',
    label: 'Waste indicator',
    headline: 'Idle',
    detail: 'No bin LED is being lit right now.',
    tone: 'neutral',
  };
}

export function villageExplanations(status: DeviceStatus): Explanation[] {
  return [
    explainIrrigation(status),
    explainPump(status),
    explainLights(status),
    explainReservoir(status),
    explainWaste(status),
  ];
}

export function statusSentence(status: DeviceStatus | null): string {
  if (!status) return 'Waiting for the village controller to send its first frame.';
  return status.irrigation?.reason ?? 'The controller has not reported a reason yet.';
}
