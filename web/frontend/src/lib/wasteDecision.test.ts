import { describe, expect, it } from 'vitest';
import { decide, materialClaimOf, specialCareOf } from './wasteDecision';

/** A distribution where `top` has `at` and the rest share the remainder. */
function dist(top: string, at: number, classes = [
  'Organic', 'Plastic', 'Paper', 'Glass', 'Metal', 'Textile',
  'Leather', 'Footwear', 'Thermocol', 'Ewaste', 'Background',
]) {
  const rest = (1 - at) / (classes.length - 1);
  return classes.map((label) => ({ label, confidence: label === top ? at : rest }));
}

const BARS = { binBar: 0.7, materialBar: 0.5 };

describe('ordinary bin decisions', () => {
  it('accepts a confident plastic bottle and allows its lamp', () => {
    const decision = decide({
      predictions: dist('Plastic', 0.92),
      itemLabel: 'clear plastic bottle',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('accepted');
    expect(decision.routeId).toBe('bin.plastic');
    expect(decision.bin).toBe('plastic');
    expect(decision.allowLamp).toBe(true);
    expect(decision.needsOperator).toBe(false);
  });

  it('refuses a bin under its bar when nothing corroborates it', () => {
    // No material word in the name, so only one model is speaking.
    const decision = decide({
      predictions: dist('Plastic', 0.55),
      itemLabel: 'white bottle',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('uncertain');
    expect(decision.routeId).toBe('separate.unknown');
    expect(decision.allowLamp).toBe(false);
    expect(decision.reasonId).toBe('belowBar');
  });

  it('accepts a bin the name agrees with — the business card', () => {
    // The visitor's own item, 2026-11-19: Paper under 0.70 while the namer said
    // "White paper with red and black text".  One model alone needs 0.70; two
    // agreeing need 0.50, and this is the case that made the rule.
    const decision = decide({
      predictions: dist('Paper', 0.61),
      itemLabel: 'White paper with red and black text',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('accepted');
    expect(decision.routeId).toBe('bin.paper');
    expect(decision.bin).toBe('paper');
    expect(decision.reasonId).toBe('corroborated');
    expect(decision.allowLamp).toBe(true);
    expect(decision.classConfidence).toBeCloseTo(0.61);
  });

  it('will not accept a corroborated bin from almost nothing', () => {
    const decision = decide({
      predictions: dist('Paper', 0.45),
      itemLabel: 'white paper card',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('uncertain');
    expect(decision.allowLamp).toBe(false);
  });

  it('still refuses the bin when the name states another material', () => {
    // Corroboration must not become "any name will do".
    const decision = decide({
      predictions: dist('Paper', 0.6),
      itemLabel: 'plastic card',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('conflict');
    expect(decision.allowLamp).toBe(false);
  });

  it('never names a material for an empty frame', () => {
    const decision = decide({
      predictions: dist('Background', 0.9),
      itemLabel: null,
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('nothing');
    expect(decision.allowLamp).toBe(false);
  });
});

describe('e-waste is not ordinary recycling', () => {
  it('does NOT add Metal to Ewaste to reach a threshold', () => {
    // The reported example: Ewaste 45% + Metal 35% used to be "Metal, recycling
    // agent, 80%".  It must be Ewaste's own 45% — under the material bar — and
    // therefore "keep separate and ask", never a named material.
    const predictions = dist('Ewaste', 0.45).map((row) =>
      row.label === 'Metal' ? { ...row, confidence: 0.35 } : row,
    );
    const decision = decide({ predictions, itemLabel: 'cable', visionConfigured: true, ...BARS });
    expect(decision.classId).toBe('ewaste');
    // 0.45, not 0.80: the two probabilities are never added.
    expect(decision.classConfidence).toBeCloseTo(0.45);
    expect(decision.allowLamp).toBe(false);
    // With a *corroborating* name ("cable") it goes to the e-waste collection at
    // its own 45% — a referral, not a bin, and not a claimed 80%.
    expect(decision.routeId).toBe('collect.ewaste');
    expect(decision.reasonId).toBe('corroborated');

    // Without the name it is "keep separate and ask".
    const alone = decide({ predictions, itemLabel: null, visionConfigured: true, ...BARS });
    expect(alone.status).toBe('uncertain');
    expect(alone.routeId).toBe('separate.unknown');
    expect(alone.allowLamp).toBe(false);
  });

  it('sends a confident e-waste item to its own collection, not to a bin', () => {
    const decision = decide({
      predictions: dist('Ewaste', 0.88),
      itemLabel: 'remote control',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('accepted');
    expect(decision.routeId).toBe('collect.ewaste');
    expect(decision.bin).toBeNull();
    expect(decision.allowLamp).toBe(false);
  });

  it('does not name a material just because several share "keep separate"', () => {
    // Glass 22%, Metal 20%, Textile 18% — no single material clears the bar.
    const predictions = dist('Glass', 0.22).map((row) =>
      row.label === 'Metal' ? { ...row, confidence: 0.2 }
        : row.label === 'Textile' ? { ...row, confidence: 0.18 }
          : row,
    );
    const decision = decide({ predictions, itemLabel: null, visionConfigured: false, ...BARS });
    expect(decision.status).toBe('uncertain');
    expect(decision.routeId).toBe('separate.unknown');
  });
});

describe('a conflict refuses the bin', () => {
  it('pencil named, Paper predicted', () => {
    const decision = decide({
      predictions: dist('Paper', 0.93),
      itemLabel: 'orange pencil',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('conflict');
    expect(decision.reasonId).toBe('conflict');
    expect(decision.allowLamp).toBe(false);
    expect(decision.needsOperator).toBe(true);
  });

  it('a metal pipe named, Plastic predicted', () => {
    const decision = decide({
      predictions: dist('Plastic', 0.64),
      itemLabel: 'metal pipe',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('conflict');
    expect(decision.allowLamp).toBe(false);
  });

  it('a diaper named, Organic predicted', () => {
    const decision = decide({
      predictions: dist('Organic', 0.95),
      itemLabel: 'diaper',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('conflict');
    expect(decision.reasonId).toBe('specialCare');
  });

  it('a battery named, Metal predicted', () => {
    const decision = decide({
      predictions: dist('Metal', 0.9),
      itemLabel: 'AA battery',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('conflict');
    expect(decision.reasonId).toBe('specialCare');
  });

  it('cardboard named, Organic predicted', () => {
    const decision = decide({
      predictions: dist('Organic', 0.85),
      itemLabel: 'piece of cardboard',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('conflict');
  });

  it('a plastic lid named, Ewaste predicted — the cap that started this', () => {
    const decision = decide({
      predictions: dist('Ewaste', 0.4),
      itemLabel: 'clear plastic lid',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('conflict');
    expect(decision.allowLamp).toBe(false);
  });

  it('agreement is not a conflict', () => {
    const decision = decide({
      predictions: dist('Paper', 0.88),
      itemLabel: 'cardboard box',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('accepted');
    expect(decision.routeId).toBe('bin.paper');
  });

  it('a name with no material word creates no conflict', () => {
    const decision = decide({
      predictions: dist('Plastic', 0.9),
      itemLabel: 'bottle',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('accepted');
  });
});

describe('degraded mode: the namer is configured but did not answer', () => {
  it('does not light a bin on the local answer alone, and asks a person', () => {
    const decision = decide({
      predictions: dist('Plastic', 0.95),
      itemLabel: null,
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('uncertain');
    expect(decision.reasonId).toBe('identificationMissing');
    expect(decision.allowLamp).toBe(false);
    expect(decision.needsOperator).toBe(true);
    // The category is still shown — it just may not open a bin unconfirmed.
    expect(decision.routeId).toBe('bin.plastic');
  });

  it('still answers for a material, where nothing physical happens', () => {
    const decision = decide({
      predictions: dist('Metal', 0.8),
      itemLabel: null,
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.routeId).toBe('collect.metal');
    expect(decision.allowLamp).toBe(false);
  });

  it('a deployment with no namer at all keeps the documented local-only policy', () => {
    const decision = decide({
      predictions: dist('Plastic', 0.95),
      itemLabel: null,
      visionConfigured: false,
      ...BARS,
    });
    expect(decision.status).toBe('accepted');
    expect(decision.allowLamp).toBe(true);
  });
});

describe('the word maps', () => {
  it('finds special care in a name, and nowhere else', () => {
    expect(specialCareOf('used syringe')).toBe('specialCare');
    expect(specialCareOf('AA battery')).toBe('specialCare');
    expect(specialCareOf('plastic bottle')).toBeNull();
    expect(specialCareOf(null)).toBeNull();
  });

  it('reads the material a name states', () => {
    expect(materialClaimOf('metal pipe')).toBe('collect.metal');
    expect(materialClaimOf('piece of cardboard')).toBe('bin.paper');
    expect(materialClaimOf('orange pencil')).toBe('separate.unknown');
    expect(materialClaimOf('remote control')).toBe('collect.ewaste');
    expect(materialClaimOf('bottle')).toBeNull();
  });
});

describe('the name corroborating the classifier (materials only)', () => {
  it('accepts a low e-waste reading when the name agrees — the remote at 0.40', () => {
    // The exhibit's own case, 2026-11-19: "remote control", Ewaste 0.40.  Under
    // the material bar, so the page used to say "not sure" about an item it had
    // already classed correctly.
    const decision = decide({
      predictions: dist('Ewaste', 0.4),
      itemLabel: 'remote control',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('accepted');
    expect(decision.routeId).toBe('collect.ewaste');
    expect(decision.reasonId).toBe('corroborated');
    expect(decision.classConfidence).toBeCloseTo(0.4);
  });

  it('never lets the name corroborate a BIN, however sure it sounds', () => {
    const decision = decide({
      predictions: dist('Plastic', 0.45),
      itemLabel: 'clear plastic lid',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('uncertain');
    expect(decision.allowLamp).toBe(false);
  });

  it('does not corroborate a different material', () => {
    const decision = decide({
      predictions: dist('Metal', 0.4),
      itemLabel: 'plastic lid',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('conflict');
  });

  it('does not corroborate from almost nothing', () => {
    const decision = decide({
      predictions: dist('Metal', 0.2),
      itemLabel: 'metal keys',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('uncertain');
    expect(decision.routeId).toBe('separate.unknown');
  });

  it('leaves a confident material exactly as it was', () => {
    const decision = decide({
      predictions: dist('Ewaste', 0.88),
      itemLabel: 'remote control',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.reasonId).toBe('ok');
  });
});

describe('an object in the name outranks the material it is made of', () => {
  it('sends a plastic remote control to e-waste, not the plastic bin', () => {
    // The exhibit's own two items (2026-11-19): Ewaste 0.38 and 0.46 averaged,
    // named "Remote control made of plastic".  Read as a *plastic claim* this
    // was a conflict; the object is what decides, and it is e-waste.
    const decision = decide({
      predictions: dist('Ewaste', 0.38),
      itemLabel: 'Remote control made of plastic',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('accepted');
    expect(decision.routeId).toBe('collect.ewaste');
    expect(decision.reasonId).toBe('corroborated');
    expect(decision.allowLamp).toBe(false);
  });

  it('does not turn a confident keyboard into a plastic referral', () => {
    const decision = decide({
      predictions: dist('Ewaste', 0.62),
      itemLabel: 'plastic keyboard',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.routeId).toBe('collect.ewaste');
    expect(decision.reasonId).toBe('ok');
    expect(decision.status).toBe('accepted');
  });

  it('refuses a metal referral for a watch the name calls electronic', () => {
    // Measured 2026-11-19: letting the name promote "silver metal watch" to
    // Metal was one of the wrong changes.  Object vs material is a disagreement,
    // so the page asks instead.
    const decision = decide({
      predictions: dist('Metal', 0.62),
      itemLabel: 'silver metal watch',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('conflict');
    expect(decision.routeId).toBe('separate.unknown');
    expect(decision.allowLamp).toBe(false);
  });

  it('treats a business card as paper, and a bare card as no claim', () => {
    // The namer often answers "business card" without the word paper; that is
    // the exhibit's own sample class.  "card" alone stays unsaid because a
    // credit card is electronic.
    expect(materialClaimOf('A business card')).toBe('bin.paper');
    expect(materialClaimOf('visiting card')).toBe('bin.paper');
    expect(materialClaimOf('a card')).toBeNull();
  });

  it('still reads a name with no object as the material it states', () => {
    expect(materialClaimOf('metal pipe')).toBe('collect.metal');
    expect(materialClaimOf('Remote control made of plastic')).toBe('collect.ewaste');
    expect(materialClaimOf('plastic keyboard')).toBe('collect.ewaste');
  });
});
