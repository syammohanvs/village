export interface Prediction {
  label: string;
  confidence: number;
}

export interface StabilizerOptions {
  /** Minimum confidence for a frame to count. */
  threshold?: number;
  /** How many consecutive agreeing frames count as stable. */
  consecutiveFrames?: number;
  /** Minimum time between accepted recognition events. */
  cooldownMs?: number;
  /** Labels that mean "nothing in front of the camera" and re-arm the detector. */
  backgroundClasses?: string[];
  /** Background frames required before a second item can be recognised. */
  rearmFrames?: number;
}

export interface StableEvent {
  label: string;
  category: string;
  confidence: number;
  at: number;
}

export type StabilizerPhase = 'armed' | 'waiting-removal';

export interface StabilizerSnapshot {
  phase: StabilizerPhase;
  stable: boolean;
  streakLength: number;
  streakLabel: string | null;
  rearmCount: number;
  cooldownRemainingMs: number;
}

const DEFAULTS: Required<StabilizerOptions> = {
  threshold: 0.62,
  consecutiveFrames: 4,
  cooldownMs: 8000,
  backgroundClasses: ['background', 'unknown', 'none', 'empty', 'nothing'],
  rearmFrames: 4,
};

function normalise(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * Sort a classifier's full output by confidence and keep the best few.
 *
 * `@teachablemachine/image`'s `predict()` returns every class in the order the
 * metadata lists them, not the top N.  Slicing that array would drop whichever
 * class happens to be last (Background), and taking index 0 as "the" answer
 * would always name the first label.  Every caller goes through this helper so
 * the UI, the stabilizer and the tests agree on what the best guess is.
 */
export function rankPredictions(predictions: Prediction[], limit = 3): Prediction[] {
  return predictions
    .filter((row) => row && typeof row.label === 'string' && Number.isFinite(Number(row.confidence)))
    .map((row) => ({ label: row.label, confidence: Number(row.confidence) }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.max(0, limit));
}

export interface WasteStabilizer {
  push(predictions: Prediction[], now?: number): StableEvent | null;
  snapshot(now?: number): StabilizerSnapshot;
  reset(): void;
}

export function createWasteStabilizer(options: StabilizerOptions = {}): WasteStabilizer {
  const config = { ...DEFAULTS, ...options };
  const backgrounds = new Set(config.backgroundClasses.map(normalise));

  let window: Prediction[] = [];
  let armed = true;
  let rearmCount = 0;
  let lastEmit = Number.NEGATIVE_INFINITY;

  const topPrediction = (predictions: Prediction[]): Prediction | null => {
    let top: Prediction | null = null;
    for (const prediction of predictions) {
      if (!prediction || typeof prediction.label !== 'string') continue;
      const confidence = Number(prediction.confidence);
      if (!Number.isFinite(confidence)) continue;
      if (!top || confidence > top.confidence) {
        top = { label: prediction.label, confidence };
      }
    }
    return top;
  };

  return {
    push(predictions, now = Date.now()) {
      const top = topPrediction(predictions);
      const isBackground =
        !top || top.confidence < config.threshold || backgrounds.has(normalise(top.label));

      if (isBackground) {
        window = [];
        if (!armed) {
          rearmCount = Math.min(config.rearmFrames, rearmCount + 1);
          if (rearmCount >= config.rearmFrames && now - lastEmit >= config.cooldownMs) {
            armed = true;
            rearmCount = 0;
          }
        }
        return null;
      }

      rearmCount = 0;
      window = [...window, top].slice(-config.consecutiveFrames);
      const stable =
        window.length >= config.consecutiveFrames &&
        window.every((frame) => normalise(frame.label) === normalise(top.label));

      if (!stable) return null;
      if (!armed) return null;
      if (now - lastEmit < config.cooldownMs) return null;

      armed = false;
      rearmCount = 0;
      lastEmit = now;
      return {
        label: top.label,
        category: normalise(top.label),
        confidence: top.confidence,
        at: now,
      };
    },

    snapshot(now = Date.now()) {
      const label = window.length > 0 ? window[window.length - 1].label : null;
      const stable =
        window.length >= config.consecutiveFrames &&
        label !== null &&
        window.every((frame) => normalise(frame.label) === normalise(label));
      return {
        phase: armed ? 'armed' : 'waiting-removal',
        stable,
        streakLength: window.length,
        streakLabel: label,
        rearmCount,
        cooldownRemainingMs: Math.max(0, config.cooldownMs - (now - lastEmit)),
      };
    },

    reset() {
      window = [];
      armed = true;
      rearmCount = 0;
      lastEmit = Number.NEGATIVE_INFINITY;
    },
  };
}
