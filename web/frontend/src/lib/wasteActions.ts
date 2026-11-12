import type { Prediction } from './wasteStabilizer';

/**
 * The seven recycler materials all lead to one outcome: hand the item to the
 * recycling agent.  A classifier that splits its confidence between Ewaste and
 * Metal is not uncertain about the *action*; it is uncertain about the label.
 * Grouping the probabilities by action lets the page accept an item whose
 * recycler materials together clear the threshold while no single material
 * does.
 */

export type WasteAction = 'organic' | 'plastic' | 'paper' | 'recycling' | 'background';

export const RECYCLING_LABELS = [
  'Glass',
  'Metal',
  'Textile',
  'Leather',
  'Footwear',
  'Thermocol',
  'Ewaste',
] as const;

const RECYCLING = new Set(RECYCLING_LABELS.map((label) => label.toLowerCase()));

export function actionOf(label: string): WasteAction | null {
  const value = label.trim().toLowerCase();
  if (value === 'organic') return 'organic';
  if (value === 'plastic') return 'plastic';
  if (value === 'paper') return 'paper';
  if (value === 'background' || value === 'unknown' || value === 'none') return 'background';
  return RECYCLING.has(value) ? 'recycling' : null;
}

/**
 * Collapse a full prediction list into the outcome that matters.
 *
 * The returned prediction is what the stabilizer should see: `label` is the
 * action (so a recycler material flipping between Ewaste and Metal does not
 * break the stable streak) and `material` is the top material inside that
 * action (what the page names).  Bin actions keep their class label.
 */
export function groupedPrediction(predictions: Prediction[]): Prediction | null {
  if (predictions.length === 0) return null;
  let topOverall: Prediction | null = null;
  const totals = new Map<WasteAction, number>();
  const best = new Map<WasteAction, Prediction>();
  for (const prediction of predictions) {
    if (!prediction || typeof prediction.label !== 'string') continue;
    const confidence = Number(prediction.confidence);
    if (!Number.isFinite(confidence) || confidence < 0) continue;
    if (!topOverall || confidence > topOverall.confidence) topOverall = prediction;
    const action = actionOf(prediction.label);
    if (!action) continue;
    totals.set(action, (totals.get(action) ?? 0) + confidence);
    const current = best.get(action);
    if (!current || confidence > current.confidence) best.set(action, prediction);
  }
  if (!topOverall) return null;
  // A class this build does not know (for example a site-specific Medical
  // label) still has to reach the page as itself.  Grouping only applies to
  // the known waste actions.
  if (!actionOf(topOverall.label)) {
    return { label: topOverall.label, confidence: Math.min(1, topOverall.confidence) };
  }
  if (totals.size === 0) return null;
  const [action, confidence] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
  const top = best.get(action);
  if (!top) return null;
  if (action === 'recycling') {
    return {
      label: 'recycling',
      confidence: Math.min(1, confidence),
      material: top.label,
    };
  }
  return { label: top.label, confidence: Math.min(1, top.confidence) };
}
