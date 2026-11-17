import { describe, expect, it } from 'vitest';
import { SILENCE_PEAK, encodeWav, peakLevel } from './audio';

function tone(peak: number, length = 1600): Blob {
  return encodeWav(Float32Array.from({ length }, (_, i) => Math.sin(i / 8) * peak));
}

describe('how loud the recording was', () => {
  it('reports the peak of a WAV this app wrote', async () => {
    expect(await peakLevel(tone(0.4))).toBeCloseTo(0.4, 2);
    expect(await peakLevel(tone(0.4))).toBeGreaterThan(SILENCE_PEAK);
  });

  it('reports silence for a recording that never moved', async () => {
    // What a muted or far-away microphone gives, and what Whisper turned into
    // "ずいら屋子座" for a Malayalam command (2026-11-18).
    const silent = encodeWav(new Float32Array(1600));
    expect(await peakLevel(silent)).toBe(0);
    expect(await peakLevel(silent)).toBeLessThan(SILENCE_PEAK);
  });

  it('cannot judge a blob that is not the WAV it writes', async () => {
    // The fallback path (no AudioContext) sends the raw MediaRecorder blob;
    // refusing that here would be worse than sending it.
    expect(await peakLevel(new Blob(['not a wav at all'], { type: 'audio/webm' }))).toBe(1);
    expect(await peakLevel(new Blob(['short'], { type: 'audio/wav' }))).toBe(1);
  });
});
