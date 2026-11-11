import { describe, expect, it } from 'vitest';
import { createWasteStabilizer, rankPredictions, type Prediction, type StableEvent } from './wasteStabilizer';

const organic = (confidence = 0.9): Prediction[] => [{ label: 'Organic', confidence }];
const background = (): Prediction[] => [{ label: 'Background', confidence: 0.98 }];

function pushFrames(
  stabilizer: ReturnType<typeof createWasteStabilizer>,
  frames: Prediction[][],
  startAt = 0,
  step = 10,
): StableEvent[] {
  const events: StableEvent[] = [];
  frames.forEach((frame, index) => {
    const event = stabilizer.push(frame, startAt + index * step);
    if (event) events.push(event);
  });
  return events;
}

describe('waste stabilizer', () => {
  it('counts repeated frames of one item as one event', () => {
    const stabilizer = createWasteStabilizer({
      threshold: 0.6,
      consecutiveFrames: 3,
      cooldownMs: 5000,
      rearmFrames: 3,
    });
    const events = pushFrames(stabilizer, Array.from({ length: 12 }, () => organic()));
    expect(events).toHaveLength(1);
    expect(events[0].category).toBe('organic');
  });

  it('ignores frames below the confidence threshold', () => {
    const stabilizer = createWasteStabilizer({
      threshold: 0.75,
      consecutiveFrames: 3,
      cooldownMs: 100,
    });
    const events = pushFrames(stabilizer, Array.from({ length: 10 }, () => organic(0.5)));
    expect(events).toHaveLength(0);
  });

  it('requires the background before it can accept a second item', () => {
    const stabilizer = createWasteStabilizer({
      threshold: 0.6,
      consecutiveFrames: 2,
      cooldownMs: 50,
      rearmFrames: 3,
    });
    const first = pushFrames(stabilizer, [organic(), organic()], 0, 10);
    expect(first).toHaveLength(1);

    const stillThere = pushFrames(stabilizer, Array.from({ length: 6 }, () => organic()), 100, 10);
    expect(stillThere).toHaveLength(0);

    const removal = pushFrames(stabilizer, [background(), background(), background()], 200, 10);
    expect(removal).toHaveLength(0);
    expect(stabilizer.snapshot(230).phase).toBe('armed');

    const second = pushFrames(stabilizer, [organic(), organic()], 300, 10);
    expect(second).toHaveLength(1);
  });

  it('blocks a second event until the cooldown has elapsed', () => {
    const stabilizer = createWasteStabilizer({
      threshold: 0.6,
      consecutiveFrames: 2,
      cooldownMs: 5000,
      rearmFrames: 2,
    });
    expect(pushFrames(stabilizer, [organic(), organic()], 0, 10)).toHaveLength(1);

    // Background appears immediately, but the cooldown has not elapsed.
    pushFrames(stabilizer, [background(), background()], 100, 10);
    expect(pushFrames(stabilizer, [organic(), organic()], 200, 10)).toHaveLength(0);

    // After the cooldown, another removal + item can be accepted.
    pushFrames(stabilizer, [background(), background()], 5200, 10);
    expect(pushFrames(stabilizer, [organic(), organic()], 5300, 10)).toHaveLength(1);
  });

  it('re-arms only after the configured number of background frames', () => {
    const stabilizer = createWasteStabilizer({
      threshold: 0.6,
      consecutiveFrames: 2,
      cooldownMs: 10,
      rearmFrames: 4,
    });
    pushFrames(stabilizer, [organic(), organic()], 0, 10);
    pushFrames(stabilizer, [background()], 100, 10);
    expect(stabilizer.snapshot(110).phase).toBe('waiting-removal');
    pushFrames(stabilizer, [background(), background(), background()], 110, 10);
    expect(stabilizer.snapshot(140).phase).toBe('armed');
  });

  it('does not emit when the top two frames disagree', () => {
    const stabilizer = createWasteStabilizer({
      threshold: 0.5,
      consecutiveFrames: 3,
      cooldownMs: 1000,
    });
    const events = pushFrames(stabilizer, [
      [{ label: 'Organic', confidence: 0.9 }],
      [{ label: 'Plastic', confidence: 0.9 }],
      [{ label: 'Organic', confidence: 0.9 }],
      [{ label: 'Plastic', confidence: 0.9 }],
    ]);
    expect(events).toHaveLength(0);
  });
});

describe('rankPredictions', () => {
  it('returns the most likely classes first, whatever order the model used', () => {
    // `@teachablemachine/image` returns every class in metadata order.
    const raw: Prediction[] = [
      { label: 'Organic', confidence: 0.01 },
      { label: 'Plastic', confidence: 0.95 },
      { label: 'Paper', confidence: 0.03 },
      { label: 'Background', confidence: 0.01 },
    ];
    const ranked = rankPredictions(raw, 3);
    expect(ranked.map((row) => row.label)).toEqual(['Plastic', 'Paper', 'Organic']);
    expect(ranked[0].confidence).toBeCloseTo(0.95);
  });

  it('keeps Background when it is the best guess instead of slicing it away', () => {
    const raw: Prediction[] = [
      { label: 'Organic', confidence: 1e-11 },
      { label: 'Plastic', confidence: 1e-22 },
      { label: 'Paper', confidence: 1e-18 },
      { label: 'Background', confidence: 1 },
    ];
    const ranked = rankPredictions(raw, 3);
    expect(ranked[0]).toEqual({ label: 'Background', confidence: 1 });
    expect(ranked).toHaveLength(3);
  });

  it('drops rows without a usable number rather than sorting on NaN', () => {
    const raw = [
      { label: 'Organic', confidence: Number.NaN },
      { label: 'Paper', confidence: 0.4 },
    ] as Prediction[];
    expect(rankPredictions(raw, 3)).toEqual([{ label: 'Paper', confidence: 0.4 }]);
    expect(rankPredictions([], 3)).toEqual([]);
  });
});
