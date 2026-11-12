import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_STORAGE_KEY,
  MAX_BACKGROUNDS,
  clearBackgrounds,
  loadBackgrounds,
  saveBackgrounds,
  type BackgroundFrame,
} from './backgroundStore';

function frame(width = 4, height = 3, value = 20): BackgroundFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe('background store', () => {
  it('round-trips a background through storage', () => {
    const storage = fakeStorage();
    const first = frame(4, 3, 30);
    expect(saveBackgrounds(storage, [first])).toBe(true);
    const loaded = loadBackgrounds(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded?.[0].width).toBe(4);
    expect(loaded?.[0].height).toBe(3);
    expect(Array.from(loaded?.[0].data ?? [])).toEqual(Array.from(first.data));
  });

  it('keeps up to three backgrounds', () => {
    const storage = fakeStorage();
    const frames = [frame(4, 3, 10), frame(4, 3, 20), frame(4, 3, 30), frame(4, 3, 40)];
    expect(saveBackgrounds(storage, frames)).toBe(true);
    const loaded = loadBackgrounds(storage);
    expect(loaded).toHaveLength(MAX_BACKGROUNDS);
    expect(loaded?.[0].data[0]).toBe(20);
    expect(loaded?.[2].data[0]).toBe(40);
  });

  it('clears the stored set', () => {
    const storage = fakeStorage();
    saveBackgrounds(storage, [frame()]);
    clearBackgrounds(storage);
    expect(loadBackgrounds(storage)).toBeNull();
    expect(storage.map.has(BACKGROUND_STORAGE_KEY)).toBe(false);
  });

  it('ignores malformed or truncated storage', () => {
    const storage = fakeStorage();
    storage.setItem(BACKGROUND_STORAGE_KEY, 'not json');
    expect(loadBackgrounds(storage)).toBeNull();
    storage.setItem(BACKGROUND_STORAGE_KEY, JSON.stringify({ width: 4, height: 3, frames: ['AAAA'] }));
    expect(loadBackgrounds(storage)).toBeNull();
    storage.setItem(BACKGROUND_STORAGE_KEY, JSON.stringify({ width: 0, height: 3, frames: [] }));
    expect(loadBackgrounds(storage)).toBeNull();
  });

  it('refuses a mixed-size set and reports a quota failure', () => {
    const storage = fakeStorage();
    expect(saveBackgrounds(storage, [frame(4, 3), frame(5, 3)])).toBe(false);
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    expect(saveBackgrounds(refusing, [frame()])).toBe(false);
  });
});
