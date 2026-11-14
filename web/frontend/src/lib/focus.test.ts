import { describe, expect, it } from 'vitest';
import {
  centreCrop,
  cropGuide,
  diffBox,
  diffBoxMulti,
  focusRegion,
  objectMask,
  regionInGuide,
  scaleBox,
  sceneState,
  squareCrop,
} from './focus';

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

describe('what the frame is', () => {
  it('says the table is empty when nothing changed', () => {
    const background = frame(100, 80);
    expect(sceneState([background], frame(100, 80), 100, 80)).toEqual({ kind: 'empty' });
  });

  it('says there is an object when a box changed', () => {
    const background = frame(100, 80);
    const current = frame(100, 80);
    fill(current, 100, 40, 30, 20, 20, 240);
    const state = sceneState([background], current, 100, 80);
    expect(state.kind).toBe('object');
    if (state.kind !== 'object') throw new Error('expected an object');
    expect(state.region.box.width).toBe(state.region.box.height);
    expect(state.region.box.x).toBeLessThanOrEqual(40);
  });

  it('says the background no longer matches when the whole view changed', () => {
    // A nudged camera or a switched-on lamp: every pixel differs.  This used to
    // be reported as "no region", which the page showed as "Not a waste item"
    // — so a real item in front of the camera was never classified at all.
    const background = frame(100, 80, 20);
    const current = frame(100, 80, 200);
    expect(sceneState([background], current, 100, 80)).toEqual({ kind: 'unmatched' });
    // The old answer for this frame is indistinguishable from an empty table:
    expect(focusRegion([background], current, 100, 80)).toBeNull();
  });

  it('says the background no longer matches when there is no usable reference', () => {
    expect(sceneState([], frame(100, 80), 100, 80)).toEqual({ kind: 'unmatched' });
    // A snapshot of another size cannot explain this frame either.
    expect(sceneState([frame(50, 40)], frame(100, 80), 100, 80)).toEqual({ kind: 'unmatched' });
  });

  it('agrees with focusRegion about which regions exist', () => {
    const background = frame(100, 80);
    const current = frame(100, 80);
    fill(current, 100, 20, 30, 10, 12, 240);
    const state = sceneState([background], current, 100, 80);
    expect(state.kind === 'object' ? state.region : null).toEqual(
      focusRegion([background], current, 100, 80),
    );
  });
});

describe('painting out the stored background', () => {
  const BOX = { x: 20, y: 20, width: 40, height: 40 };

  it('keeps the item and clears the table around it', () => {
    const background = frame(100, 80);
    const current = frame(100, 80);
    // An object filling a quarter of the crop box; the rest of the box is still
    // the empty table, so it must not reach the classifier.  It is deliberately
    // more than the 15% floor: a mask that keeps less than that is refused now,
    // because the white plate it leaves is read as "Paper".
    fill(current, 100, 35, 35, 20, 20, 240);
    const mask = objectMask([background], current, 100, 80, BOX);
    expect(mask).not.toBeNull();
    expect(mask!.width).toBe(BOX.width);
    expect(mask!.height).toBe(BOX.height);
    // 400 of the 1600 box pixels are the object.
    expect(mask!.kept).toBeCloseTo(400 / 1600, 3);
    // The object is opaque...
    const object = ((35 - BOX.y) * BOX.width + (35 - BOX.x)) * 4;
    expect(mask!.data[object + 3]).toBe(255);
    // ...and the table beside it is clear, which is what becomes white.
    const table = ((30 - BOX.y) * BOX.width + (30 - BOX.x)) * 4;
    expect(mask!.data[table + 3]).toBe(0);
  });

  it('does not keep anything the stored background explains', () => {
    const background = frame(100, 80);
    const current = frame(100, 80);
    // A shadow that is darker than the table but still present in the snapshot.
    fill(current, 100, 30, 30, 20, 20, 20);
    expect(objectMask([background], current, 100, 80, BOX)).toBeNull();
  });

  it('accepts a pixel that matches any one of the stored backgrounds', () => {
    const first = frame(100, 80, 20);
    const second = frame(100, 80, 90);
    const current = frame(100, 80, 90);
    // The whole frame matches the second snapshot, so nothing is an object even
    // though it differs from the first.
    expect(objectMask([first, second], current, 100, 80, BOX)).toBeNull();
    // The object has to differ from both snapshots, not merely from one.
    fill(current, 100, 40, 40, 20, 20, 250);
    const mask = objectMask([first, second], current, 100, 80, BOX);
    expect(mask).not.toBeNull();
    expect(mask!.kept).toBeCloseTo(400 / 1600, 3);
  });

  it('refuses a mask that would leave an almost empty plate', () => {
    // Almost the whole box is still the stored table, so the mask would hand the
    // classifier a blank plate.  That is a mis-measurement (a stale snapshot of
    // the wrong place), and the plain crop is the honest fallback.
    const background = frame(100, 80);
    const current = frame(100, 80);
    fill(current, 100, BOX.x, BOX.y, 3, 3, 250);
    expect(objectMask([background], current, 100, 80, BOX)).toBeNull();
  });

  it('refuses a plate that is mostly white even when a sliver survives', () => {
    // The measured failure: a crop that is 85% white plate is classified as
    // Paper 0.69 on the deployed model, so a mask keeping only a sliver is worse
    // than no mask at all. Fifteen of the venue's own captures were called
    // "paper" with a median of 85% white.
    const background = frame(100, 80);
    const current = frame(100, 80);
    fill(current, 100, BOX.x, BOX.y, Math.floor(BOX.width * 0.1), BOX.height, 250);
    expect(objectMask([background], current, 100, 80, BOX)).toBeNull();

    // A quarter surviving is a picture rather than a plate.
    fill(current, 100, BOX.x, BOX.y, Math.ceil(BOX.width * 0.25), BOX.height, 250);
    const mask = objectMask([background], current, 100, 80, BOX);
    expect(mask).not.toBeNull();
    expect(mask!.kept).toBeGreaterThan(0.15);
  });

  it('keeps everything when a moved camera makes the whole box differ', () => {
    // A nudged camera means the stored snapshot no longer explains anything.  The
    // mask then covers the box, which is the plain crop by another route — never
    // an empty plate.
    const background = frame(100, 80);
    const current = frame(100, 80, 200);
    const mask = objectMask([background], current, 100, 80, BOX);
    expect(mask).not.toBeNull();
    expect(mask!.kept).toBeCloseTo(1, 5);
  });

  it('has nothing to paint out without a stored background', () => {
    const current = frame(100, 80);
    fill(current, 100, 35, 35, 10, 10, 240);
    expect(objectMask([], current, 100, 80, BOX)).toBeNull();
    // A snapshot of the wrong size cannot be compared with this frame.
    expect(objectMask([frame(50, 40)], current, 100, 80, BOX)).toBeNull();
  });

  it('clamps a box that runs off the frame instead of reading past it', () => {
    const background = frame(100, 80);
    const current = frame(100, 80);
    fill(current, 100, 90, 70, 8, 8, 240);
    const mask = objectMask([background], current, 100, 80, { x: 90, y: 70, width: 40, height: 40 });
    expect(mask).not.toBeNull();
    expect(mask!.width).toBe(10);
    expect(mask!.height).toBe(10);
    expect(mask!.data.length).toBe(10 * 10 * 4);
  });
});

