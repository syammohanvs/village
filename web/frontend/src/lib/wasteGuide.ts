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

import type { MessageKey } from './messages';
import { translate } from './translate';

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

/**
 * A bin needs a higher bar than a referral does.
 *
 * A wrong bin puts an object in the wrong physical bin — that is the mistake
 * this whole project can actually make.  A wrong "keep it separate" costs a
 * conversation with the Gram Sahayak and nothing else.  So the three bins ask
 * for 0.70 and everything else keeps the page's threshold.
 *
 * Measured on the venue's own items at 224 px: cover 0.83, glossy manual 0.95,
 * ceramic cup 0.95, bottle 0.92, phone 0.91, handkerchief 0.94 — every real
 * item clears 0.70 comfortably.  A pencil, which is not one of our three bins,
 * came back Plastic 0.53 and would have gone in the plastic bin; it now reads
 * "not sure, ask the Gram Sahayak".
 */
export const BIN_CONFIDENCE = 0.7;

/** The confidence an answer has to reach, given where it would send the item. */
export function confidenceBar(base: number, disposal: Disposal): number {
  return disposal.separate ? base : Math.max(base, BIN_CONFIDENCE);
}

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
  /** What the AI (or the reader) says the item is — the classifier's label. */
  item: string;
  /** …and that name in the visitor's language, when the class is one we know. */
  itemKey?: MessageKey;
  destination: Destination;
  /** The card's headline, as a translation key. */
  titleKey: MessageKey;
  /** One short reason or preparation instruction, as a translation key. */
  reasonKey: MessageKey;
  keepOutKey?: MessageKey;
  /**
   * English, computed from the keys above.  Kept for the surfaces that are
   * English only (the help page, tests) — never as a second hand-written copy,
   * so the two cannot drift.
   */
  title: string;
  reason: string;
  keepOut?: string;
  /** True when the item must not go in one of the three bins. */
  separate: boolean;
  /** True when the answer is "ask the Gram Sahayak". */
  support: boolean;
  /** True when the item is not waste yet — still useful, in no bin. */
  reuse: boolean;
  tone: 'ok' | 'warn' | 'danger';
}

/** The classifier's class name, in the visitor's language. */
const ITEM_KEYS: Record<string, MessageKey> = {
  organic: 'waste.item.organic',
  plastic: 'waste.item.plastic',
  paper: 'waste.item.paper',
  glass: 'waste.item.glass',
  metal: 'waste.item.metal',
  textile: 'waste.item.textile',
  leather: 'waste.item.leather',
  footwear: 'waste.item.footwear',
  thermocol: 'waste.item.thermocol',
  ewaste: 'waste.item.ewaste',
  background: 'waste.item.background',
};

/** One place builds a Disposal, so its English copy cannot disagree with its keys. */
function make(parts: {
  item: string;
  itemKey?: MessageKey;
  destination: Destination;
  titleKey: MessageKey;
  reasonKey: MessageKey;
  keepOutKey?: MessageKey;
  separate: boolean;
  support: boolean;
  reuse?: boolean;
  tone: 'ok' | 'warn' | 'danger';
}): Disposal {
  return {
    ...parts,
    reuse: parts.reuse ?? false,
    title: translate('en', parts.titleKey),
    reason: translate('en', parts.reasonKey),
    keepOut: parts.keepOutKey ? translate('en', parts.keepOutKey) : undefined,
  };
}

/** Items that are never sorted by material, whatever the model says. */
const SANITARY = ['diaper', 'nappy', 'sanitary', 'pad', 'tampon'];
const SHARPS = ['syringe', 'needle', 'sharp', 'blade', 'scalpel'];
const MEDICAL = ['medicine', 'medical', 'tablet', 'pill', 'cotton', 'bandage', 'mask'];
const CHEMICAL = ['chemical', 'pesticide', 'solvent', 'paint', 'acid'];
const BATTERY = ['battery', 'cell'];

/**
 * Items that are **not waste yet** — still useful, and in none of our bins.
 *
 * A pencil is the exhibit's own example, and the sentence for it is not "keep
 * it separate": it is wood, graphite and clay (and may carry paint, a metal
 * band and an eraser), so it belongs in no bin, and the honest advice is to
 * keep using it and ask about disposal.  The classifier has no class for "a
 * thing that is still useful", so it reads a pencil as Plastic 0.53 or Organic
 * 0.90 — which is why this is also a button the operator can press, not only
 * something the camera can name.
 */
const REUSE = ['pencil'];

