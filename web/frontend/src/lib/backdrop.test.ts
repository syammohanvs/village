import { describe, expect, it } from 'vitest';
import { backdropBox, backdropColour } from './backdrop';

/** A frame filled with one colour, and an optional rectangle painted over it. */
function frame(
  width: number,
  height: number,
  background: [number, number, number],
  object?: { x: number; y: number; w: number; h: number; colour: [number, number, number] },
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = background[0];
    data[i + 1] = background[1];
    data[i + 2] = background[2];
    data[i + 3] = 255;
  }
  if (object) {
    for (let y = object.y; y < object.y + object.h; y += 1) {
      for (let x = object.x; x < object.x + object.w; x += 1) {
        const i = (y * width + x) * 4;
        data[i] = object.colour[0];
        data[i + 1] = object.colour[1];
        data[i + 2] = object.colour[2];
      }
    }
  }
  return data;
}

const RED: [number, number, number] = [190, 60, 55];
const GREEN: [number, number, number] = [70, 150, 90];
const WHITE: [number, number, number] = [245, 245, 240];

describe('the backdrop colour', () => {
  it('reads the sheet, not the object, whatever colour the sheet is', () => {
    for (const sheet of [RED, GREEN, WHITE]) {
      const data = frame(160, 120, sheet, { x: 60, y: 40, w: 40, h: 40, colour: [20, 20, 25] });
      expect(backdropColour(data, 160, 120)).toEqual(sheet);
    }
  });
});

describe('finding the object on the sheet', () => {
  it('boxes the item, wherever it sits in the frame', () => {
    // An item held at the left edge is exactly the case the centre square misses.
    const data = frame(160, 120, RED, { x: 8, y: 34, w: 44, h: 44, colour: [225, 225, 220] });
    const found = backdropBox(data, 160, 120);
    expect(found.box).not.toBeNull();
    const box = found.box!;
    // The box is square, grows a little past the item and stays inside the frame.
    expect(box.width).toBe(box.height);
    expect(box.x).toBeLessThanOrEqual(8);
    expect(box.x + box.width).toBeGreaterThanOrEqual(52);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(160);
    expect(box.y + box.height).toBeLessThanOrEqual(120);
  });

  it('covers the whole item, with room to spare', () => {
    const data = frame(160, 120, WHITE, { x: 55, y: 35, w: 50, h: 50, colour: [30, 90, 160] });
    const box = backdropBox(data, 160, 120).box!;
    expect(box.x).toBeLessThanOrEqual(55);
    expect(box.y).toBeLessThanOrEqual(35);
    expect(box.x + box.width).toBeGreaterThanOrEqual(105);
    expect(box.y + box.height).toBeGreaterThanOrEqual(85);
  });

  it('says nothing when the sheet is empty', () => {
    // The exhibit's resting state: no item, so no crop and no classification.
    for (const sheet of [RED, GREEN, WHITE]) {
      expect(backdropBox(frame(160, 120, sheet), 160, 120).box).toBeNull();
    }
  });

  it('refuses a scene with no plain backdrop, so the caller keeps the centre', () => {
    // A wooden table fills the frame with grain: nearly every pixel differs from
    // the median edge colour, and a crop of "the whole table" is worse than the
    // centre square the page used before.
    const data = new Uint8ClampedArray(160 * 120 * 4);
    for (let y = 0; y < 120; y += 1) {
      for (let x = 0; x < 160; x += 1) {
        const i = (y * 160 + x) * 4;
        const wood = 120 + ((x * 7 + y * 13) % 90);
        data[i] = wood;
        data[i + 1] = wood - 40;
        data[i + 2] = wood - 80;
        data[i + 3] = 255;
      }
    }
    expect(backdropBox(data, 160, 120).box).toBeNull();
  });

  it('ignores a speck, and still crops an item held close', () => {
    // One stray pixel is noise, not an item.
    expect(backdropBox(frame(160, 120, RED, { x: 10, y: 10, w: 2, h: 2, colour: [0, 0, 0] }), 160, 120).box)
      .toBeNull();
    // An item filling most of the frame is an item held close -- it must still
    // be cropped, because refusing here would turn "too near" into "nothing".
    const close = backdropBox(frame(160, 120, RED, { x: 8, y: 6, w: 144, h: 108, colour: [0, 0, 0] }), 160, 120);
    expect(close.box).not.toBeNull();
    expect(close.box!.width).toBeGreaterThanOrEqual(120);
  });
});

describe('the crop margin on a fixed base', () => {
  it('leaves a margin around the item, now that the base is fixed', () => {
    // Raised from 12 % to 20 % on 2026-11-19: the item is placed on a sheet, so
    // the area around it is plain base — and a tight square was clipping the
    // corners of flat items (a business card is all corner).  30 % was measured
    // to cost more accuracy than it was worth.
    const data = frame(160, 120, RED, { x: 55, y: 35, w: 50, h: 50, colour: [225, 225, 220] });
    const box = backdropBox(data, 160, 120).box!;
    expect(box.width).toBeGreaterThanOrEqual(Math.round(50 * 1.25));
    expect(box.x).toBeLessThanOrEqual(55 - 6);
    expect(box.y).toBeLessThanOrEqual(35 - 6);
    expect(box.x + box.width).toBeGreaterThanOrEqual(105 + 6);
    expect(box.y + box.height).toBeGreaterThanOrEqual(85 + 6);
  });
});
