/**
 * A background the camera learns by itself.
 *
 * The venue has no empty table and no fixed scene: an item is held up in a room
 * that keeps changing.  Pressing "Set background" asks for something nobody can
 * give, and without one the page classified the room itself — it named the
 * wall "textile" and ignored a key fob in a hand.
 *
 * So the room is learned instead of being asked for.  A slowly-updated average
 * of the frame is what "the room" looks like; anything that differs from it is
 * what somebody is showing.  That is the same comparison the empty-scene code
 * already does, with a background that maintains itself:
 *
 * - it adapts slowly, so a door opening or the lights changing becomes part of
 *   the room instead of an item;
 * - it **freezes** while something is being presented, so an item held up for a
 *   minute is not slowly absorbed into the background and then forgotten.
 *
 * Kept DOM-free and pure so it can be tested on plain arrays.
 */

/** How much of a new frame is folded into the remembered room, per frame. */
export const SCENE_ALPHA = 0.04;
/** Frames of room to watch before anything is classified (~2.4 s at 300 ms). */
export const SCENE_WARMUP_FRAMES = 8;

export interface SceneMemory {
  background: Uint8ClampedArray;
  width: number;
  height: number;
  /** How many frames have been folded in. */
  frames: number;
}

export function createSceneMemory(width: number, height: number): SceneMemory {
  return {
    background: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    frames: 0,
  };
}

/**
 * Fold one frame into the remembered room.
 *
 * `alpha` is how much of the new frame counts: 1 replaces the room with this
 * frame outright (the first look, and the recovery after the camera is moved),
 * smaller values drift.  Called with `frozen` while an item is being shown.
 */
export function learnScene(
  memory: SceneMemory,
  frame: Uint8ClampedArray,
  options: { alpha?: number; frozen?: boolean } = {},
): SceneMemory {
  const { alpha = SCENE_ALPHA, frozen = false } = options;
  if (frozen) return memory;
  if (memory.width <= 0 || memory.height <= 0) return memory;
  const expected = memory.width * memory.height * 4;
  if (frame.length < expected) return memory;

  const first = memory.frames === 0;
  const weight = first ? 1 : alpha;
  const keep = 1 - weight;
  const background = memory.background;
  for (let i = 0; i < expected; i += 1) {
    background[i] = background[i] * keep + frame[i] * weight;
  }
  memory.frames += 1;
  return memory;
}

/** Whether enough of the room has been seen for a diff against it to mean anything. */
export function sceneReady(memory: SceneMemory, warmup = SCENE_WARMUP_FRAMES): boolean {
  return memory.frames >= warmup;
}

/** Forget the room: the next frame becomes the new reference outright. */
export function resetScene(memory: SceneMemory): SceneMemory {
  memory.frames = 0;
  return memory;
}

/**
 * How much of the frame differs from the room, as a share.
 *
 * A cheap companion to `sceneState` for the question "has the camera been
 * moved?", which is not the same as "is an item being shown": a moved camera
 * differs almost everywhere, an item differs in one region.
 */
export function changedShare(
  memory: SceneMemory,
  frame: Uint8ClampedArray,
  threshold = 38,
): number {
  const expected = memory.width * memory.height * 4;
  if (memory.frames === 0 || frame.length < expected) return 0;
  const background = memory.background;
  let changed = 0;
  const pixels = memory.width * memory.height;
  for (let i = 0; i < expected; i += 4) {
    const dr = Math.abs(frame[i] - background[i]);
    const dg = Math.abs(frame[i + 1] - background[i + 1]);
    const db = Math.abs(frame[i + 2] - background[i + 2]);
    if (dr > threshold || dg > threshold || db > threshold) changed += 1;
  }
  return changed / Math.max(1, pixels);
}
