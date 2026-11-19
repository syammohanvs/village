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
  | 'corroborated'
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

/**
 * The bar a **bin** must clear when the name states the same material.
 *
 * One model alone needs 0.70 before a physical lamp is lit.  Two models that
 * agree on what the item is made of need less, and the number is measured
 * rather than chosen: on the 241-photo probe the corroborated route gains **12
 * correct bins and costs one** (`scripts/waste/evidence_experiment.py`), and that
 * one is a photograph of oranges **in cardboard boxes** whose class label is
 * Thermocol — a human would say paper too.  The exhibit's own case is the
 * business card a visitor checked on 2026-11-19: Paper at 0.5–0.7, named "white
 * paper with red and black text", which used to be refused.
 *
 * It is not a blanket lowering of the bar: the floor is still 0.50, the name
 * must state **this bin's** material (or a different one refuses earlier as a
 * conflict), and with no name at all the bar stays 0.70.
 */
export const CORROBORATED_BIN_FLOOR = 0.5;

/**
 * How sure the classifier must be for the *name* to corroborate a material.
 *
 * Below this the picture has not really chosen, and a name alone is how a wall
 * becomes "metal".  It applies to materials only — never to a bin.
 */
export const CORROBORATION_FLOOR = 0.3;

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
 * Objects whose *route is not decided by their material*.
 *
 * This layer exists because a material word is the wrong question for anything
 * electronic: a remote control is **made of plastic** and is still e-waste, so
 * reading "Remote control made of plastic" as a claim on the plastic bin sent
 * the exhibit's own two items the wrong way (2026-11-19).  An object in the name
 * outranks the material it is made of — and it is also what makes the pencil
 * rule work, since a pencil is wood, graphite and clay rather than paper.
 *
 * Deliberately small and conservative: a word here must have a route of its own,
 * not a material's.  `keychain` and `bottle` are *not* here, because a keychain
 * can be metal or electronic and a bottle can be any of three materials — those
 * stay material questions, where a disagreement refuses the answer.
 */
const OBJECT_ROUTES: { route: RouteId | BinId; words: string[] }[] = [
  {
    route: 'collect.ewaste',
    words: [
      'remote', 'remote control', 'keyboard', 'mouse', 'cable', 'charger', 'adapter',
      'phone', 'smartphone', 'mobile', 'tablet', 'laptop', 'computer', 'router',
      'circuit board', 'pcb', 'usb', 'hard disk', 'headphone', 'earphone', 'speaker',
      'camera', 'calculator', 'watch', 'pendrive', 'memory card',
    ],
  },
  // Still useful after its working life, and in none of the three bins.
  { route: 'separate.unknown', words: ['pencil', 'crayon', 'eraser'] },
  // A business card is paper by definition, and it is what the exhibit's own
  // Paper samples are.  Only the two-word name is here: the bare word "card"
  // could be a credit card, which is electronic, and an object route would send
  // that to the paper bin.
  { route: 'bin.paper', words: ['business card', 'visiting card'] },
];

/**
 * What the item name says it is *made of*, when the name names no object.
 *
 * This is the half that catches a real disagreement — the namer calling a metal
 * pipe "foam roller" is harmless, but a name that clearly states another
 * material than the bin the classifier chose is not.  A name with no material
 * word (a keyset, a figurine) never creates a conflict by itself.
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

/**
 * The object the name states, when that object has a route of its own.
 *
 * Checked before any material word, on purpose: "Remote control made of
 * plastic" is e-waste, and only a photograph of a casing could say otherwise.
 */
export function objectRouteOf(itemLabel: string | null): RouteId | BinId | null {
  if (!itemLabel) return null;
  const text = fold(itemLabel);
  for (const group of OBJECT_ROUTES) {
    if (hasWord(text, group.words)) return group.route;
  }
  return null;
}

/**
 * What the name says this item is, as a route (or null).
 *
 * The object wins over the material: a plastic remote is e-waste, and a metal
 * watch is e-waste too.  Only a name that states no object is read as a
 * material — which is what keeps "metal pipe" a metal claim and "orange pencil"
 * a pencil.
 */
export function materialClaimOf(itemLabel: string | null): RouteId | BinId | null {
  const object = objectRouteOf(itemLabel);
  if (object) return object;
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
      // 4b. The picture is not sure enough on its own — but if the name states
      // the same material, two models agree and the bin is accepted.  Measured,
      // and still a floor: see CORROBORATED_BIN_FLOOR.
      if (claim === `bin.${bin}` && confidence >= CORROBORATED_BIN_FLOOR) {
        return {
          ...empty,
          ...common,
          status: 'accepted',
          routeId: `bin.${bin}`,
          bin,
          reasonId: 'corroborated',
          allowLamp: true,
        };
      }
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
  // 6b. A material the picture already chose, *corroborated by the name*, is
  // accepted below the material bar.  This is deliberately narrow:
  //   - only a material, never a bin, so it cannot open a lamp;
  //   - only when the name's material is the SAME as the classifier's top
  //     class — the name corroborates, it never overrides;
  //   - never on a made-up probability: the classifier's own figure is kept.
  // Measured 2026-11-19: letting the name *promote a different* class gained a
  // few classes but added false bins, and the gain moved between two runs of the
  // same probe.  This rule measured as no change at all on the probe, and it
  // fixes the exhibit's own case (a remote control at Ewaste 0.40 + "remote
  // control", which used to be "not sure").
  if (
    materialRoute &&
    confidence >= CORROBORATION_FLOOR &&
    claim === materialRoute
  ) {
    return {
      ...empty,
      ...common,
      status: 'accepted',
      routeId: materialRoute,
      reasonId: 'corroborated',
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
