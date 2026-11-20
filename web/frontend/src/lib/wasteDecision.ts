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
  | 'empty'
  | 'belowBar'
  | 'conflict'
  | 'specialCare'
  | 'identificationMissing'
  | 'named'
  | 'unnamed'
  | 'unsupported';

export interface DecisionInput {
  /** The averaged classifier distribution (11 classes). */
  predictions: Prediction[];
  /** The hosted model's name, or null when none came back. */
  itemLabel: string | null;
  /**
   * The hosted model answered "nothing" — an empty scene, which is an answer
   * and not a failure.  `itemLabel` is null in that case too, so this flag is
   * what keeps the two apart: an empty scene is "nothing to sort", while no
   * answer at all falls back to the classifier.
   */
  itemEmpty?: boolean;
  /** Whether a hosted model is configured at all. */
  visionConfigured: boolean;
  /** The bar a bin must clear when the **classifier** is the reader (no name). */
  binBar: number;
  /** The bar a material must clear before the classifier may name it. */
  materialBar: number;
}

export interface Decision {
  status: DecisionStatus;
  routeId: RouteId;
  bin: BinId | null;
  /** The class the page decided on — the name's, when the name spoke. */
  classId: string | null;
  /** The local model's probability for `classId` (0 when it never offered it). */
  classConfidence: number;
  /** Which model decided.  The name is trusted first; the classifier is the fallback. */
  source: 'vision' | 'local';
  /** The classifier's own top class and confidence, always, for the details. */
  localClassId: string | null;
  localConfidence: number;
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

const CLASS_OF_ROUTE: Record<string, string> = {
  'bin.organic': 'organic',
  'bin.plastic': 'plastic',
  'bin.paper': 'paper',
  'collect.glass': 'glass',
  'collect.metal': 'metal',
  'collect.textile': 'textile',
  'collect.leather': 'leather',
  'collect.footwear': 'footwear',
  'collect.thermocol': 'thermocol',
  'collect.ewaste': 'ewaste',
};

/** The classifier's own probability for a class, matched case-insensitively. */
function probabilityOf(predictions: Prediction[], label: string | null): number {
  if (!label) return 0;
  const wanted = label.trim().toLowerCase();
  const row = predictions.find(
    (item) => typeof item?.label === 'string' && item.label.trim().toLowerCase() === wanted,
  );
  const value = Number(row?.confidence);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

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
 * stay material questions, where the material word decides and a model
 * disagreement is never a reason to refuse.
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
  {
    route: 'bin.organic',
    // Food waste, by the words a namer uses for it.  The produce nouns were
    // added after a carrot was read as Plastic 0.42 and referred: "Carrot with
    // top cut off" names no material, so it fell through to the offline model
    // (2026-11-20).  Colours that are also fruit ("orange", "lemon") are
    // deliberately absent — the FIRST word wins, and "orange plastic bottle"
    // must stay plastic.
    words: [
      'food', 'banana', 'peel', 'vegetable', 'fruit', 'leaf', 'flower', 'leftover',
      'carrot', 'onion', 'potato', 'tomato', 'cucumber', 'chilli', 'chili',
      'brinjal', 'eggplant', 'aubergine', 'cabbage', 'cauliflower', 'pumpkin',
      'ginger', 'garlic', 'coconut', 'mango', 'grapes', 'watermelon', 'pineapple',
      'apple', 'beetroot', 'radish', 'turnip', 'spinach', 'okra', 'ladies finger',
      'bitter gourd', 'bottle gourd', 'ridge gourd', 'snake gourd', 'drumstick',
      'papaya', 'guava', 'pomegranate', 'jackfruit', 'sugarcane', 'maize',
    ],
  },
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
  // The FIRST material word in the sentence wins, not the first category in the
  // list: "glass bottle with a plastic cap" is glass, and a list-ordered scan
  // would have called it plastic.
  const text = fold(itemLabel);
  let best: { at: number; long: number; route: RouteId | BinId } | null = null;
  for (const group of MATERIAL_WORDS) {
    for (const word of group.words) {
      for (const variant of [` ${word} `, ` ${word}s `]) {
        const at = text.indexOf(variant);
        if (at === -1) continue;
        if (!best || at < best.at || (at === best.at && word.length > best.long)) {
          best = { at, long: word.length, route: group.route };
        }
      }
    }
  }
  return best ? best.route : null;
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
 * **When a hosted name arrives, the name decides and there is no probability
 * bar** — the rules read it, and its material word is what routes an ordinary
 * item, so "clear plastic bottle" opens the plastic bin even if the classifier
 * disagreed.  The confidence thresholds below belong to the *other* regime,
 * when no name came back and the local classifier is the only reader.
 *
 * The order is the safety argument:
 *   1. a special-care cue in the name → refuse, ask a person (batteries, syringes)
 *   2. an object the name states, with a route of its own → that route
 *      (a plastic remote is e-waste; a pencil is in none of the three bins)
 *   3. the FIRST material word in the name → that material's route, which is a
 *      bin when the material is organic/plastic/paper
 *   4. no name and no classifier reading at all → uncertain, ask
 *   5. no name: background / an unknown class → nothing to sort
 *   6. no name: a bin class at/over `binBar` → accepted, lamp allowed;
 *      a material at/over `materialBar` → its collection route, never a lamp
 *   7. otherwise → uncertain, keep separate, ask
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
    source: 'local',
    localClassId: top?.label ?? null,
    localConfidence: top ? Math.min(1, top.confidence) : 0,
    runnerUpId: null,
    runnerUpConfidence: 0,
    itemLabel: input.itemLabel,
    reasonId: 'ok',
    allowLamp: false,
    needsOperator: false,
  };
  const classId = top ? top.label.trim().toLowerCase() : null;
  const confidence = top ? Math.min(1, top.confidence) : 0;
  const common = {
    classId,
    classConfidence: confidence,
    source: 'local' as const,
    localClassId: top?.label ?? null,
    localConfidence: confidence,
    runnerUpId: second?.label ?? null,
    runnerUpConfidence: second ? Math.min(1, second.confidence) : 0,
  };

