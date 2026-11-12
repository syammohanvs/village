import { describe, expect, it } from 'vitest';
import { actionOf, groupedPrediction } from './wasteActions';

describe('waste actions', () => {
  it('maps the recycler materials to one action', () => {
    for (const label of ['Glass', 'Metal', 'Textile', 'Leather', 'Footwear', 'Thermocol', 'Ewaste']) {
      expect(actionOf(label)).toBe('recycling');
    }
    expect(actionOf('Plastic')).toBe('plastic');
    expect(actionOf('Paper')).toBe('paper');
    expect(actionOf('Organic')).toBe('organic');
    expect(actionOf('Background')).toBe('background');
    expect(actionOf('nonsense')).toBeNull();
  });

  it('adds split recycler probabilities into one outcome', () => {
    const grouped = groupedPrediction([
      { label: 'Ewaste', confidence: 0.45 },
      { label: 'Metal', confidence: 0.35 },
      { label: 'Plastic', confidence: 0.1 },
    ]);
    expect(grouped).toEqual({ label: 'recycling', confidence: 0.8, material: 'Ewaste' });
  });

  it('keeps the strongest material inside the recycling action', () => {
    const grouped = groupedPrediction([
      { label: 'Metal', confidence: 0.4 },
      { label: 'Ewaste', confidence: 0.35 },
    ]);
    expect(grouped?.material).toBe('Metal');
    expect(grouped?.confidence).toBeCloseTo(0.75, 10);
  });

  it('does not turn a plastic majority into a recycler', () => {
    const grouped = groupedPrediction([
      { label: 'Plastic', confidence: 0.6 },
      { label: 'Ewaste', confidence: 0.2 },
      { label: 'Metal', confidence: 0.1 },
    ]);
    expect(grouped).toEqual({ label: 'Plastic', confidence: 0.6 });
  });

  it('reports background and keeps an unknown top class as itself', () => {
    expect(groupedPrediction([{ label: 'Background', confidence: 0.9 }])).toEqual({
      label: 'Background',
      confidence: 0.9,
    });
    expect(groupedPrediction([])).toBeNull();
    // A site-specific class (for example Medical) is not part of the waste
    // actions, so it must still reach the page unchanged.
    expect(groupedPrediction([{ label: 'Medical', confidence: 0.9 }])).toEqual({
      label: 'Medical',
      confidence: 0.9,
    });
    expect(
      groupedPrediction([
        { label: 'Plastic', confidence: 0.6 },
        { label: 'Medical', confidence: 0.2 },
        { label: 'Ewaste', confidence: 0.1 },
      ]),
    ).toEqual({ label: 'Plastic', confidence: 0.6 });
  });
});
