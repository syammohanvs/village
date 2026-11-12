import { describe, expect, it } from 'vitest';
import { centreCrop, diffBox, diffBoxMulti, focusRegion, scaleBox, squareCrop } from './focus';

function frame(width: number, height: number, value = 20): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return data;
}

function fill(data: Uint8ClampedArray, width: number, x: number, y: number, w: number, h: number, value = 240) {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      const i = (yy * width + xx) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }
  }
}

describe('object focus', () => {
  it('reports nothing when the frame is unchanged', () => {
    const background = frame(100, 80);
    const current = frame(100, 80);
    expect(diffBox(background, current, 100, 80)).toBeNull();
  });

  it('finds the box that changed', () => {
    const background = frame(100, 80);
    const current = frame(100, 80);
    fill(current, 100, 20, 30, 10, 12);
    expect(diffBox(background, current, 100, 80)).toEqual({ x: 20, y: 30, width: 10, height: 12 });
  });

  it('ignores a change smaller than the minimum share of the frame', () => {
    const background = frame(100, 80);
    const current = frame(100, 80);
    fill(current, 100, 20, 30, 2, 2);
    expect(diffBox(background, current, 100, 80)).toBeNull();
  });

  it('ignores a change that covers almost the whole frame', () => {
    const background = frame(100, 80);
    const current = frame(100, 80, 235);
    expect(diffBox(background, current, 100, 80)).toBeNull();
  });

  it('does not treat small brightness drift as an object', () => {
    const background = frame(100, 80, 30);
    const current = frame(100, 80, 40);
    expect(diffBox(background, current, 100, 80, { threshold: 20 })).toBeNull();
  });

  it('grows a box into a square with a margin', () => {
    // 20x10 at (10, 10) -> a 28x28 square centred on the box.
    const box = squareCrop({ x: 10, y: 10, width: 20, height: 10 }, 100, 100, 0.2);
    expect(box).toEqual({ x: 6, y: 1, width: 28, height: 28 });
  });

  it('clamps a square crop to the frame edges', () => {
    const box = squareCrop({ x: 90, y: 90, width: 10, height: 10 }, 100, 100, 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(100);
    expect(box.y + box.height).toBeLessThanOrEqual(100);
    expect(box.width).toBe(box.height);
  });

  it('uses a centre square when there is no object box', () => {
    expect(centreCrop(200, 100, 0.5)).toEqual({ x: 75, y: 25, width: 50, height: 50 });
  });

  it('scales a box from the analysis frame to the video frame', () => {
    expect(scaleBox({ x: 10, y: 5, width: 20, height: 20 }, 160, 120, 640, 480)).toEqual({
      x: 40,
      y: 20,
      width: 80,
      height: 80,
    });
  });

  it('accepts any of several backgrounds, so a door or a light can change', () => {
    const openDoor = frame(100, 80, 20);
    const closedDoor = frame(100, 80, 80);
    const current = frame(100, 80, 80);
    fill(current, 100, 20, 30, 10, 12, 220);
    expect(diffBoxMulti([openDoor, closedDoor], current, 100, 80)).toEqual({
      x: 20,
      y: 30,
      width: 10,
      height: 12,
    });
  });

  it('treats a frame that matches the second background as background', () => {
    const openDoor = frame(100, 80, 20);
    const closedDoor = frame(100, 80, 80);
    const current = frame(100, 80, 80);
    expect(diffBoxMulti([openDoor, closedDoor], current, 100, 80)).toBeNull();
  });

  it('has no object when there is no background at all', () => {
    expect(diffBoxMulti([], frame(100, 80), 100, 80)).toBeNull();
  });

  it('pulls the focus box towards the middle when an arm enters from an edge', () => {
    const background = frame(100, 80);
    const current = frame(100, 80);
    // An arm from the right edge, and the item at the end of it.
    fill(current, 100, 70, 10, 30, 60, 240);
    fill(current, 100, 44, 32, 12, 12, 240);
    const region = focusRegion([background], current, 100, 80);
    expect(region).not.toBeNull();
    expect(region?.edgeTouch).toBe(true);
    const boundingCentre = (44 + 99) / 2;
    expect(region!.centre.x).toBeLessThan(boundingCentre);
    expect(region!.box.width).toBe(region!.box.height);
  });

  it('marks a central object as not touching an edge', () => {
    const background = frame(100, 80);
    const current = frame(100, 80);
    fill(current, 100, 40, 30, 20, 20, 240);
    const region = focusRegion([background], current, 100, 80);
    expect(region?.edgeTouch).toBe(false);
    expect(region!.box.x).toBeLessThanOrEqual(40);
    expect(region!.box.x + region!.box.width).toBeGreaterThanOrEqual(60);
  });
});
