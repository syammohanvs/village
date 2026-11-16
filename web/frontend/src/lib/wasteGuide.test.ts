/**
 * The validation cases from the requirements, checked against the routing
 * table.  These are about *guidance*, not about what the model says: the same
 * checks must hold when a reader picks a category by hand.
 */
import { describe, expect, it } from 'vitest';
import { BIN_CONFIDENCE, BINS, ROUTES, SUPPORT, WORDS, confidenceBar, guideFor, spokenFor } from './wasteGuide';

describe('the three demonstrated bins', () => {
  it('sends a banana peel to organic', () => {
    const g = guideFor('organic');
    expect(g.destination).toBe('organic');
    expect(g.title).toBe(BINS.organic.title);
    expect(g.separate).toBe(false);
  });

  it('sends a clean accepted plastic bottle to plastic, with preparation', () => {
    const g = guideFor('plastic');
    expect(g.destination).toBe('plastic');
    expect(g.reason).toMatch(/empty and rinse/i);
  });

  it('sends clean newspaper to paper and cardboard', () => {
    const g = guideFor('paper');
    expect(g.destination).toBe('paper');
    expect(g.reason).toMatch(/dry and flat/i);
  });
});

describe('materials that are not one of the three bins', () => {
  it('keeps glass and metal separate, and asks for help when no route is configured', () => {
    const glass = guideFor('glass');
    expect(glass.separate).toBe(true);
    expect(glass.destination).toBe(ROUTES.glass ? 'separate' : 'support');
    if (!ROUTES.glass) expect(glass.reason).toMatch(/not set up here/i);

    const metal = guideFor('metal');
    expect(metal.separate).toBe(true);
    expect(metal.destination).toBe(ROUTES.metal ? 'separate' : 'support');
  });

  it('never sends a textile, a shoe or thermocol into a bin', () => {
    for (const label of ['textile', 'leather', 'footwear', 'thermocol']) {
      const g = guideFor(label);
      expect(g.separate).toBe(true);
      expect(g.destination).toBe('support');
    }
  });
});

describe('sanitary and special-care waste', () => {
  it('gives the exact sanitary instruction for a diaper or a pad', () => {
    for (const label of ['diaper', 'sanitary pad']) {
      const g = guideFor(label);
      expect(g.reason).toBe(WORDS.sanitary);
      expect(g.separate).toBe(true);
      expect(g.tone).toBe('danger');
    }
  });

  it('will not send a syringe to plastic even though it is plastic', () => {
    const g = guideFor('syringe');
    expect(g.destination).not.toBe('plastic');
    expect(g.reason).toBe(WORDS.sharps);
    expect(g.reason).toMatch(/ask an adult or Gram Sahayak/i);
  });

  it('will not send used medical cotton to organic', () => {
    const g = guideFor('medical cotton');
    expect(g.destination).not.toBe('organic');
    expect(g.separate).toBe(true);
  });

  it('keeps batteries and medicine out of the bins, with their own routes', () => {
    for (const label of ['battery', 'ewaste', 'medicine']) {
      const g = guideFor(label);
      expect(g.separate).toBe(true);
      expect(g.support).toBe(true);
    }
  });

  it('never recommends burning, flushing or home composting', () => {
    const all = ['diaper', 'sanitary pad', 'syringe', 'battery', 'medicine', 'chemical']
      .map((label) => guideFor(label).reason.toLowerCase())
      .join(' ');
    expect(all).not.toMatch(/burn|flush|home compost/);
  });
});

describe('mixed bags and uncertainty', () => {
  it('gives the exact mixed-bag sentence and never asks a child to open it', () => {
    const g = guideFor('plastic', { mixedBag: true });
    expect(g.reason).toBe(WORDS.mixedBag);
    expect(g.reason).not.toMatch(/open/i);
    expect(g.support).toBe(true);
  });

  it('gives the exact uncertain sentence, and only one destination', () => {
    const g = guideFor('plastic', { uncertain: true });
    expect(g.reason).toBe(WORDS.uncertain);
    expect(g.destination).toBe('support');
    expect(g.separate).toBe(true);
  });

  it('answers a blank or background reading with uncertainty, not a bin', () => {
    for (const label of ['', 'background', '   ']) {
      const g = guideFor(label);
      expect(g.destination).toBe('support');
      expect(g.reason).toBe(WORDS.uncertain);
    }
  });
});

describe('the support role', () => {
  it('names the role our own way, and never invents a phone number', () => {
    const g = guideFor('thermocol');
    expect(g.reason).toContain('Gram Sahayak');
    expect(SUPPORT.desk).toBe('Ask the Gram Sahayak at the demonstration desk.');
    // Blank contact means the card shows the desk sentence instead of a button
    // that cannot work.
    expect(SUPPORT.contact).toBe('');
  });

  it('keeps Lia saying the same thing as the card', () => {
    expect(spokenFor(guideFor('organic'))).toMatch(/organic bin/i);
    expect(spokenFor(guideFor('plastic'))).toMatch(/plastic bin/i);
    expect(spokenFor(guideFor('paper'))).toMatch(/paper and cardboard bin/i);
    expect(spokenFor(guideFor('syringe'))).toMatch(/keep this item separate/i);
  });
});

describe('a bin is held to a higher bar than a referral', () => {
  it('asks more of an answer that would open a bin', () => {
    // The pencil: Metal 0.50 / Plastic 0.53 on a real venue press.  Neither is
    // one of our three bins, and Plastic would have gone in the plastic bin.
    const plastic = guideFor('plastic');
    expect(confidenceBar(0.5, plastic)).toBe(BIN_CONFIDENCE);
    expect(confidenceBar(0.5, guideFor('metal'))).toBe(0.5);
    expect(confidenceBar(0.5, guideFor('syringe'))).toBe(0.5);
  });

  it('never lowers a threshold that is already stricter', () => {
    expect(confidenceBar(0.85, guideFor('plastic'))).toBe(0.85);
  });

  it('keeps every real venue item above the bar', () => {
    // Measured through the app's own route at 224 px.
    const measured: Array<[string, number]> = [
      ['paper', 0.83], ['paper', 0.95], ['glass', 0.95],
      ['plastic', 0.92], ['ewaste', 0.91], ['textile', 0.94],
    ];
    for (const [label, p] of measured) {
      expect(p).toBeGreaterThanOrEqual(confidenceBar(0.5, guideFor(label)));
    }
  });
});

describe('spokenFor speaks the chosen language', () => {
  const plastic = guideFor('plastic');

  it('answers in English by default', () => {
    expect(spokenFor(plastic)).toMatch(/plastic bin/i);
  });

  it('answers in Malayalam when Malayalam is chosen', () => {
    expect(spokenFor(plastic, 'ml')).toMatch(/പ്ലാസ്റ്റിക്/);
    expect(spokenFor(guideFor('medical'), 'ml')).toMatch(/ഗ്രാം സഹായക/);
  });

  it('answers in Hindi when Hindi is chosen', () => {
    expect(spokenFor(plastic, 'hi')).toMatch(/प्लास्टिक/);
  });

  it('falls back to English rather than saying nothing', () => {
    expect(spokenFor(plastic, 'ta')).toMatch(/plastic bin/i);
  });
});
