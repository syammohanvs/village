import { describe, expect, it } from 'vitest';
import {
  PRESENTATION_SHARE,
  SCENE_WARMUP_FRAMES,
  isPresentation,
  STALE_OBJECT_MS,
  noteScene,
  changedShare,
  createSceneMemory,
  learnScene,
  resetScene,
  sceneReady,
} from './sceneMemory';

/** A frame of one colour, as RGBA. */
function solid(width: number, height: number, rgb: [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return data;
}

/** Replace the middle of a frame, as an item being held up would. */
function withItem(
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  rgb: [number, number, number],
) {
  const copy = new Uint8ClampedArray(frame);
  for (let y = Math.floor(height / 3); y < Math.floor((height * 2) / 3); y += 1) {
    for (let x = Math.floor(width / 3); x < Math.floor((width * 2) / 3); x += 1) {
      const i = (y * width + x) * 4;
      copy[i] = rgb[0];
      copy[i + 1] = rgb[1];
      copy[i + 2] = rgb[2];
      copy[i + 3] = 255;
    }
  }
  return copy;
}

describe('the room the camera learns', () => {
  it('takes the very first frame as the room outright', () => {
    const memory = createSceneMemory(8, 6);
    learnScene(memory, solid(8, 6, [10, 20, 30]));
    // One frame, exactly, with no blending from the empty buffer.
    expect(Array.from(memory.background.slice(0, 4))).toEqual([10, 20, 30, 255]);
    expect(memory.frames).toBe(1);
  });

  it('drifts towards a new frame instead of snapping to it', () => {
    const memory = createSceneMemory(8, 6);
    learnScene(memory, solid(8, 6, [0, 0, 0]));
    learnScene(memory, solid(8, 6, [100, 100, 100]), { alpha: 0.1 });
    // 10% of the way: a door opening becomes the room slowly, and an item shown
    // for a moment does not.
    expect(memory.background[0]).toBeCloseTo(10, 0);
    expect(memory.frames).toBe(2);
  });

  it('freezes while something is being shown', () => {
    // An item held up for a minute must not be folded into the room and then
    // forgotten -- that is the failure the whole file exists to avoid.
    const memory = createSceneMemory(8, 6);
    learnScene(memory, solid(8, 6, [0, 0, 0]));
    const before = Array.from(memory.background.slice(0, 4));
    for (let i = 0; i < 50; i += 1) {
      learnScene(memory, solid(8, 6, [200, 200, 200]), { frozen: true });
    }
    expect(Array.from(memory.background.slice(0, 4))).toEqual(before);
    expect(memory.frames).toBe(1);
  });

  it('is not ready until it has watched the room for a while', () => {
    const memory = createSceneMemory(8, 6);
    expect(sceneReady(memory)).toBe(false);
    for (let i = 0; i < SCENE_WARMUP_FRAMES; i += 1) {
      learnScene(memory, solid(8, 6, [50, 50, 50]));
    }
    expect(sceneReady(memory)).toBe(true);
  });

  it('starts again when the camera is moved', () => {
    const memory = createSceneMemory(8, 6);
    learnScene(memory, solid(8, 6, [10, 10, 10]));
    learnScene(memory, solid(8, 6, [10, 10, 10]));
    resetScene(memory);
    expect(memory.frames).toBe(0);
    learnScene(memory, solid(8, 6, [90, 90, 90]), { alpha: 0.1 });
    // The first frame after a reset replaces the room outright, so a camera that
    // was knocked over does not need to drift back into focus.
    expect(memory.background[0]).toBe(90);
  });

  it('measures how much of the frame changed', () => {
    const memory = createSceneMemory(9, 9);
    const room = solid(9, 9, [40, 40, 40]);
    learnScene(memory, room);
    expect(changedShare(memory, room)).toBe(0);
    const different = withItem(room, 9, 9, [200, 40, 40]);
    const share = changedShare(memory, different);
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(1);
    expect(changedShare(memory, solid(9, 9, [250, 250, 250]))).toBe(1);
  });

  it('ignores a frame that is not a picture', () => {
    const memory = createSceneMemory(8, 6);
    learnScene(memory, new Uint8ClampedArray(4));
    expect(memory.frames).toBe(0);
    expect(changedShare(memory, new Uint8ClampedArray(4))).toBe(0);
  });
});

describe('when the room must be learned again', () => {
  it('re-learns after something has been "shown" for too long', () => {
    // Both reported failures come from a reference that holds the item: the
    // empty room then looks like the object, and the camera never re-arms.
    const memory = createSceneMemory(4, 4);
    expect(noteScene(memory, 'object', 0)).toBe(false);
    expect(noteScene(memory, 'object', STALE_OBJECT_MS - 1)).toBe(false);
    expect(noteScene(memory, 'object', STALE_OBJECT_MS)).toBe(true);
  });

  it('does not re-learn while the room is being seen', () => {
    const memory = createSceneMemory(4, 4);
    expect(noteScene(memory, 'empty', 0)).toBe(false);
    expect(noteScene(memory, 'empty', 60000)).toBe(false);
  });

  it('starts the clock again after the room is seen', () => {
    const memory = createSceneMemory(4, 4);
    noteScene(memory, 'object', 0);
    noteScene(memory, 'empty', 3000);          // item taken away
    expect(noteScene(memory, 'object', 4000)).toBe(false);  // a new item
    expect(noteScene(memory, 'object', 4000 + STALE_OBJECT_MS)).toBe(true);
  });

  it('forgets the clock when the room is reset', () => {
    const memory = createSceneMemory(4, 4);
    noteScene(memory, 'object', 0);
    resetScene(memory);
    expect(memory.objectSince).toBeNull();
    expect(noteScene(memory, 'object', 10)).toBe(false);
  });
});

describe('what counts as "something is being shown"', () => {
  it('needs a real part of the frame, not a few noisy pixels', () => {
    // 0.3% of a 160x120 frame is 58 pixels: a curtain, a screen or sensor noise
    // clears that, and the page then classified the room.
    expect(isPresentation(0.003)).toBe(false);
    expect(isPresentation(0.01)).toBe(false);
    expect(isPresentation(PRESENTATION_SHARE)).toBe(true);
    expect(isPresentation(0.3)).toBe(true);
    expect(isPresentation(Number.NaN)).toBe(false);
  });
});
