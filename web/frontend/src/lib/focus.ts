/**
 * Object-focus geometry for the Sort Waste camera.
 *
 * The classifier sees a whole 224×224 crop, so a room at home or a busy table
 * can dominate the answer.  These helpers compare a frame with an "empty
 * scene" snapshot, find the box that actually changed, and turn that box into
 * a square crop around the object.  Everything here is DOM-free so it can be
 * tested with plain typed arrays.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FocusOptions {
  /** Per-channel difference (0-255) that counts as a changed pixel. */
  threshold?: number;
  /** Ignore a change smaller than this share of the frame. */
  minFraction?: number;
  /** Ignore a change that covers almost the whole frame (camera moved). */
  maxFraction?: number;
  /** Extra margin around the changed box, as a share of its long side. */
  padding?: number;
}

const DEFAULTS = {
  threshold: 38,
  // A key fob is small in a 160x120 analysis frame; 0.3% still catches one
  // while ignoring a few noisy pixels.
  minFraction: 0.003,
  // A large object can fill the frame.  Only a nearly-total change (a moved
  // camera or a light switch) is treated as "no object".
  maxFraction: 0.98,
  padding: 0.22,
};

/**
 * Bounding box of the pixels that differ from EVERY stored background.
 *
 * More than one background is allowed because a hall changes: a door is open
 * in one snapshot and closed in another, or the lights are on in one and off
 * in another. A pixel that matches any of them is background.
 */
export function diffBoxMulti(
  backgrounds: Uint8ClampedArray[],
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  options: FocusOptions = {},
): Box | null {
  const { threshold, minFraction, maxFraction } = { ...DEFAULTS, ...options };
  if (width <= 0 || height <= 0 || backgrounds.length === 0) return null;
  const expected = width * height * 4;
  if (frame.length < expected) return null;
  if (backgrounds.some((background) => background.length < expected)) return null;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let changed = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      let nearest = Number.POSITIVE_INFINITY;
      for (const background of backgrounds) {
        const dr = Math.abs(frame[i] - background[i]);
        const dg = Math.abs(frame[i + 1] - background[i + 1]);
        const db = Math.abs(frame[i + 2] - background[i + 2]);
        const distance = Math.max(dr, dg, db);
        if (distance < nearest) nearest = distance;
        if (nearest < threshold) break;
      }
      if (nearest < threshold) continue;
      changed += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const total = width * height;
  if (changed === 0 || changed / total < minFraction) return null;
  const box = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  if ((box.width * box.height) / total > maxFraction) return null;
  return box;
}

export interface FocusRegion {
  box: Box;
  coverage: number;
  edgeTouch: boolean;
  centre: { x: number; y: number };
}

/**
 * What the frame is, compared with the stored empty scenes.
 *
 * `empty` and `unmatched` both used to be "no region", which made them
 * indistinguishable to the page — and the page told the visitor “Not a waste
 * item” for both.  That is right for an empty table and wrong for a background
 * that no longer describes the table (the camera was nudged, the light
 * changed, or somebody pressed Set background with an item already on it).  In
 * that case the page must say so and keep classifying, because otherwise a real
 * item is never seen and the screen sits on “Nothing to sort” for good.
 */
export type SceneState =
  | { kind: 'empty' }
  | { kind: 'unmatched' }
  | { kind: 'object'; region: FocusRegion };

interface Scan {
  changed: number;
  total: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  weightedX: number;
  weightedY: number;
  weightSum: number;
  edgeTouch: boolean;
}

/** One pass over the frame: which pixels differ from every stored scene. */
function scan(
  backgrounds: Uint8ClampedArray[],
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): Scan | null {
  if (width <= 0 || height <= 0 || backgrounds.length === 0) return null;
  const expected = width * height * 4;
  if (frame.length < expected) return null;
  if (backgrounds.some((background) => background.length < expected)) return null;

  const result: Scan = {
    changed: 0,
    total: width * height,
    minX: width,
    minY: height,
    maxX: -1,
    maxY: -1,
    weightedX: 0,
    weightedY: 0,
    weightSum: 0,
    edgeTouch: false,
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      let nearest = Number.POSITIVE_INFINITY;
      for (const background of backgrounds) {
        const distance = Math.max(
          Math.abs(frame[i] - background[i]),
          Math.abs(frame[i + 1] - background[i + 1]),
          Math.abs(frame[i + 2] - background[i + 2]),
        );
        if (distance < nearest) nearest = distance;
        if (nearest < threshold) break;
      }
      if (nearest < threshold) continue;
      result.changed += 1;
      // Cube the distance to the nearest edge: an arm is a long strip of
      // low-weight pixels near an edge, while the item at its tip sits near the
      // middle.  Squared was not enough for a 30x60 arm against a 12x12 item.
      const edge = Math.min(x + 1, y + 1, width - x, height - y);
      const weight = edge * edge * edge;
      result.weightedX += x * weight;
      result.weightedY += y * weight;
      result.weightSum += weight;
      if (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2) result.edgeTouch = true;
      if (x < result.minX) result.minX = x;
      if (x > result.maxX) result.maxX = x;
      if (y < result.minY) result.minY = y;
      if (y > result.maxY) result.maxY = y;
    }
  }
  return result;
}

