import { describe, expect, it } from 'vitest';
import { decide, materialClaimOf, objectRouteOf, specialCareOf } from './wasteDecision';

/** A distribution where `top` has `at` and the rest share the remainder. */
function dist(top: string, at: number, classes = [
  'Organic', 'Plastic', 'Paper', 'Glass', 'Metal', 'Textile',
  'Leather', 'Footwear', 'Thermocol', 'Ewaste', 'Background',
]) {
  const rest = (1 - at) / (classes.length - 1);
  return classes.map((label) => ({ label, confidence: label === top ? at : rest }));
}

const BARS = { binBar: 0.7, materialBar: 0.5 };

/** A decision where the hosted model named the item. */
function named(itemLabel: string, top = 'Paper', at = 0.4) {
  return decide({ predictions: dist(top, at), itemLabel, visionConfigured: true, ...BARS });
}

describe('the item name decides, and the classifier is the fallback', () => {
  it('puts a clear plastic bag in the plastic bin, whatever the local model says', () => {
    // Reported 2026-11-19: the namer said "Clear plastic bag", the classifier
    // said Paper, and the page asked a person.  The name is the answer.
    const decision = named('Clear plastic bag', 'Paper', 0.72);
    expect(decision.status).toBe('accepted');
    expect(decision.routeId).toBe('bin.plastic');
    expect(decision.bin).toBe('plastic');
    expect(decision.allowLamp).toBe(true);
    expect(decision.source).toBe('vision');
    expect(decision.reasonId).toBe('named');
    // The local model's own answer is still reported, not hidden.
    expect(decision.localClassId).toBe('Paper');
    expect(decision.localConfidence).toBeCloseTo(0.72);
  });

  it('routes a named vegetable to the organic bin, whatever the classifier says', () => {
    // Reported 2026-11-20: the namer said "Carrot with top cut off", which
    // states no material, so the decision fell through to the offline model
    // (Plastic 0.42) and referred the carrot.  A produce noun is a route of its
    // own, like "remote" or "pencil".
    const carrot = named('Carrot with top cut off', 'Plastic', 0.42);
    expect(carrot.routeId).toBe('bin.organic');
    expect(carrot.bin).toBe('organic');
    expect(carrot.allowLamp).toBe(true);
    expect(carrot.source).toBe('vision');
    expect(carrot.localClassId).toBe('Plastic');

    expect(named('Onion', 'Glass', 0.27).routeId).toBe('bin.organic');
    expect(named('Large, yellowish, round fruit or vegetable', 'Glass', 0.27).routeId).toBe('bin.organic');
  });

  it('opens the organic bin for every vegetable the exhibit has tried', () => {
    // These are the exact names the camera produced on 2026-11-20, when the
    // page was still running the build from before the produce words existed:
    // "Onion", "Potato" and "Carrot" were all referred.  A named vegetable is
    // food, and food is the organic bin.
    for (const name of ['Onion', 'Potato', 'Carrot', 'Onion peel', 'Tomato', 'Brinjal', 'Ladies finger']) {
      const decision = named(name, 'Plastic', 0.45);
      expect(decision.routeId, name).toBe('bin.organic');
      expect(decision.allowLamp, name).toBe(true);
    }
  });

  it('opens the organic bin for food waste beyond vegetables', () => {
    // Asked for 2026-11-20: the exhibit's items are mostly food, so the bin
    // should be named from the words a namer uses for it, not only produce.
    for (const name of [
      'Banana peel',
      'Leftover rice',
      'Egg shell',
      'Tea leaves',
      'Fish bone',
      'Mango',
      'Grass clippings',
      'Cooked food',
      'Onion scraps',
    ]) {
      const decision = named(name, 'Plastic', 0.45);
      expect(decision.routeId, name).toBe('bin.organic');
      expect(decision.allowLamp, name).toBe(true);
    }
  });

  it('does not read a contents word as the item when the packet is the item', () => {
    // "milk carton" is paper and "bread packet" is not food waste: both words
    // are deliberately absent from the organic list, so the material word that
    // names the packaging decides.
    expect(named('milk carton', 'Organic', 0.9).routeId).toBe('bin.paper');
    expect(named('juice carton', 'Organic', 0.9).routeId).toBe('bin.paper');
    // A bare "bottle" is not a material word (it can be glass or plastic), so a
    // name that only says "orange juice bottle" still needs the classifier.
    expect(named('orange plastic bottle', 'Organic', 0.9).routeId).toBe('bin.plastic');
  });

  it('keeps a material named before the object', () => {
    // "plastic carrot" must stay plastic: the first word is the material, and
    // the produce list must not outrank it.
    expect(named('plastic carrot toy', 'Organic', 0.8).routeId).toBe('bin.plastic');
    expect(named('orange plastic bottle', 'Organic', 0.9).routeId).toBe('bin.plastic');
  });

  it('opens the paper bin for a business card, at any confidence', () => {
    const decision = named('White paper with red and black text', 'Paper', 0.61);
    expect(decision.routeId).toBe('bin.paper');
    expect(decision.allowLamp).toBe(true);
    expect(decision.classId).toBe('paper');
    // The classifier's probability for the class the page chose.
    expect(decision.classConfidence).toBeCloseTo(0.61);
  });

  it('does not need the classifier to agree on the material at all', () => {
    const decision = named('metal water bottle', 'Plastic', 0.8);
    expect(decision.routeId).toBe('collect.metal');
    expect(decision.allowLamp).toBe(false);
  });

  it('reads a wood-and-graphite pencil as none of the three bins', () => {
    const decision = named('orange pencil', 'Paper', 0.93);
    expect(decision.status).toBe('uncertain');
    expect(decision.routeId).toBe('separate.unknown');
    expect(decision.allowLamp).toBe(false);
    expect(decision.source).toBe('vision');
    // Nothing to teach: the name said "none of our bins", so the classifier's
    // own guess must not be filed as training data under a name-derived label.
    expect(decision.classId).toBeNull();
    expect(decision.localClassId).toBe('Paper');
    // Still useful, so the page can say that rather than "keep it separate".
    expect(decision.reasonId).toBe('reuse');
  });

  it('gives a crayon and an eraser the same still-useful route as a pencil', () => {
    for (const name of ['blue crayon', 'white eraser', 'red pencil with a blue eraser']) {
      const decision = named(name, 'Plastic', 0.9);
      expect(decision.reasonId).toBe('reuse');
      expect(decision.bin).toBeNull();
      expect(decision.allowLamp).toBe(false);
    }
    // A named object that is *not* still useful keeps 'named', so the two
    // sentences stay apart.
    expect(named('business card', 'Plastic', 0.9).reasonId).toBe('named');
  });

  it('keeps a special-care cue before everything else', () => {
    // A safety rule, not a classification one: no bin, whatever either model says.
    for (const name of ['used AA battery', 'soiled diaper', 'used syringe', 'expired medicine']) {
      const decision = named(name, 'Plastic', 0.95);
      expect(decision.status).toBe('conflict');
      expect(decision.reasonId).toBe('specialCare');
      expect(decision.allowLamp).toBe(false);
      expect(decision.needsOperator).toBe(true);
      // The name produced the cue, so the name is the reader — and there is no
      // class to teach from a battery, so the classifier's guess is not carried.
      expect(decision.source).toBe('vision');
      expect(decision.classId).toBeNull();
    }
  });

  it('falls back to the classifier when the name states no material or object', () => {
    const decision = named('a white object', 'Plastic', 0.92);
    expect(decision.source).toBe('local');
    expect(decision.routeId).toBe('bin.plastic');
    expect(decision.allowLamp).toBe(true);
  });

  it('keeps the classifier bar when there is no name at all', () => {
    const decision = decide({
      predictions: dist('Plastic', 0.55),
      itemLabel: null,
      visionConfigured: false,
      ...BARS,
    });
    expect(decision.status).toBe('uncertain');
    expect(decision.reasonId).toBe('belowBar');
    expect(decision.allowLamp).toBe(false);
    // The documented local-only policy: with no namer configured, a confident
    // classifier alone still opens a bin.
    const confident = decide({
      predictions: dist('Plastic', 0.92),
      itemLabel: null,
      visionConfigured: false,
      ...BARS,
    });
    expect(confident.routeId).toBe('bin.plastic');
    expect(confident.allowLamp).toBe(true);
  });
});