function has(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

/**
 * The routing table.  `label` is the classifier's class (organic, plastic,
 * paper, glass, metal, textile, leather, footwear, thermocol, ewaste,
 * background) or a phrase the reader typed/chose.
 *
 * **Routing reads the English label, never a translated word.**  The decision
 * is made here and only then given words, so switching the page to Hindi cannot
 * change where an item is sent.
 */
export function guideFor(
  label: string,
  options: { uncertain?: boolean; mixedBag?: boolean } = {},
): Disposal {
  const text = String(label ?? '').trim().toLowerCase();

  if (options.mixedBag) {
    return make({
      item: 'Mixed bag / several items',
      itemKey: 'waste.item.mixedBag',
      destination: 'support',
      titleKey: 'waste.title.keepSeparate',
      reasonKey: 'waste.word.mixedBag',
      separate: true,
      support: true,
      tone: 'warn',
    });
  }
  if (options.uncertain || !text || text === 'background') {
    return make({
      item: options.uncertain ? 'Not a clear item' : 'Nothing recognised',
      itemKey: options.uncertain ? 'waste.item.uncertain' : 'waste.item.nothing',
      destination: 'support',
      titleKey: 'waste.title.askSahayak',
      reasonKey: 'waste.word.uncertain',
      separate: true,
      support: true,
      tone: 'warn',
    });
  }

  // Special-care waste is decided by what it IS, never by what it is made of.
  // A syringe is plastic; it still must not go in the plastic bin.
  if (has(text, SANITARY)) {
    return make({ item: label, destination: 'separate', titleKey: 'waste.title.keepSeparate',
      reasonKey: 'waste.word.sanitary', separate: true, support: true, tone: 'danger' });
  }
  if (has(text, SHARPS)) {
    return make({ item: label, destination: 'separate', titleKey: 'waste.title.doNotHandle',
      reasonKey: 'waste.word.sharps', separate: true, support: true, tone: 'danger' });
  }
  if (has(text, MEDICAL)) {
    return make({ item: label, destination: 'separate', titleKey: 'waste.title.keepSeparate',
      reasonKey: 'waste.word.sharps', separate: true, support: true, tone: 'danger' });
  }
  if (has(text, CHEMICAL)) {
    return make({ item: label, destination: 'separate', titleKey: 'waste.title.keepSeparate',
      reasonKey: 'waste.word.outside', separate: true, support: true, tone: 'danger' });
  }
  if (has(text, BATTERY) || text.includes('ewaste') || text.includes('electronic')) {
    return make({
      item: label,
      itemKey: 'waste.item.ewaste',
      destination: 'separate',
      titleKey: 'waste.title.keepSeparate',
      reasonKey: 'waste.word.ewaste',
      separate: true,
      support: true,
      tone: 'danger',
    });
  }

  if (text === 'organic') {
    return make({ item: 'Organic / food waste', itemKey: 'waste.item.organic', destination: 'organic',
      titleKey: 'waste.bin.organic.title', reasonKey: 'waste.bin.organic.prepare',
      keepOutKey: 'waste.bin.organic.keepOut', separate: false, support: false, tone: 'ok' });
  }
  if (text === 'plastic') {
    return make({ item: 'Plastic', itemKey: 'waste.item.plastic', destination: 'plastic',
      titleKey: 'waste.bin.plastic.title', reasonKey: 'waste.bin.plastic.prepare',
      keepOutKey: 'waste.bin.plastic.keepOut', separate: false, support: false, tone: 'ok' });
  }
  if (text === 'paper') {
    return make({ item: 'Paper & cardboard', itemKey: 'waste.item.paper', destination: 'paper',
      titleKey: 'waste.bin.paper.title', reasonKey: 'waste.bin.paper.prepare',
      keepOutKey: 'waste.bin.paper.keepOut', separate: false, support: false, tone: 'ok' });
  }

  // Not waste yet.  The manual choice passes "not in our bins" so the same
  // sentence can be reached without the camera naming anything.
  if (has(text, REUSE) || text === 'not in our bins') {
    return make({
      item: text === 'not in our bins' ? 'Not one of our three bins' : label,
      itemKey: text === 'not in our bins'
        ? 'waste.item.notInBins'
        : text === 'pencil' ? 'waste.item.pencil' : undefined,
      destination: 'support',
      titleKey: 'waste.title.reuse',
      reasonKey: 'waste.word.reuse',
      separate: true,
      support: true,
      reuse: true,
      tone: 'warn',
    });
  }

  // Glass and metal: a separate collection *only when one is configured*.
  if (text === 'glass' || text === 'metal') {
    const configured = text === 'glass' ? ROUTES.glass : ROUTES.metal;
    return make({
      item: text === 'glass' ? 'Glass' : 'Metal',
      itemKey: text === 'glass' ? 'waste.item.glass' : 'waste.item.metal',
      destination: configured ? 'separate' : 'support',
      titleKey: configured ? 'waste.title.keepForCollection' : 'waste.title.askSahayak',
      reasonKey: configured
        ? (text === 'glass' ? 'waste.word.glassRoute' : 'waste.word.metalRoute')
        : 'waste.word.separateUnconfigured',
      separate: true,
      support: !configured,
      tone: 'warn',
    });
  }

  // Everything else the model can name (textile, leather, footwear, thermocol)
  // is a material, not one of our bins.
  return make({
    item: label,
    itemKey: ITEM_KEYS[text],
    destination: 'support',
    titleKey: 'waste.title.askSahayak',
    reasonKey: 'waste.word.outside',
    separate: true,
    support: true,
    tone: 'warn',
  });
}

/** The sentence Lia says, kept in step with the card. */
/**
 * Sara's spoken sentence, in the language chosen in Setup.
 *
 * These are the only sentences this page says out loud, so they are translated
 * here rather than in the page: the spoken and written answers come from the
 * same place, and a new language is one entry per line.  The English is the
 * fallback for a language with no translation yet, so a visitor never hears
 * nothing.
 */
const SPOKEN: Record<string, Record<'organic' | 'plastic' | 'paper' | 'support' | 'separate' | 'reuse', string>> = {
  en: {
    organic: 'Organic food waste. Put it in the organic bin.',
    plastic: 'Empty and clean plastic. Put it in the plastic bin.',
    paper: 'Clean paper. Put it in the paper and cardboard bin.',
    support: 'Keep this item separate. Contact Gram Sahayak.',
    separate: 'Keep this item separate for collection.',
    reuse:
      'This is not one of our three bins. Use it for as long as possible, then ask the Gram Sahayak how to dispose of it.',
  },
  ml: {
    organic: 'ആർഗാനിക് ഭക്ഷ്യമാലിന്യം. ഓർഗാനിക് ബിന്നിൽ ഇടുക.',
    plastic: 'ശുദ്ധമായ പ്ലാസ്റ്റിക്. പ്ലാസ്റ്റിക് ബിന്നിൽ ഇടുക.',
    paper: 'വൃത്തിയുള്ള പേപ്പർ. പേപ്പർ, കാർഡ്ബോർഡ് ബിന്നിൽ ഇടുക.',
    support: 'ഇത് വേർതിരിച്ച് സൂക്ഷിക്കുക. ഗ്രാം സഹായകിനെ ബന്ധപ്പെടുക.',
    separate: 'ഇത് ശേഖരണത്തിനായി വേർതിരിച്ച് സൂക്ഷിക്കുക.',
    reuse:
      'ഇത് ഞങ്ങളുടെ മൂന്ന് ബിന്നുകളിൽ ഒന്നല്ല. കഴിയുന്നത്ര കാലം ഉപയോഗിക്കുക. ശേഷം എങ്ങനെ വിനിയോഗിക്കാം എന്ന് ഗ്രാം സഹായകിനോട് ചോദിക്കുക.',
  },
  hi: {
    organic: 'जैविक खाद्य कचरा। इसे जैविक बिन में डालें।',
    plastic: 'साफ़ प्लास्टिक। इसे प्लास्टिक बिन में डालें।',
    paper: 'साफ़ कागज़। इसे कागज़ और कार्डबोर्ड बिन में डालें।',
    support: 'इसे अलग रखें। ग्राम सहायक से संपर्क करें।',
    separate: 'इसे संग्रह के लिए अलग रखें।',
    reuse:
      'यह हमारे तीन बिन में से एक नहीं है। इसे जितने समय तक हो सके इस्तेमाल करें, फिर इसे कैसे निपटाना है ग्राम सहायक से पूछें।',
  },
};

export function spokenFor(disposal: Disposal, language = 'en'): string {
  const lines = SPOKEN[language] ?? SPOKEN.en;
  if (disposal.destination === 'organic') return lines.organic;
  if (disposal.destination === 'plastic') return lines.plastic;
  if (disposal.destination === 'paper') return lines.paper;
  if (disposal.reuse) return lines.reuse;
  if (disposal.support) return lines.support;
  return lines.separate;
}
