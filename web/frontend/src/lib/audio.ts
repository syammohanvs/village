export const TARGET_SAMPLE_RATE = 16000;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

export function encodeWav(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function downmixToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels <= 1) return buffer.getChannelData(0).slice();
  const length = buffer.length;
  const output = new Float32Array(length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      output[index] += data[index] / channels;
    }
  }
  return output;
}

export function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate = TARGET_SAMPLE_RATE,
): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const lower = Math.floor(position);
    const upper = Math.min(samples.length - 1, lower + 1);
    const weight = position - lower;
    output[index] = samples[lower] * (1 - weight) + samples[upper] * weight;
  }
  return output;
}

async function resampleWithContext(
  samples: Float32Array,
  sampleRate: number,
): Promise<Float32Array> {
  const length = Math.max(1, Math.round((samples.length / sampleRate) * TARGET_SAMPLE_RATE));
  const OfflineCtor =
    typeof OfflineAudioContext !== 'undefined'
      ? OfflineAudioContext
      : (globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext;
  if (!OfflineCtor) return resampleLinear(samples, sampleRate);
  try {
    const context = new OfflineCtor(1, length, TARGET_SAMPLE_RATE);
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0);
    const rendered = await context.startRendering();
    return rendered.getChannelData(0).slice();
  } catch {
    return resampleLinear(samples, sampleRate);
  }
}

/** Decode whatever MediaRecorder produced and re-encode it as 16 kHz mono WAV. */
export async function toWav16k(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtor =
    typeof AudioContext !== 'undefined'
      ? AudioContext
      : (globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
  if (!AudioCtor) return blob;

  const context = new AudioCtor();
  try {
    const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
    const mono = downmixToMono(decoded);
    const resampled = await resampleWithContext(mono, decoded.sampleRate);
    return encodeWav(resampled);
  } finally {
    if (typeof context.close === 'function') {
      void context.close().catch(() => undefined);
    }
  }
}

export function recordingSupported(): boolean {
  return Boolean(
    typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined',
  );
}

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  async start(): Promise<void> {
    if (!recordingSupported()) {
      throw new Error('This browser cannot record audio.');
    }
    if (this.recorder) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    this.stream = stream;
    this.chunks = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.start();
    this.recorder = recorder;
  }

  async stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder) {
      throw new Error('Recording was not started.');
    }
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
    this.recorder = null;
    this.releaseTracks();
    const raw = new Blob(this.chunks, { type: 'audio/webm' });
    this.chunks = [];
    if (raw.size === 0) return raw;
    return toWav16k(raw);
  }

  cancel(): void {
    if (this.recorder) {
      try {
        this.recorder.onstop = null;
        this.recorder.stop();
      } catch {
        /* already stopped */
      }
      this.recorder = null;
    }
    this.chunks = [];
    this.releaseTracks();
  }

  private releaseTracks(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }
}
