import type { ActivityEvent } from '../types';

export type EventKind = 'command' | 'recognition' | 'alert' | 'connection' | 'other';

export interface FriendlyEvent {
  kind: EventKind;
  title: string;
  reason: string | null;
}

const REASONS: Record<string, string> = {
  IRRIGATION_BLOCKED_WATER_LOW: 'Watering was blocked because the tank water was low.',
  IRRIGATION_BLOCKED_SOIL_WET: 'Watering was blocked because the soil was already moist.',
  IRRIGATION_BLOCKED_SOIL_UNCALIBRATED: 'Watering was blocked because the soil probe is not calibrated.',
  IRRIGATION_BLOCKED_PUMP_NOT_COMMISSIONED: 'Watering was blocked because the pump is not commissioned.',
  IRRIGATION_BLOCKED_COOLDOWN: 'Watering was blocked because the cooldown after the last session is still running.',
  IRRIGATION_BLOCKED_SENSOR_INVALID: 'Watering was blocked because a sensor reading was not valid.',
  IRRIGATION_BLOCKED_ALREADY_ACTIVE: 'Watering was blocked because a session was already running.',
  IRRIGATION_BLOCKED_LOCKOUT: 'Watering was blocked by the safety lockout after a fault.',
  DUPLICATE_COMMAND: 'The same request had already been processed, so it was not repeated.',
  IRRIGATION_STARTED: 'The controller started a watering session.',
  IRRIGATION_COMPLETE: 'The watering session finished.',
  IRRIGATION_STOPPED: 'The watering session was stopped.',
};

const TITLES: Record<string, string> = {
  LIGHTS_ON: 'Streetlights switched on',
  LIGHTS_OFF: 'Streetlights switched off',
  LIGHTS_AUTO: 'Streetlights returned to automatic',
  IRRIGATION_REQUEST: 'Watering requested',
  IRRIGATION_STOP: 'Watering stopped',
  INDICATE_WASTE: 'Bin indicator lit',
  CONFIG_SAVED: 'Settings changed',
};

export function kindOf(event: ActivityEvent): EventKind {
  const raw = `${event.kind ?? ''} ${event.type ?? ''} ${event.code ?? ''}`.toLowerCase();
  if (raw.includes('recogn') || raw.includes('waste')) return 'recognition';
  if (raw.includes('connect') || raw.includes('reconnect') || raw.includes('boot') || raw.includes('offline') || raw.includes('stale')) {
    return 'connection';
  }
  if (raw.includes('alert') || raw.includes('fault') || raw.includes('blocked')) return 'alert';
  if (raw.includes('command') || raw.includes('lights_') || raw.includes('irrigation_') || raw.includes('indicate_')) {
    return 'command';
  }
  return 'other';
}

function rawText(event: ActivityEvent): string {
  return event.detail ?? event.text ?? event.message ?? '';
}

// Turns one stored event into a sentence a visitor can read. It never invents
// a reason: when the record carries no code and no detail, `reason` is null.
export function friendlyEvent(event: ActivityEvent): FriendlyEvent {
  const kind = kindOf(event);
  const code = (event.code ?? '').toUpperCase();
  const type = (event.type ?? event.command ?? '').toUpperCase();
  const text = rawText(event);
  const reason =
    code && REASONS[code]
      ? REASONS[code]
      : text && text.toUpperCase() !== type
        ? text
        : null;

  if (type && TITLES[type]) {
    return { kind, title: TITLES[type], reason };
  }
  if (code && TITLES[code]) {
    return { kind, title: TITLES[code], reason };
  }
  if (kind === 'recognition') {
    return { kind, title: 'Waste shown to the camera', reason };
  }
  if (kind === 'connection') {
    return { kind, title: text || 'Connection changed', reason: null };
  }
  if (kind === 'alert') {
    return { kind, title: text || 'An alert was recorded', reason };
  }
  return { kind, title: text || 'Event', reason };
}
