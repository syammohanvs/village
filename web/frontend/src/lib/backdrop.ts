/**
 * Find the item on the plain backdrop the exhibit uses.
 *
 * A village booth puts one thing on a red, green or white sheet, so the object
 * is simply *the pixels that are not the backdrop* — which is a better crop than
 * the middle of the frame.  Measured on the venue's own frames, an item held in
 * the centre still lost a third of the square to a hand, a sleeve or the wall,
 * and that is exactly what the classifier then judged.
 *
 * This is deliberately geometric and DOM-free: no model, no canvas, so it can be
 * tested on synthetic frames.  It answers **null** whenever it is not sure —
 * a frame with nothing on it, or a scene with no plain backdrop (a wooden table),
 * where the caller falls back to the centre square and behaves as it always did.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pixels closer than this to the backdrop colour count as backdrop. */
const TOLERANCE = 48;
/** Below this share of the frame, nothing is being shown. */
const MIN_SHARE = 0.02;
/** Above it the "backdrop" is not plain, or the item fills the frame. */
const MAX_SHARE = 0.85;
/**
 * The crop grows by this much past the object, so a rim of it is never cut off.
 *
 * Raised from 0.12 to 0.20 on 2026-11-19: the exhibit puts the item on a
 * **fixed** base rather than holding it up, so the extra area around the item is
 * plain base rather than somebody's hand or a wall, and a tighter square was
 * clipping the corners of flat things (a business card is all corner).
 *
 * 0.20 and not more, measured on the venue-condition probe: 0.20 costs nothing
 * in exact class and 2.7 points of item action against 0.12, while 0.30 costs
 * 5.3 and 5.3 (the item fills less of the 224 square the model was trained on).
 * Retraining on the real base is what should let this grow again.
 */
const PAD = 0.2;
/** The crop is never smaller than this share of the short side. */
const MIN_SIDE_SHARE = 0.6;
/** Width of the border band the backdrop colour is read from. */
const EDGE = 3;

export interface BackdropResult {
  /** Median colour of the frame's edge, in RGB. */
  backdrop: [number, number, number];
  /** Where the object is, or null when the caller should use the centre. */
  box: Box | null;
  /** Share of the frame that differs from the backdrop (for diagnostics). */
  share: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The colour of the sheet, read from a band around the frame's edge. */
export function backdropColour(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number] {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  const band = Math.max(1, Math.min(EDGE, Math.floor(Math.min(width, height) / 8)));
  for (let y = 0; y < height; y += 1) {
    const edgeRow = y < band || y >= height - band;
    for (let x = 0; x < width; x += 1) {
      if (!edgeRow && x >= band && x < width - band) {
        x = width - band - 1; // jump to the right-hand band
        continue;
      }
      const i = (y * width + x) * 4;
      reds.push(data[i]);
      greens.push(data[i + 1]);
      blues.push(data[i + 2]);
    }
  }
  return [median(reds), median(greens), median(blues)];
}

/**
 * The object's square on the backdrop, or null.
 *
 * `pad` grows the box and `minSide` keeps the crop from becoming so tight that
 * the classifier sees a texture rather than a thing — both are fractions of the
 * frame, so the same numbers work for a 160×120 analysis frame and a 640×480 one.
 */
export function backdropBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): BackdropResult {
  const backdrop = backdropColour(data, width, height);
  const empty: BackdropResult = { backdrop, box: null, share: 0 };
  if (width < 8 || height < 8) return empty;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const distance = Math.max(
        Math.abs(data[i] - backdrop[0]),
        Math.abs(data[i + 1] - backdrop[1]),
        Math.abs(data[i + 2] - backdrop[2]),
      );
      if (distance <= TOLERANCE) continue;
      count += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  const share = count / (width * height);
  if (maxX < minX || maxY < minY) return { ...empty, share };
  if (share < MIN_SHARE || share > MAX_SHARE) return { ...empty, share };

  // The crop is a square, centred on the object: the classifier was trained on
  // squares and a letterboxed crop distorts what it sees.
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  const short = Math.min(width, height);
  const wanted = Math.max(maxX - minX + 1, maxY - minY + 1) * (1 + PAD);
  const side = Math.max(Math.round(wanted), Math.round(short * MIN_SIDE_SHARE));
  const limit = Math.min(side, Math.min(width, height));
  const x = Math.round(Math.min(Math.max(0, centreX - limit / 2), width - limit));
  const y = Math.round(Math.min(Math.max(0, centreY - limit / 2), height - limit));
  return { backdrop, box: { x, y, width: limit, height: limit }, share };
}
