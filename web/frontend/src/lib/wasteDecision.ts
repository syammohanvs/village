/**
 * What to do with an item — decided once, from both models, before anything
 * physical happens.
 *
 * Three facts are kept apart on purpose, because they answer different
 * questions and the page must never let one stand in for another:
 *
 *   classification   a material distribution from the local ResNet50
 *   identification   a *name* from a hosted vision model ("clear plastic lid")
 *   handling         where this item goes, and whether a lamp may be lit
 *
 * The rules below are deliberately conservative and testable.  They are a
 * demonstration aid, not a waste authority: **they cannot detect every
 * hazardous or misclassified object**, and the page says so.
 *
 * Stable ids only — `routeId`, `classId`, `reasonId` — so routing and tests do
 * not depend on a translated sentence.
 */
import type { Prediction } from './wasteStabilizer';

/** Where the item goes.  `bin.*` are the only routes with a lamp. */
export type RouteId =
  | 'bin.organic'
  | 'bin.plastic'
  | 'bin.paper'
  | 'collect.glass'
  | 'collect.metal'
  | 'collect.textile'
  | 'collect.leather'
  | 'collect.footwear'
  | 'collect.thermocol'
  | 'collect.ewaste'
  | 'separate.unknown'
  | 'nothing';

export type BinId = 'organic' | 'plastic' | 'paper';

export type DecisionStatus =
  /** A confident, non-conflicting answer. */
  | 'accepted'
  /** Nothing to sort: an empty frame or the background class. */
  | 'nothing'
  /** The classifier is under its bar, or only materials are plausible. */
  | 'uncertain'
  /** The two models disagree in a way that matters, or a special-care cue. */
  | 'conflict';

export type ReasonId =
  | 'ok'
  | 'belowBar'
  | 'conflict'
  | 'specialCare'
  | 'identificationMissing'
  | 'unsupported';

export interface DecisionInput {
  /** The averaged classifier distribution (11 classes). */
  predictions: Prediction[];
  /** The hosted model's name, or null when none came back. */
  itemLabel: string | null;
  /** Whether a hosted model is configured at all. */
  visionConfigured: boolean;
  /** The bar a bin must clear on its own class. */
  binBar: number;
  /** The bar a material must clear before it is named. */
  materialBar: number;
}

export interface Decision {
  status: DecisionStatus;
  routeId: RouteId;
  bin: BinId | null;
  /** The classifier's own class, kept for the details panel. */
  classId: string | null;
  classConfidence: number;
  /** The second guess, so the panel can show that it was close. */
  runnerUpId: string | null;
  runnerUpConfidence: number;
  itemLabel: string | null;
  reasonId: ReasonId;
  /** True only when a bin lamp may be lit for this decision. */
  allowLamp: boolean;
  /** True when a person should be asked before acting (degraded mode). */
  needsOperator: boolean;
}

/** The bar a material must clear before the page names it at all. */
export const MATERIAL_BAR = 0.5;

const BIN_OF: Record<string, BinId> = {
  organic: 'organic',
  plastic: 'plastic',
  paper: 'paper',
};

const ROUTE_OF_MATERIAL: Record<string, RouteId> = {
  glass: 'collect.glass',
  metal: 'collect.metal',
  textile: 'collect.textile',
  leather: 'collect.leather',
  footwear: 'collect.footwear',
  thermocol: 'collect.thermocol',
  ewaste: 'collect.ewaste',
};

/**
 * Words that mean "this needs special handling", from the item name.
 *
 * Each one is a *cue*, not a diagnosis: the namer is fallible too, and the page
 * says so.  A cue refuses a bin; it never chooses one.
 */
