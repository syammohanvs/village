/**
 * Persist the empty-scene backgrounds on this device.
 *
 * The backgrounds are captured once and must survive a page reload and a
 * camera stop.  They are stored as base64 RGBA frames under one key; up to
 * three are kept so a hall whose door or lights change has more than one
 * "empty" picture.
 */

export const MAX_BACKGROUNDS = 3;
export const BACKGROUND_STORAGE_KEY = 'vbt_waste_backgrounds';

export interface BackgroundFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function bytesToBase64(data: Uint8ClampedArray): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8ClampedArray | null {
  try {
    const binary = atob(value);
    const data = new Uint8ClampedArray(binary.length);
    for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
    return data;
  } catch {
    return null;
  }
}

function validSize(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) < 4096;
}

/** Read the stored backgrounds, or `null` when there is no usable set. */
export function loadBackgrounds(
  storage: StorageLike | null,
  key = BACKGROUND_STORAGE_KEY,
): BackgroundFrame[] | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown; frames?: unknown };
    if (!validSize(parsed.width) || !validSize(parsed.height) || !Array.isArray(parsed.frames)) return null;
    const width = parsed.width;
    const height = parsed.height;
    const frames: BackgroundFrame[] = [];
    for (const encoded of parsed.frames.slice(0, MAX_BACKGROUNDS)) {
      if (typeof encoded !== 'string') continue;
      const data = base64ToBytes(encoded);
      if (!data || data.length !== width * height * 4) continue;
      frames.push({ width, height, data });
    }
    return frames.length > 0 ? frames : null;
  } catch {
    return null;
  }
}

/** Store the backgrounds. Returns false when the browser quota refuses it. */
export function saveBackgrounds(
  storage: StorageLike | null,
  frames: BackgroundFrame[],
  key = BACKGROUND_STORAGE_KEY,
): boolean {
  if (!storage) return false;
  const usable = frames.filter((frame) => validSize(frame.width) && validSize(frame.height) && frame.data.length === frame.width * frame.height * 4);
  if (usable.length === 0) {
    clearBackgrounds(storage, key);
    return true;
  }
  const first = usable[0];
  if (usable.some((frame) => frame.width !== first.width || frame.height !== first.height)) return false;
  try {
    storage.setItem(
      key,
      JSON.stringify({
        width: first.width,
        height: first.height,
        frames: usable.slice(-MAX_BACKGROUNDS).map((frame) => bytesToBase64(frame.data)),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Forget the stored backgrounds; the next camera session starts without one. */
export function clearBackgrounds(storage: StorageLike | null, key = BACKGROUND_STORAGE_KEY): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* a private-mode storage may refuse; there is nothing to do */
  }
}