describe('a silent namer falls back to the offline model', () => {
  it('answers from the classifier when the hosted model did not answer', () => {
    // The internet is down, or the name timed out.  That is what the offline
    // model has been learning the booth's own items for, so its reading stands.
    const decision = decide({
      predictions: dist('Plastic', 0.95),
      itemLabel: null,
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.routeId).toBe('bin.plastic');
    expect(decision.allowLamp).toBe(true);
    expect(decision.source).toBe('local');
  });

  it('still asks when the offline model is under its bar too', () => {
    const decision = decide({
      predictions: dist('Plastic', 0.55),
      itemLabel: null,
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('uncertain');
    expect(decision.reasonId).toBe('belowBar');
    expect(decision.allowLamp).toBe(false);
  });
});

describe('nothing to sort', () => {
  it('stays silent for the background class when the name says nothing', () => {
    const decision = decide({
      predictions: dist('Background', 0.93),
      itemLabel: null,
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('nothing');
    expect(decision.allowLamp).toBe(false);
  });

  it('sorts an item the picture called Background but the name identified', () => {
    const decision = named('clear plastic lid', 'Background', 0.8);
    expect(decision.routeId).toBe('bin.plastic');
    expect(decision.allowLamp).toBe(true);
  });
});

describe('e-waste is not ordinary recycling', () => {
  it('never adds Metal to Ewaste to reach a threshold', () => {
    // With no name: the page does not add two materials together.
    const predictions = dist('Ewaste', 0.45).map((row) =>
      row.label === 'Metal' ? { ...row, confidence: 0.35 } : row,
    );
    const alone = decide({ predictions, itemLabel: null, visionConfigured: true, ...BARS });
    expect(alone.classId).toBe('ewaste');
    expect(alone.classConfidence).toBeCloseTo(0.45);
    expect(alone.status).toBe('uncertain');
    expect(alone.routeId).toBe('separate.unknown');

    // With a name, the name decides — and still no bin.
    const withName = decide({ predictions, itemLabel: 'cable', visionConfigured: true, ...BARS });
    expect(withName.routeId).toBe('collect.ewaste');
    expect(withName.allowLamp).toBe(false);
    expect(withName.classConfidence).toBeCloseTo(0.45);
  });

  it('sends a named remote control to e-waste even at 0.40', () => {
    const decision = named('remote control', 'Ewaste', 0.4);
    expect(decision.routeId).toBe('collect.ewaste');
    expect(decision.classConfidence).toBeCloseTo(0.4);
    expect(decision.allowLamp).toBe(false);
  });
});

describe('the word maps', () => {
  it('reads a special-care cue from a name', () => {
    expect(specialCareOf('used syringe')).toBe('specialCare');
    expect(specialCareOf('AA battery')).toBe('specialCare');
    expect(specialCareOf('plastic bottle')).toBeNull();
    expect(specialCareOf(null)).toBeNull();
  });

  it('reads what the name says the item is', () => {
    expect(materialClaimOf('metal pipe')).toBe('collect.metal');
    expect(materialClaimOf('piece of cardboard')).toBe('bin.paper');
    expect(materialClaimOf('orange pencil')).toBe('separate.unknown');
    expect(materialClaimOf('remote control')).toBe('collect.ewaste');
    expect(materialClaimOf('bottle')).toBeNull();
  });

  it('treats a business card as paper, and a bare card as no claim', () => {
    expect(materialClaimOf('A business card')).toBe('bin.paper');
    expect(materialClaimOf('visiting card')).toBe('bin.paper');
    expect(materialClaimOf('a card')).toBeNull();
  });

  it('lets an object outrank the material it is made of', () => {
    expect(objectRouteOf('Remote control made of plastic')).toBe('collect.ewaste');
    expect(materialClaimOf('Remote control made of plastic')).toBe('collect.ewaste');
    expect(materialClaimOf('plastic keyboard')).toBe('collect.ewaste');
    expect(materialClaimOf('silver metal watch')).toBe('collect.ewaste');
    expect(materialClaimOf('metal pipe')).toBe('collect.metal');
  });
});

describe('the name is parsed, not guessed', () => {
  it('takes the first material named when a name lists two', () => {
    // "glass bottle with a plastic cap" is glass; the cap does not make it plastic.
    expect(materialClaimOf('glass bottle with a plastic cap')).toBe('collect.glass');
  });

  it('does not read a material word inside another word', () => {
    // "tin" is metal; "tinfoil" is not in the vocabulary and matches nothing by
    // accident, and neither does "plasticine" become plastic.
    expect(materialClaimOf('cardboard box')).toBe('bin.paper');
    expect(materialClaimOf('plastics')).toBe('bin.plastic');
    expect(materialClaimOf('a pair of binoculars')).toBeNull();
  });

  it('shows the classifier reading beside a name it overruled', () => {
    const decision = named('clear plastic bag', 'Paper', 0.66);
    expect(decision.source).toBe('vision');
    expect(decision.localClassId).toBe('Paper');
    expect(decision.localConfidence).toBeCloseTo(0.66);
    expect(decision.classId).toBe('plastic');
    expect(decision.classConfidence).toBeCloseTo(
      dist('Paper', 0.66).find((row) => row.label === 'Plastic')!.confidence,
    );
  });
});