const SPECIAL_CARE: { words: string[]; reason: ReasonId }[] = [
  { words: ['diaper', 'nappy', 'sanitary', 'pad', 'tampon', 'menstrual'], reason: 'specialCare' },
  { words: ['syringe', 'needle', 'scalpel', 'blade', 'razor', 'sharp'], reason: 'specialCare' },
  { words: ['battery', 'batteries', 'cell', 'coin cell', 'lithium'], reason: 'specialCare' },
  { words: ['medicine', 'tablet', 'pill', 'capsule', 'syrup', 'ointment'], reason: 'specialCare' },
  { words: ['chemical', 'pesticide', 'insecticide', 'solvent', 'acid', 'paint', 'thinner'], reason: 'specialCare' },
  { words: ['bulb', 'tube light', 'fluorescent', 'cfl'], reason: 'specialCare' },
  { words: ['mask', 'bandage', 'cotton', 'urine bag', 'catheter'], reason: 'specialCare' },
];

/**
 * What the item name says it is *made of*.
 *
 * This is the half that catches a real disagreement — the namer calling a metal
 * pipe "foam roller" is harmless, but a name that clearly states another
 * material than the bin the classifier chose is not.  A name with no material
 * word (a remote control, a pencil) never creates a conflict by itself.
 */
const MATERIAL_WORDS: { route: RouteId | BinId; words: string[] }[] = [
  { route: 'bin.organic', words: ['food', 'banana', 'peel', 'vegetable', 'fruit', 'leaf', 'flower', 'leftover'] },
  { route: 'bin.paper', words: ['paper', 'cardboard', 'carton', 'newspaper', 'notebook', 'envelope'] },
  { route: 'bin.plastic', words: ['plastic', 'pvc', 'bottle cap', 'polythene', 'acrylic', 'silicone'] },
  { route: 'collect.glass', words: ['glass', 'jar'] },
  { route: 'collect.metal', words: ['metal', 'steel', 'iron', 'aluminium', 'aluminum', 'copper', 'brass', 'tin', 'pipe'] },
  { route: 'collect.textile', words: ['cloth', 'fabric', 'textile', 'cotton', 'wool', 'shirt', 'towel'] },
  { route: 'collect.leather', words: ['leather'] },
  { route: 'collect.footwear', words: ['shoe', 'sandal', 'slipper', 'boot', 'footwear'] },
  { route: 'collect.thermocol', words: ['thermocol', 'styrofoam', 'foam'] },
  { route: 'collect.ewaste', words: ['remote', 'phone', 'cable', 'charger', 'electronic', 'keyboard', 'mouse'] },
  { route: 'separate.unknown', words: ['pencil', 'crayon', 'ruler', 'eraser'] },
];