describe('cropGuide', () => {
  it('is a square that is the share of the shorter side, landscape', () => {
    // 16:9 camera drawn at 16:9, so the percentages are of the frame itself.
    const guide = cropGuide(16 / 9, 0.7)!;
    expect(guide.height).toBe('70.00%');
    // Two decimals of a percentage: 39.375 rounds to 39.38.
    expect(guide.width).toBe('39.38%');
    expect(guide.top).toBe('15.00%');
  });

  it('turns with a portrait camera', () => {
    const guide = cropGuide(3 / 4, 0.7)!;
    expect(guide.width).toBe('70.00%');
    expect(guide.height).toBe('52.50%');
    expect(guide.left).toBe('15.00%');
  });

  it('agrees with centreCrop on the same frame', () => {
    // The whole point of the guide: what is on screen is what is read.  Both
    // are `share` of the short side, so the square's side must be the same.
    const width = 640;
    const height = 360;
    const box = centreCrop(width, height, 0.7);
    const guide = cropGuide(width / height, 0.7)!;
    // The guide is rounded to 0.01% and the crop to whole pixels, so they can
    // differ by a fraction of a pixel -- never by a pixel.
    expect(Math.abs((parseFloat(guide.height) / 100) * height - box.height)).toBeLessThan(0.5);
    expect(Math.abs((parseFloat(guide.width) / 100) * width - box.width)).toBeLessThan(0.5);
    expect(box.width).toBe(box.height);
  });

  it('says nothing before it knows the camera shape', () => {
    expect(cropGuide(0)).toBeNull();
    expect(cropGuide(Number.NaN)).toBeNull();
  });
});

describe('regionInGuide', () => {
  // 160x120 frame, 0.7 share -> the square is 84 px, from (38, 18) to (122, 102).
  const W = 160;
  const H = 120;

  it('accepts the thing held up in the middle', () => {
    const held = { x: 70, y: 50, width: 12, height: 12 };
    expect(regionInGuide(held, W, H, 0.7)).toMatchObject({ ok: true });
    expect(regionInGuide(held, W, H, 0.7).inside).toBeCloseTo(1, 6);
  });

  it('refuses a change that is mostly at the edge', () => {
    // A face at the right-hand edge: reported as "a bottle at the edge read as
    // paper, then glass", because the crop took the middle instead.
    const face = { x: 130, y: 20, width: 30, height: 80 };
    expect(regionInGuide(face, W, H, 0.7).ok).toBe(false);
  });

  it('accepts an item that fills the square, even if it runs past it', () => {
    // Held close: the box is bigger than the guide but its middle is inside.
    const close = { x: 30, y: 10, width: 100, height: 100 };
    const { ok, inside } = regionInGuide(close, W, H, 0.7);
    expect(ok).toBe(true);
    expect(inside).toBeGreaterThan(0.5);
  });

  it('says no to a box that is not a box', () => {
    expect(regionInGuide({ x: 0, y: 0, width: 0, height: 0 }, W, H, 0.7).ok).toBe(false);
  });
});
