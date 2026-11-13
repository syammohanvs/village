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
  /** When the current run of "something is being shown" began, if it is running. */
  objectSince: number | null;
}

/**
 * How long something may be "shown" before the room is learned again.
 *
 * Two things go wrong without this, and both were seen at the venue:
 *
 * 1. **The reference can capture the item.**  The room is learned from the
 *    first frames, and if somebody is already holding the item up at that
 *    moment the item becomes the room — after which the *empty* room looks like
 *    the thing being shown.
 * 2. **Freezing while an object is present can deadlock.**  Once the reference
 *    holds the item, removing it never returns to "empty", and the camera never
 *    re-arms: reported as "it did not re-arm even after I moved the item away".
 *
 * Re-learning after a few seconds of continuous presentation fixes both.  The
 * cost is that an item genuinely held still for longer than this becomes part
 * of the room; that is the right trade, because the alternative is a camera
 * that stops working until somebody reloads the page.
 */
export const STALE_OBJECT_MS = 4000;

/**
 * How much of the frame has to change before it counts as "something is being
 * shown".
 *
 * The first threshold used was 0.3%, which is **58 pixels** of a 160x120 frame:
 * a curtain moving, a screen flickering, the noise of a cheap sensor or a
 * person breathing all clear that, and the page then classified the room —
 * reported as "it is classifying without me showing anything".
 *
 * An item held up to the camera is a large part of the picture, not a few
 * pixels. Two percent of the frame is about 380 pixels: still small enough for
 * an item held at arm's length, large enough that scenery drift does not
 * qualify.
 */
export const PRESENTATION_SHARE = 0.02;

/** Whether a changed share is a presentation rather than the room moving. */
export function isPresentation(changedShareValue: number): boolean {
  return Number.isFinite(changedShareValue) && changedShareValue >= PRESENTATION_SHARE;
}

export type SceneKind = 'object' | 'empty';

/**
 * Note what the frame is, and say whether the room should be learned again.
 *
 * Called once per frame with the answer from `sceneState`.
 */
export function noteScene(memory: SceneMemory, kind: SceneKind, now: number): boolean {
  if (kind === 'empty') {
    memory.objectSince = null;
    return false;
  }
  if (memory.objectSince === null) {
    memory.objectSince = now;
    return false;
  }
  if (now - memory.objectSince >= STALE_OBJECT_MS) {
    memory.objectSince = null;
    return true;
  }
  return false;
}

export function createSceneMemory(width: number, height: number): SceneMemory {
  return {
    background: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    frames: 0,
    objectSince: null,
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
  memory.objectSince = null;
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
