export interface Prediction {
  label: string;
  confidence: number;
  /** The material behind a grouped action (e.g. Ewaste for "recycling"). */
  material?: string;
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
  /** The material behind a grouped action, when there is one. */
  material?: string;
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
  threshold: 0.50,
  consecutiveFrames: 2,
  cooldownMs: 3000,
  backgroundClasses: ['background', 'unknown', 'none', 'empty', 'nothing'],
  rearmFrames: 2,
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
  // What was handed to the page last time.  Re-arming used to depend entirely
  // on the model saying "Background", and the hand-trained model now names a
  // material far more often -- so the camera stayed disarmed while the next
  // item was already being held up.  A different stable label means the
  // previous item has gone.
  let lastLabel: string | null = null;

  const topPrediction = (predictions: Prediction[]): Prediction | null => {
    let top: Prediction | null = null;
    for (const prediction of predictions) {
      if (!prediction || typeof prediction.label !== 'string') continue;
      const confidence = Number(prediction.confidence);
      if (!Number.isFinite(confidence)) continue;
      if (!top || confidence > top.confidence) {
        top = { label: prediction.label, confidence, material: prediction.material };
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

      // Only the item already accepted resets the re-arm counter; a different
      // label is evidence that the camera is looking at something else now.
      if (lastLabel !== null && normalise(top.label) === normalise(lastLabel)) {
        rearmCount = 0;
      }
      window = [...window, top].slice(-config.consecutiveFrames);
      const stable =
        window.length >= config.consecutiveFrames &&
        window.every((frame) => normalise(frame.label) === normalise(top.label));

      if (!stable) return null;
      if (!armed) {
        // A *stable* label that is not the one just accepted means the visitor
        // has put that item down and is showing another.  Waiting for a
        // "Background" frame instead left the camera dead whenever the model
        // named the room's contents, which the hand-trained model does.
        //
        // `consecutiveFrames` is the hysteresis here: a single frame that
        // disagrees is a flicker, not a new item, so this cannot double-count
        // one object read under two names.
        const different = lastLabel !== null && normalise(top.label) !== normalise(lastLabel);
        if (different) {
          armed = true;
          rearmCount = 0;
        }
        return null;
      }
      if (now - lastEmit < config.cooldownMs) return null;

      armed = false;
      rearmCount = 0;
      lastEmit = now;
      const material = top.material ?? top.label;
      lastLabel = material;
      return {
        label: material,
        category: normalise(material),
        confidence: top.confidence,
        at: now,
        material: top.material,
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
      lastLabel = null;
    },
  };
}
