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

  it('refuses a bin under its bar, and says why', () => {
    const decision = decide({
      predictions: dist('Plastic', 0.55),
      itemLabel: 'plastic bottle',
      visionConfigured: true,
      ...BARS,
    });
    expect(decision.status).toBe('uncertain');
    expect(decision.routeId).toBe('separate.unknown');
    expect(decision.allowLamp).toBe(false);
    expect(decision.reasonId).toBe('belowBar');
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
    expect(decision.classConfidence).toBeCloseTo(0.45);
    expect(decision.status).toBe('uncertain');
    expect(decision.routeId).toBe('separate.unknown');
    expect(decision.allowLamp).toBe(false);
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
