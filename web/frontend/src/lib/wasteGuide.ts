/**
 * The one place that decides what to do with an item.
 *
 * Two rules shape this file:
 *
 * 1. **What the item is, and what to do with it, are different things.**
 *    Recognising plastic does not mean "put it in the plastic bin": a chemical
 *    container and an empty drinks bottle are both plastic and belong in
 *    different places.  So the classifier's label is only ever an *input* here.
 * 2. **Never force an answer into one of the three bins.**  A mixed bag, a
 *    syringe, a battery, a used tissue or a confident-but-unknown object has no
 *    bin, and saying so is the correct answer.
 *
 * This is a Class 6 school model with three physical bins: organic, plastic and
 * paper/cardboard.  It demonstrates three everyday categories.  It does not
 * sort waste, does not guarantee recyclability, and cannot see inside an opaque
 * bag.  Confidence is not proof of safety.
 *
 * Everything a reader sees — the result card, Lia's sentence, and the help page
 * — reads from this file, so those three cannot disagree.
 */

export type BinId = 'organic' | 'plastic' | 'paper';

/** Where an item should go.  `separate` and `support` are not bins. */
export type Destination = BinId | 'separate' | 'support' | 'nothing';

export interface BinGuide {
  id: BinId;
  /** Shown on the card, e.g. "Organic / food waste". */
  title: string;
  /** One line of examples, for the help page. */
  examples: string;
  /** The single preparation sentence shown with a result. */
  prepare: string;
  /** What must not go in, in the words a child can act on. */
  keepOut: string;
}

export const BINS: Record<BinId, BinGuide> = {
  organic: {
    id: 'organic',
    title: 'Organic / food waste',
    examples: 'Fruit peels, vegetable scraps, food leftovers and flowers.',
    prepare: 'Put it in the organic / food waste bin.',
    keepOut:
      'Diapers, sanitary pads, medical cotton and anything contaminated do not belong here.',
  },
  plastic: {
    id: 'plastic',
    title: 'Plastic',
    examples: 'Empty, clean plastic items our collection accepts.',
    prepare: 'Empty and rinse it, then put it in the plastic bin.',
    keepOut:
      'Not all plastic is recyclable. Chemical containers, contaminated items, multilayer packaging and plastics you are unsure about need the Gram Sahayak.',
  },
  paper: {
    id: 'paper',
    title: 'Paper & cardboard',
    examples: 'Clean, dry paper, newspapers and cardboard.',
    prepare: 'Keep it dry and flat, then put it in the paper & cardboard bin.',
    keepOut:
      'Coated cups, laminated packaging, used tissues and food-soiled paper do not belong here.',
  },
};

/** The support role.  "Gram Sahayak" is our project's name for it. */
export const SUPPORT_ROLE = 'Gram Sahayak';
export const SUPPORT_ROLE_INTRO = 'Gram Sahayak (Village Assistant)';

/**
 * Where to ask for help.  Left blank on purpose: an invented phone number is
 * worse than none, so the card falls back to the demonstration desk.  Fill
 * `contact` in when a real number exists and the button becomes a link.
 */
export const SUPPORT: { desk: string; contact: string } = {
  desk: 'Ask the Gram Sahayak at the demonstration desk.',
  contact: '',
};

/** Whether an authorised collection route is configured for a material. */
export const ROUTES: { glass: boolean; metal: boolean } = { glass: false, metal: false };

export const WORDS = {
  uncertain:
    'I’m not sure about this item. Please do not put it in a bin yet. Contact Gram Sahayak.',
  mixedBag:
    'I cannot reliably identify everything inside this bag. Please show one safe item at a time, or contact Gram Sahayak.',
  sanitary:
    'Wrap securely and keep separately for authorised sanitary-waste collection. Do not place this in our three bins. Contact Gram Sahayak.',
  sharps:
    'Do not place this in our three bins or handle it for the demonstration. Ask an adult or Gram Sahayak about authorised collection.',
  outside:
    'This item is outside our three demonstration bins. Keep it separate and contact Gram Sahayak.',
  separateUnconfigured:
    'Keep it separate. An authorised collection route for this material is not set up here, so contact Gram Sahayak.',
  notProof:
    'This is a camera suggestion, not proof that the item is safe or that it went in the bin.',
} as const;

export interface Disposal {
  /** What the AI (or the reader) says the item is. */
  item: string;
  destination: Destination;
  /** The card's headline: a bin title, "Keep separate", or "Ask the Gram Sahayak". */
  title: string;
  /** One short reason or preparation instruction. */
  reason: string;
  /** True when the item must not go in one of the three bins. */
  separate: boolean;
  /** True when the answer is "ask the Gram Sahayak". */
  support: boolean;
  tone: 'ok' | 'warn' | 'danger';
}