  // 0. the model says there is nothing there.  That is an answer, not a failure,
  // and it must not fall through to the classifier: an empty scene that the
  // classifier reads as "Plastic 0.8" because of a patterned base is exactly the
  // wrong bin this page exists to avoid.
  if (input.itemEmpty) {
    return {
      ...empty,
      status: 'nothing',
      routeId: 'nothing',
      reasonId: 'empty',
      itemLabel: null,
    };
  }

  // 1. a special-care cue in the name refuses every bin and every route — before
  // anything else, because it is a safety rule and not a classification one.
  // The name produced the cue, so it is the reader; and there is no class to
  // teach from it (a battery is not one of the eleven), so `classId` is cleared
  // rather than inheriting the classifier's guess.
  const special = specialCareOf(input.itemLabel);
  if (special) {
    return {
      ...empty,
      ...common,
      status: 'conflict',
      routeId: 'separate.unknown',
      classId: null,
      classConfidence: 0,
      source: 'vision',
      reasonId: 'specialCare',
      needsOperator: true,
    };
  }

  // 2. THE NAME DECIDES FIRST (2026-11-19, the operator's instruction).
  //    The hosted model reads an object far better than this classifier reads a
  //    material on the booth's base, so when the name states what the item is
  //    made of, that is the answer — "clear plastic bag" is plastic, whatever the
  //    local model thinks.  The classifier is the fallback when the name says
  //    nothing usable, and its own reading is still reported beside the answer.
  const claim = materialClaimOf(input.itemLabel);
  if (claim && claim !== 'separate.unknown') {
    const claimedBin = claim.startsWith('bin.') ? (claim.slice(4) as BinId) : null;
    const claimedClass = CLASS_OF_ROUTE[claim] ?? null;
    return {
      ...empty,
      ...common,
      status: 'accepted',
      routeId: claim as RouteId,
      bin: claimedBin,
      classId: claimedClass,
      classConfidence: probabilityOf(input.predictions, claimedClass),
      source: 'vision',
      reasonId: 'named',
      allowLamp: claimedBin !== null,
    };
  }

  // A pencil (or crayon) is in none of the three bins, however sure the picture
  // is about the material — that rule is the operator's, and it is text, not a
  // fourth class.
  //
  // `classId` is cleared on purpose.  The name did decide, but it decided "none
  // of our bins", which is not one of the eleven classes the offline model can
  // be taught — and the page files a crop as training data only when
  // `source === 'vision'` AND there is a class.  Inheriting `common.classId`
  // here meant the classifier's own guess was written back as if the name had
  // named it: a pencil pressed as "Plastic 0.7" taught ResNet50 that a pencil is
  // plastic, over and over, which is the one mistake the pencil rule exists to
  // prevent.
  if (claim === 'separate.unknown') {
    return {
      ...empty,
      ...common,
      status: 'uncertain',
      routeId: 'separate.unknown',
      classId: null,
      classConfidence: 0,
      source: 'vision',
      reasonId: 'named',
      allowLamp: false,
    };
  }

  // Nothing to read: no name and no classifier reading (the page no longer runs
  // the local model).  That is not "nothing to sort" — it is "I could not
  // tell", which asks a person.
  if (!top) {
    return {
      ...empty,
      ...common,
      status: 'uncertain',
      routeId: 'separate.unknown',
      reasonId: 'unnamed',
      needsOperator: true,
    };
  }

  const localClass = classId as string;
  if (localClass === 'background' || localClass === 'unknown' || localClass === 'none') {
    return { ...empty, ...common, status: 'nothing', reasonId: 'ok' };
  }

  const bin = BIN_OF[localClass] ?? null;
  const materialRoute = ROUTE_OF_MATERIAL[localClass] ?? null;
  if (!bin && !materialRoute) {
    // A class this build does not know: never guess, never light anything.
    return { ...empty, ...common, status: 'uncertain', routeId: 'separate.unknown', reasonId: 'unsupported' };
  }

  if (bin) {
    if (confidence < input.binBar) {
      return { ...empty, ...common, status: 'uncertain', routeId: 'separate.unknown', reasonId: 'belowBar' };
    }
    // No name means the hosted model could not answer — the internet is down,
    // or it timed out.  That is exactly what the offline model has been
    // learning the booth's own items for, so its reading stands (the operator's
    // instruction, 2026-11-19).  The card still says the name was unavailable.
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
