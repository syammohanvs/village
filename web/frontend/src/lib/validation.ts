import type { AppSettings } from '../types';

export function validateSettings(draft: AppSettings): string | null {
  if (!['en', 'ml', 'hi'].includes(draft.language)) {
    return 'Choose English, Malayalam or Hindi.';
  }
  const modelPath = draft.waste_model_path.trim();
  if (!modelPath) {
    return 'Enter the folder that holds the waste model, for example /models/waste/.';
  }
  if (/\s/.test(modelPath)) {
    return 'The waste model path cannot contain spaces.';
  }
  if (!Number.isFinite(draft.waste_confidence) || draft.waste_confidence < 0.3 || draft.waste_confidence > 0.99) {
    return 'Confidence must be between 0.30 and 0.99.';
  }
  if (
    !Number.isInteger(draft.waste_stability_frames) ||
    draft.waste_stability_frames < 2 ||
    draft.waste_stability_frames > 20
  ) {
    return 'Stable frames must be a whole number between 2 and 20.';
  }
  if (
    !Number.isInteger(draft.waste_cooldown_ms) ||
    draft.waste_cooldown_ms < 1000 ||
    draft.waste_cooldown_ms > 60000
  ) {
    return 'Cooldown must be a whole number of milliseconds between 1000 and 60000.';
  }
  return null;
}