/** Items that are never sorted by material, whatever the model says. */
const SANITARY = ['diaper', 'nappy', 'sanitary', 'pad', 'tampon'];
const SHARPS = ['syringe', 'needle', 'sharp', 'blade', 'scalpel'];
const MEDICAL = ['medicine', 'medical', 'tablet', 'pill', 'cotton', 'bandage', 'mask'];
const CHEMICAL = ['chemical', 'pesticide', 'solvent', 'paint', 'acid'];
const BATTERY = ['battery', 'cell'];

function has(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

/**
 * The routing table.  `label` is the classifier's class (organic, plastic,
 * paper, glass, metal, textile, leather, footwear, thermocol, ewaste,
 * background) or a phrase the reader typed/chose.
 */
export function guideFor(
  label: string,
  options: { uncertain?: boolean; mixedBag?: boolean } = {},
): Disposal {
  const text = String(label ?? '').trim().toLowerCase();

  if (options.mixedBag) {
    return {
      item: 'Mixed bag / several items',
      destination: 'support',
      title: 'Keep separate',
      reason: WORDS.mixedBag,
      separate: true,
      support: true,
      tone: 'warn',
    };
  }
  if (options.uncertain || !text || text === 'background') {
    return {
      item: options.uncertain ? 'Not a clear item' : 'Nothing recognised',
      destination: 'support',
      title: 'Ask the Gram Sahayak',
      reason: WORDS.uncertain,
      separate: true,
      support: true,
      tone: 'warn',
    };
  }

  // Special-care waste is decided by what it IS, never by what it is made of.
  // A syringe is plastic; it still must not go in the plastic bin.
  if (has(text, SANITARY)) {
    return { item: label, destination: 'separate', title: 'Keep separate', reason: WORDS.sanitary, separate: true, support: true, tone: 'danger' };
  }
  if (has(text, SHARPS)) {
    return { item: label, destination: 'separate', title: 'Do not handle', reason: WORDS.sharps, separate: true, support: true, tone: 'danger' };
  }
  if (has(text, MEDICAL)) {
    return { item: label, destination: 'separate', title: 'Keep separate', reason: WORDS.sharps, separate: true, support: true, tone: 'danger' };
  }
  if (has(text, CHEMICAL)) {
    return { item: label, destination: 'separate', title: 'Keep separate', reason: WORDS.outside, separate: true, support: true, tone: 'danger' };
  }
  if (has(text, BATTERY) || text.includes('ewaste') || text.includes('electronic')) {
    return {
      item: label,
      destination: 'separate',
      title: 'Keep separate',
      reason:
        'Electronics and batteries need their own authorised collection. Do not put them in our three bins. Contact Gram Sahayak.',
      separate: true,
      support: true,
      tone: 'danger',
    };
  }

  if (text === 'organic') {
    return { item: 'Organic / food waste', destination: 'organic', title: BINS.organic.title, reason: BINS.organic.prepare, separate: false, support: false, tone: 'ok' };
  }
  if (text === 'plastic') {
    return { item: 'Plastic', destination: 'plastic', title: BINS.plastic.title, reason: BINS.plastic.prepare, separate: false, support: false, tone: 'ok' };
  }
  if (text === 'paper') {
    return { item: 'Paper & cardboard', destination: 'paper', title: BINS.paper.title, reason: BINS.paper.prepare, separate: false, support: false, tone: 'ok' };
  }

  // Glass and metal: a separate collection *only when one is configured*.
  if (text === 'glass' || text === 'metal') {
    const configured = text === 'glass' ? ROUTES.glass : ROUTES.metal;
    return {
      item: text === 'glass' ? 'Glass' : 'Metal',
      destination: configured ? 'separate' : 'support',
      title: configured ? 'Keep separate for collection' : 'Ask the Gram Sahayak',
      reason: configured
        ? `Keep it separate for the ${text} collection route. It does not go in our three bins.`
        : WORDS.separateUnconfigured,
      separate: true,
      support: !configured,
      tone: 'warn',
    };
  }

  // Everything else the model can name (textile, leather, footwear, thermocol)
  // is a material, not one of our bins.
  return {
    item: label,
    destination: 'support',
    title: 'Ask the Gram Sahayak',
    reason: WORDS.outside,
    separate: true,
    support: true,
    tone: 'warn',
  };
}

/** The sentence Lia says, kept in step with the card. */
export function spokenFor(disposal: Disposal): string {
  if (disposal.destination === 'organic') return 'Organic food waste. Put it in the organic bin.';
  if (disposal.destination === 'plastic') return 'Empty and clean plastic. Put it in the plastic bin.';
  if (disposal.destination === 'paper') return 'Clean paper. Put it in the paper and cardboard bin.';
  if (disposal.support) return 'Keep this item separate. Contact Gram Sahayak.';
  return 'Keep this item separate for collection.';
}