function regionFrom(
  found: Scan,
  width: number,
  height: number,
  maxFraction: number,
): FocusRegion | null {
  if (found.weightSum === 0) return null;
  const long = Math.max(found.maxX - found.minX + 1, found.maxY - found.minY + 1);
  if ((long * long) / found.total > maxFraction) return null;
  const centre = { x: found.weightedX / found.weightSum, y: found.weightedY / found.weightSum };
  // A person can span most of the frame.  Keep the crop on the object scale
  // rather than handing the classifier a picture of a torso.
  const cap = Math.round(Math.min(width, height) * 0.75);
  const side = Math.min(cap, Math.max(8, Math.round(long * 1.25)));
  const box = squareCrop(
    {
      x: Math.round(centre.x - side / 2),
      y: Math.round(centre.y - side / 2),
      width: side,
      height: side,
    },
    width,
    height,
    0,
  );
  return {
    box,
    coverage: (long * long) / found.total,
    edgeTouch: found.edgeTouch,
    centre,
  };
}

/**
 * The crop to classify, weighted towards the middle of the frame.
 *
 * A visitor holding an item brings an arm in from an edge; the item is usually
 * at the far end of that arm.  A plain bounding box would centre the crop on
 * the arm.  Each changed pixel is weighted by its distance from the nearest
 * frame edge, so the arm contributes little and the item at the middle pulls
 * the crop towards itself.  `edgeTouch` tells the page that a hand/person is
 * probably in shot, so it can say so instead of quietly classifying a sleeve.
 */
export function focusRegion(
  backgrounds: Uint8ClampedArray[],
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  options: FocusOptions = {},
): FocusRegion | null {
  const { threshold, minFraction, maxFraction } = { ...DEFAULTS, ...options };
  const found = scan(backgrounds, frame, width, height, threshold);
  if (!found) return null;
  if (found.changed === 0 || found.changed / found.total < minFraction) return null;
  return regionFrom(found, width, height, maxFraction);
}

/**
 * The same comparison, but it says *which* of the two "no region" answers it is.
 *
 * The camera loop needs the difference: an empty table is worth reporting as
 * “Not a waste item”, while a background that no longer matches the table is a
 * problem the operator has to fix, and the item in front of the camera must
 * still be classified.
 */
export function sceneState(
  backgrounds: Uint8ClampedArray[],
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  options: FocusOptions = {},
): SceneState {
  const { threshold, minFraction, maxFraction } = { ...DEFAULTS, ...options };
  const found = scan(backgrounds, frame, width, height, threshold);
  // No usable reference: nothing to compare with, so the page falls back to the
  // whole frame rather than claiming the table is empty.
  if (!found) return { kind: 'unmatched' };
  if (found.changed === 0 || found.changed / found.total < minFraction) return { kind: 'empty' };
  const region = regionFrom(found, width, height, maxFraction);
  if (!region) return { kind: 'unmatched' };
  return { kind: 'object', region };
}

export interface ObjectMask {
  /** RGBA at the box's own size: opaque where the frame changed, clear where it did not. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Share of the box that was kept. */
  kept: number;
}

/**
 * Paint out everything that is still the empty scene.
 *
 * Cropping to the changed box removes the room but keeps whatever else falls
 * inside the square — the table under the item, a sleeve at the edge, the
 * background between them.  Those pixels are *the same as the stored empty
 * scene*, so they can be identified exactly rather than guessed at, and
 * replaced with a plain plate.  That is what a cutout site does, except it
 * never has to decide what "the subject" is: a pixel that matches the empty
 * table cannot be the item.
 *
 * Measured on 217 scenes (a real object pasted onto a real room photo, then
 * classified by the installed model), the item-level action accuracy goes from
 * **32.9% to 60.8%** with this step.  A general saliency remover applied to the
 * same scenes reaches 52.7% and sometimes deletes the item and keeps the
 * furniture, which is why it is not used.
 *
 * Returns `null` when the mask would be useless — nothing changed (so there is
 * nothing to keep) or almost nothing survived (a moved camera makes the whole
 * frame "changed", which is the plain crop again).  The caller must fall back
 * to the ordinary crop in both cases, never classify a blank plate.
 */