function fold(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

function hasWord(haystack: string, words: string[]): boolean {
  return words.some((word) => haystack.includes(` ${word} `) || haystack.includes(` ${word}s `));
}

/** The special-care cue in a name, if any. */
export function specialCareOf(itemLabel: string | null): ReasonId | null {
  if (!itemLabel) return null;
  const text = fold(itemLabel);
  for (const group of SPECIAL_CARE) {
    if (hasWord(text, group.words)) return group.reason;
  }
  return null;
}

/** What the name says the item is made of, as a route (or null). */
export function materialClaimOf(itemLabel: string | null): RouteId | BinId | null {
  if (!itemLabel) return null;
  const text = fold(itemLabel);
  for (const group of MATERIAL_WORDS) {
    if (hasWord(text, group.words)) return group.route;
  }
  return null;
}

function base(predictions: Prediction[]): Prediction | null {
  let top: Prediction | null = null;
  for (const row of predictions) {
    if (!row || typeof row.label !== 'string') continue;
    const value = Number(row.confidence);
    if (!Number.isFinite(value) || value < 0) continue;
    if (!top || value > top.confidence) top = { label: row.label, confidence: value };
  }
  return top;
}

function runnerUp(predictions: Prediction[], label: string | null): Prediction | null {
  let best: Prediction | null = null;
  for (const row of predictions) {
    if (!row || row.label === label) continue;
    const value = Number(row.confidence);
    if (!Number.isFinite(value) || value < 0) continue;
    if (!best || value > best.confidence) best = { label: row.label, confidence: value };
  }
  return best;
}

/**
 * Decide.  Pure: same inputs, same answer, no state, no clock.
 *
 * The order matters and is the safety argument:
 *   1. nothing / unknown class  → nothing to sort
 *   2. a special-care cue        → never a bin, ask a person
 *   3. a material disagreement   → never a bin, ask a person
 *   4. a bin under its bar       → uncertain, no lamp
 *   5. a bin at/over its bar     → accepted, lamp allowed
 *   6. a material at/over its bar→ its own collection route, no lamp
 *   7. otherwise                 → uncertain, keep separate, ask
 */
export function decide(input: DecisionInput): Decision {
  const top = base(input.predictions);
  const second = runnerUp(input.predictions, top?.label ?? null);
  const empty: Decision = {
    status: 'nothing',
    routeId: 'nothing',
    bin: null,
    classId: null,
    classConfidence: 0,
    runnerUpId: null,
    runnerUpConfidence: 0,
    itemLabel: input.itemLabel,
    reasonId: 'ok',
    allowLamp: false,
    needsOperator: false,
  };
  if (!top) return empty;

  const classId = top.label.trim().toLowerCase();
  const confidence = Math.min(1, top.confidence);
  const common = {
    classId,
    classConfidence: confidence,
    runnerUpId: second?.label ?? null,
    runnerUpConfidence: second ? Math.min(1, second.confidence) : 0,
  };

  if (classId === 'background' || classId === 'unknown' || classId === 'none') {
    return { ...empty, ...common, status: 'nothing', reasonId: 'ok' };
  }

  const bin = BIN_OF[classId] ?? null;
  const materialRoute = ROUTE_OF_MATERIAL[classId] ?? null;
  if (!bin && !materialRoute) {
    // A class this build does not know: never guess, never light anything.
    return { ...empty, ...common, status: 'uncertain', routeId: 'separate.unknown', reasonId: 'unsupported' };
  }

  // 2. a special-care cue in the name refuses every bin and every route.
  const special = specialCareOf(input.itemLabel);
  if (special) {
    return {
      ...empty,
      ...common,
      status: 'conflict',
      routeId: 'separate.unknown',
      reasonId: 'specialCare',
      needsOperator: true,
    };
  }

  // 3. the name states another material than the decision we are about to take.
  const claim = materialClaimOf(input.itemLabel);
  const chosenRoute: RouteId | BinId | null = bin ? `bin.${bin}` : materialRoute;
  if (claim && chosenRoute && claim !== chosenRoute) {
    return {
      ...empty,
      ...common,
      status: 'conflict',
      routeId: 'separate.unknown',
      reasonId: 'conflict',
      needsOperator: true,
    };
  }

  if (bin) {
    if (confidence < input.binBar) {
      return { ...empty, ...common, status: 'uncertain', routeId: 'separate.unknown', reasonId: 'belowBar' };
    }
    // 4/5. A bin needs the local answer *and*, when a namer is configured, an
    // identification that did not fail.  A configured-but-unavailable namer is
    // degraded mode: a person confirms before anything is lit.
    if (input.visionConfigured && !input.itemLabel) {
      return {
        ...empty,
        ...common,
        status: 'uncertain',
        routeId: `bin.${bin}`,
        bin,
        reasonId: 'identificationMissing',
        needsOperator: true,
        allowLamp: false,
      };
    }
    return {
      ...empty,
      ...common,
      status: 'accepted',
      routeId: `bin.${bin}`,
      bin,
      reasonId: 'ok',
      allowLamp: true,
    };
  }

  // 6. a material: its own collection route, never a bin lamp, never merged
  // with a different material's probability.
  if (confidence >= input.materialBar && materialRoute) {
    return {
      ...empty,
      ...common,
      status: 'accepted',
      routeId: materialRoute,
      reasonId: 'ok',
      allowLamp: false,
    };
  }
  // 7. an uncertain material is not a confirmed recyclable.
  return {
    ...empty,
    ...common,
    status: 'uncertain',
    routeId: 'separate.unknown',
    reasonId: 'belowBar',
    allowLamp: false,
  };
}
