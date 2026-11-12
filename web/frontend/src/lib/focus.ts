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
 * Bounding box of the pixels that differ between two RGBA frames.
 *
 * Returns `null` when nothing meaningful changed, or when almost everything
 * changed (that is a moved camera or a light being switched, not one object).
 */
export function diffBox(
  background: Uint8ClampedArray,
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  options: FocusOptions = {},
): Box | null {
  const { threshold, minFraction, maxFraction } = { ...DEFAULTS, ...options };
  if (width <= 0 || height <= 0) return null;
  const expected = width * height * 4;
  if (background.length < expected || frame.length < expected) return null;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let changed = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const dr = Math.abs(frame[i] - background[i]);
      const dg = Math.abs(frame[i + 1] - background[i + 1]);
      const db = Math.abs(frame[i + 2] - background[i + 2]);
      if (Math.max(dr, dg, db) < threshold) continue;
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