export function objectMask(
  backgrounds: Uint8ClampedArray[],
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  box: Box,
  options: FocusOptions = {},
): ObjectMask | null {
  const { threshold } = { ...DEFAULTS, ...options };
  if (width <= 0 || height <= 0 || backgrounds.length === 0) return null;
  const expected = width * height * 4;
  if (frame.length < expected) return null;
  if (backgrounds.some((background) => background.length < expected)) return null;
  const left = Math.max(0, Math.round(box.x));
  const top = Math.max(0, Math.round(box.y));
  const boxWidth = Math.min(Math.round(box.width), width - left);
  const boxHeight = Math.min(Math.round(box.height), height - top);
  if (boxWidth <= 0 || boxHeight <= 0) return null;

  const data = new Uint8ClampedArray(boxWidth * boxHeight * 4);
  let keptCount = 0;
  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      const i = ((top + y) * width + (left + x)) * 4;
      let nearest = Number.POSITIVE_INFINITY;
      for (const background of backgrounds) {
        const distance = Math.max(
          Math.abs(frame[i] - background[i]),
          Math.abs(frame[i + 1] - background[i + 1]),
          Math.abs(frame[i + 2] - background[i + 2]),
        );
        if (distance < nearest) nearest = distance;
        if (nearest < threshold) break;
      }
      const out = (y * boxWidth + x) * 4;
      if (nearest < threshold) continue;
      keptCount += 1;
      data[out] = 255;
      data[out + 1] = 255;
      data[out + 2] = 255;
      data[out + 3] = 255;
    }
  }

  const kept = keptCount / (boxWidth * boxHeight);
  // A mask that keeps almost nothing has mis-measured, and the plain white plate
  // it leaves is not a neutral picture -- it is an answer.  Measured on the
  // deployed model: a plain white 224x224 square is Paper 0.69, and a white
  // plate with a small dark object on it is still Paper 0.67.
  //
  // That is not hypothetical.  Fifteen of the venue's own saved captures were
  // called "paper" with a median of 85% of the crop white: the mask had painted
  // the item away and the model was shown an empty plate.
  //
  // 15% is the floor: below it the plain crop is used instead, which is at worst
  // the item plus its surroundings rather than a white square.
  if (kept < 0.15) return null;
  return { data, width: boxWidth, height: boxHeight, kept };
}

/** Bounding box against a single background (kept for callers and tests). */
export function diffBox(
  background: Uint8ClampedArray,
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  options: FocusOptions = {},
): Box | null {
  return diffBoxMulti([background], frame, width, height, options);
}

/**
 * Grow a box into a square with a margin, clamped to the frame.
 *
 * A square matters because Teachable Machine's `predict` covers the frame
 * before resizing; a long thin box would be padded back with background.
 */
export function squareCrop(box: Box, width: number, height: number, padding = DEFAULTS.padding): Box {
  const margin = Math.round(Math.max(box.width, box.height) * padding);
  let side = Math.round(Math.max(box.width, box.height) + margin * 2);
  side = Math.max(8, Math.min(side, width, height));
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  let x = Math.round(cx - side / 2);
  let y = Math.round(cy - side / 2);
  x = Math.max(0, Math.min(x, width - side));
  y = Math.max(0, Math.min(y, height - side));
  return { x, y, width: side, height: side };
}

/** Centre square, used when no object can be separated from the background. */
export function centreCrop(width: number, height: number, share = 0.72): Box {
  const side = Math.max(8, Math.round(Math.min(width, height) * Math.min(1, Math.max(0.2, share))));
  return {
    x: Math.round((width - side) / 2),
    y: Math.round((height - side) / 2),
    width: side,
    height: side,
  };
}

/**
 * Where that square sits inside the preview, as percentages of the box.
 *
 * The page draws this on the video so the operator can see *exactly* which part
 * of the picture will be read.  It matters because the preview and the crop used
 * to disagree: the video is drawn with `object-fit: cover` in a 4:3 frame, so a
 * 16:9 camera's left and right edges were hidden — an item could be held inside
 * the picture, be visible to the person holding it in the room, and be cropped
 * out of the preview and partly out of the read.
 *
 * `aspect` is the video's own `videoWidth / videoHeight`, and the caller sizes
 * the frame to the same ratio, so a percentage of the box is a percentage of the
 * frame and the numbers here are the numbers `centreCrop` uses.
 */
export function cropGuide(
  aspect: number,
  share = 0.72,
): { left: string; top: string; width: string; height: string } | null {
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  const side = Math.min(1, Math.max(0.2, share));
  // The square is `share` of the shorter side, so one of the two percentages is
  // always exactly `share` and the other shrinks with the aspect.
  const width = aspect >= 1 ? side / aspect : side;
  const height = aspect >= 1 ? side : side * aspect;
  const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
  return {
    left: pct((1 - width) / 2),
    top: pct((1 - height) / 2),
    width: pct(width),
    height: pct(height),
  };
}


/** Map a box measured on the small analysis frame onto the video frame. */
export function scaleBox(box: Box, fromWidth: number, fromHeight: number, toWidth: number, toHeight: number): Box {
  const sx = toWidth / Math.max(1, fromWidth);
  const sy = toHeight / Math.max(1, fromHeight);
  return {
    x: Math.round(box.x * sx),
    y: Math.round(box.y * sy),
    width: Math.round(box.width * sx),
    height: Math.round(box.height * sy),
  };
}
