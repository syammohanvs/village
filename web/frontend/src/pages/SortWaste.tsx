import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { cx } from '../lib/format';
import { useApi } from '../lib/useApi';
import {
  averageFrames,
  createWasteStabilizer,
  rankPredictions,
  type Prediction,
  type StabilizerSnapshot,
  type StableEvent,
} from '../lib/wasteStabilizer';
import { Card, Notice } from '../components/ui';
import { IconCamera, IconCheck, IconInfo, IconRefresh, IconStop } from '../components/Icons';
import { centreCrop, cropGuide, objectMask, scaleBox, sceneState, type FocusRegion } from '../lib/focus';
import {
  SCENE_WARMUP_FRAMES,
  createSceneMemory,
  learnScene,
  noteScene,
  resetScene,
  sceneReady,
} from '../lib/sceneMemory';
import { groupedPrediction } from '../lib/wasteActions';
import { speakText } from '../lib/speech';
import { useVoiceUi } from '../lib/voiceUi';
import { WasteWelcome } from '../components/WasteWelcome';
import {
  clearBackgrounds as clearStoredBackgrounds,
  loadBackgrounds,
  saveBackgrounds,
  MAX_BACKGROUNDS,
  type BackgroundFrame,
} from '../lib/backgroundStore';
import type { WasteRecognitionResult } from '../types';

interface Classifier {
  // The second argument is `flipped`, not a result count: predict() returns
  // every class in metadata order.  Passing a number here mirrored the frame.
  predict(
    input: HTMLVideoElement | HTMLCanvasElement,
    flipped?: boolean,
  ): Promise<{ className: string; probability: number }[]>;
}

/**
 * What the camera loop got for this frame.
 *
 * `empty` and `unmatched` are two different facts and must not share an answer:
 * an empty table is “Not a waste item”, while a background that no longer
 * describes the table is something the operator has to fix — and the item in
 * front of the camera still has to be classified.
 */
type FocusOutcome =
  | { kind: 'empty' }
  | { kind: 'warming'; progress: number }
  | { kind: 'whole'; input: HTMLVideoElement; warning?: string }
  | { kind: 'object'; input: HTMLCanvasElement; region: FocusRegion };

const ANALYSIS_WIDTH = 160;
const ANALYSIS_HEIGHT = 120;
const CROP_SIZE = 224;
/**
 * How much of the frame a press reads, and how many times.
 *
 * A press used to read the middle 80% of the picture, once.  Both halves were
 * measured on the venue's own captures and on the hand-held set:
 *
 *   - **0.7, not 0.8.**  On the 528 hand-held composites a tighter crop is worth
 *     a lot (61.1% exact / 75.9% item action at 0.7 against 56.8 / 71.6 at 0.8),
 *     because the ring a looser crop keeps is the room, the curtain and the edge
 *     of a face.  The brown paper cover that was reported as "textile" is the
 *     case in point: cropped to 0.7 of the frame it reads Paper 0.76, and the
 *     second frame of the same cover reads Paper 0.83 instead of Thermocol.
 *     Honest cost: close-up product photographs lose about six points (65.9 to
 *     59.3 exact on the real-world probe) because the crop starts cutting the
 *     object itself.  At the venue the object is held, not filling the frame.
 *   - **three frames, not one.**  66% of the captured bursts disagree with
 *     themselves, and one brown cover was Thermocol 0.91, Thermocol 0.60 and
 *     Textile 0.70 inside ten seconds.  Three readings a quarter of a second
 *     apart, averaged, are one reading of the same held-up object.
 */
const PRESS_CROP_SHARE = 0.7;
const PRESS_FRAMES = 3;
const PRESS_FRAME_GAP_MS = 250;

function ensureCanvas(ref: { current: HTMLCanvasElement | null }, width: number, height: number) {
  if (!ref.current) ref.current = document.createElement('canvas');
  const canvas = ref.current;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas;
}

type ModelState = 'idle' | 'loading' | 'ready' | 'error';

const DEFAULT_PATH = '/models/waste/';

function modelBase(path: string | undefined): string {
  const base = (path || DEFAULT_PATH).trim();
  return base.endsWith('/') ? base : `${base}/`;
}

function modelInstalled(status: { installed?: boolean; available?: boolean; present?: boolean } | null): boolean {
  return Boolean(status?.installed ?? status?.available ?? status?.present);
}

function capitalise(value: string): string {
  return value.replace(/^\w/, (c) => c.toUpperCase());
}

// The model's last class is the "nothing to sort" side of the camera: the empty
// table, the room, and ordinary objects (a car key, a phone, a wallet) that are
// not waste.  "Background" is the engineering name; the operator needs the
// plain-English one.
function displayLabel(label: string): string {
  return label.trim().toLowerCase() === 'background' ? 'Not a waste item' : label;
}

// The model names the recycler material so it can learn each one, but the app
// has one outcome for all of them: hand it to the recycling agent.  Anything
// in this set is posted to the backend as category "other" and lights no LED.
const RECYCLING_NAMES: Record<string, string> = {
  glass: 'Glass',
  metal: 'Metal',
  textile: 'Cloth or textile',
  leather: 'Leather',
  footwear: 'Footwear',
  thermocol: 'Thermocol',
  ewaste: 'Electronic waste',
};

const HAZARDOUS_NAMES: Record<string, string> = {
  medical: 'Medical waste',
  hazardous: 'Hazardous waste',
};

function recyclingMaterial(label: string): string | null {
  return RECYCLING_NAMES[label.trim().toLowerCase()] ?? null;
}

function hazardousMaterial(label: string): string | null {
  return HAZARDOUS_NAMES[label.trim().toLowerCase()] ?? null;
}

export function SortWaste() {
  const settings = useApi(['settings'], () => api.settings(), {});
  const modelStatus = useApi(['waste-resnet'], () => api.wasteResnetStatus(), {});

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [modelState, setModelState] = useState<ModelState>('idle');
  const [modelError, setModelError] = useState('');
  // The room, learned from the live stream when no backdrop was set.
  const sceneRef = useRef(createSceneMemory(ANALYSIS_WIDTH, ANALYSIS_HEIGHT));
  // Off by default.  An automatic watcher in a room with a person in it decides
  // for itself what is "being shown", and at the venue that decision was wrong
  // often enough to classify a hand, a wall and an empty frame.  A press cannot
  // be wrong about that, so the press is the default and the watcher is opt-in.
  const [autoWatch, setAutoWatch] = useState(false);
  const [warming, setWarming] = useState(false);
  // 0..1 while the room is being learned, null once the camera is ready.  Shown
  // as a badge on the preview: without it the visitor cannot tell whether the
  // page is ready for an item or still watching the room.
  const [sceneProgress, setSceneProgress] = useState<number | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  // The loop runs on an interval, and `accept` is a callback whose identity must
  // not change per frame, so it read a stale empty list -- which is why every
  // recorded event said `top: []`.  A ref is the frame's guesses as of now.
  const predictionsRef = useRef<Prediction[]>([]);
  const { language: voiceLanguage } = useVoiceUi();
  const [stability, setStability] = useState<StabilizerSnapshot | null>(null);
  const [recognition, setRecognition] = useState<WasteRecognitionResult | null>(null);
  const [referralLabel, setReferralLabel] = useState<string | null>(null);
  const [hazardousLabel, setHazardousLabel] = useState<string | null>(null);
  const [recognitionError, setRecognitionError] = useState('');
  const [alert, setAlert] = useState('');
  const [note, setNote] = useState('');
  const [disposalMessage, setDisposalMessage] = useState('');
  const [disposalError, setDisposalError] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const classifierRef = useRef<Classifier | null>(null);
  const stabilizerRef = useRef(createWasteStabilizer());
  const busyRef = useRef(false);
  const acceptingRef = useRef(false);
  const backgroundRef = useRef<BackgroundFrame[]>([]);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [backgroundCount, setBackgroundCount] = useState(0);
  // A press reads three frames now, so it takes about a second.  The button
  // says so instead of looking like it did nothing.
  const [reading, setReading] = useState(false);
  // The camera's own shape, so the frame shows the WHOLE picture.  A fixed 4:3
  // box with `object-fit: cover` silently hid the left and right edges of a
  // 16:9 camera, so an item could be in shot and not on screen -- and the read
  // did not match what the operator could see.
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  const [groupedTop, setGroupedTop] = useState<Prediction | null>(null);
  const [frameWarning, setFrameWarning] = useState('');
  const [backgroundReady, setBackgroundReady] = useState(false);
  const [focusOn, setFocusOn] = useState(true);
  const [focusNote, setFocusNote] = useState('');

  const installed = modelInstalled(modelStatus.data);
  // Three different facts: the browser can open a camera, the model status is
  // known, and the model is installed.  Collapsing them into one boolean is
  // what produced "the camera can still be used" next to a disabled button.
  const cameraSupported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getUserMedia === 'function';
  const modelKnown = !modelStatus.loading && !modelStatus.error;
  const previewOnly = !installed;
  const base = modelBase(settings.data?.waste_model_path);
  const confidence = settings.data?.waste_confidence ?? 0.50;
  const stabilityFrames = settings.data?.waste_stability_frames ?? 2;
  const cooldownMs = settings.data?.waste_cooldown_ms ?? 3000;

  // With focus on, the release signal is the item leaving the frame (an empty
  // scene, decided by geometry now that the room is learned), so a timer would
  // only add dead time between items.  It is kept for the unfocused mode, where
  // every frame is classified blindly and only a clock prevents duplicates.
  const effectiveCooldown = focusOn ? 0 : cooldownMs;

  useEffect(() => {
    stabilizerRef.current = createWasteStabilizer({
      threshold: confidence,
      consecutiveFrames: stabilityFrames,
      // With a stored background, the empty-scene frames are the duplicate
      // guard: an item still in view never produces them.  The time cooldown
      // would otherwise make the operator wait after the item is removed.
      cooldownMs: effectiveCooldown,
    });
  }, [confidence, stabilityFrames, effectiveCooldown]);

  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media || typeof media.enumerateDevices !== 'function') return;
    void media
      .enumerateDevices()
      .then((list) => setDevices(list.filter((device) => device.kind === 'videoinput')))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    const stored = loadBackgrounds(storage);
    if (!stored) return;
    const usable = stored.filter(
      (frame) => frame.width === ANALYSIS_WIDTH && frame.height === ANALYSIS_HEIGHT,
    );
    if (usable.length === 0) return;
    backgroundRef.current = usable;
    setBackgroundCount(usable.length);
    setBackgroundReady(true);
    setFocusNote(
      `${usable.length} background${usable.length === 1 ? '' : 's'} remembered from this device.`,
    );
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setSceneProgress(null);
    setPredictions([]);
    setGroupedTop(null);
    setFrameWarning('');
    stabilizerRef.current.reset();
  }, []);

  // Remember the empty scene once.  Everything that differs from it later is
  // the object, and only that box is handed to the classifier.
  const captureBackground = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      setFocusNote('The camera frame is not ready yet.');
      return false;
    }
    const canvas = ensureCanvas(analysisCanvasRef, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    const context = canvas.getContext('2d');
    if (!context) {
      setFocusNote('This browser cannot read the camera frame, so the whole picture is classified.');
      return false;
    }
    try {
      context.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      const frame = context.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      // Keep the newest three.  Adding a fourth at a hall whose background has
      // changed again should replace the oldest, not lock the operator out.
      const next: BackgroundFrame[] = [
        ...backgroundRef.current,
        { width: ANALYSIS_WIDTH, height: ANALYSIS_HEIGHT, data: frame.data },
      ].slice(-MAX_BACKGROUNDS);
      backgroundRef.current = next;
      let storage: Storage | null = null;
      try {
        storage = window.localStorage;
      } catch {
        storage = null;
      }
      const saved = saveBackgrounds(storage, next);
      setBackgroundCount(next.length);
      setBackgroundReady(true);
      setFocusNote(
        saved
          ? `Background ${next.length} of ${MAX_BACKGROUNDS} stored on this device. Show one item; only the object is classified.`
          : `Background ${next.length} of ${MAX_BACKGROUNDS} captured, but this browser could not store it.`,
      );
      return true;
    } catch {
      setFocusNote('The camera frame could not be read. Press Set background again.');
      return false;
    }
  }, []);

  const clearBackgrounds = useCallback(() => {
    backgroundRef.current = [];
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    clearStoredBackgrounds(storage);
    setBackgroundCount(0);
    setBackgroundReady(false);
    setFocusNote('Backgrounds cleared. Every frame is classified now — hold an item up to the camera.');
    stabilizerRef.current.reset();
  }, []);

  const focusInput = useCallback(
    (video: HTMLVideoElement): FocusOutcome | null => {
      if (!focusOn) return { kind: 'whole', input: video };

      const analysis = ensureCanvas(analysisCanvasRef, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      const context = analysis.getContext('2d');
      if (!context) return { kind: 'whole', input: video };
      let frame: ImageData;
      try {
        context.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
        frame = context.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      } catch {
        return { kind: 'whole', input: video };
      }

      // What to compare against.  A backdrop the operator set is used when there
      // is one; otherwise the room is learned from the live stream, so the venue
      // never has to clear a table it does not have.  Either way the comparison
      // below is the same code -- the learned room is simply a background that
      // maintains itself.
      const stored = backgroundRef.current;
      const learning = stored.length === 0;
      const sceneFrames: Uint8ClampedArray[] = stored.map((background) => background.data);
      if (learning) {
        const memory = sceneRef.current;
        if (!sceneReady(memory)) {
          // The first frames ARE the room: fold them in outright rather than
          // diffing against an empty buffer.
          learnScene(memory, frame.data, { alpha: memory.frames === 0 ? 1 : 0.25 });
          return { kind: 'warming', progress: Math.min(1, memory.frames / SCENE_WARMUP_FRAMES) };
        }
        sceneFrames.push(memory.background);
      }
      const state = sceneState(
        sceneFrames,
        frame.data,
        ANALYSIS_WIDTH,
        ANALYSIS_HEIGHT,
      );
      if (state.kind === 'empty') {
        // Nothing being shown: this frame IS the room, so let the memory drift
        // towards it (a door opening, the lights changing).
        if (learning) {
          noteScene(sceneRef.current, 'empty', Date.now());
          learnScene(sceneRef.current, frame.data);
        }
        return { kind: 'empty' };
      }
      if (state.kind === 'unmatched') {
        // Everything differs.  With a stored backdrop that means the camera was
        // nudged; with a learned one it means the same, and the cure is to learn
        // the room again rather than to classify a picture of a moved camera.
        if (learning) {
          // The whole view changed: a moved camera, not an item.  Start again.
          resetScene(sceneRef.current);
          learnScene(sceneRef.current, frame.data, { alpha: 1 });
          return {
            kind: 'warming',
            progress: Math.min(1, sceneRef.current.frames / SCENE_WARMUP_FRAMES),
          };
        }
        return {
          kind: 'whole',
          input: video,
          warning:
            'The stored background no longer matches this view. Press Set background again on the empty table, or press Clear backgrounds and show the item in your hand instead.',
        };
      }
      // Something is being shown.
      //
      // Two failures came out of freezing here unconditionally. If the reference
      // had captured the item (somebody was already holding it when the room was
      // learned), then taking it away never returns to "empty" and the camera
      // deadlocks -- reported as "it did not re-arm even after I moved the item
      // away and back". And an item held very still was either absorbed or
      // frozen out for ever, with no way back.
      //
      // So: freeze while this is plausibly an item, and if the same thing has
      // been "shown" for four seconds, take the frame as the new room and start
      // again. That is self-healing in both directions, and the camera can never
      // be permanently stuck.
      if (learning) {
        const stale = noteScene(sceneRef.current, 'object', Date.now());
        if (stale) {
          resetScene(sceneRef.current);
          learnScene(sceneRef.current, frame.data, { alpha: 1 });
          return {
            kind: 'warming',
            progress: Math.min(1, sceneRef.current.frames / SCENE_WARMUP_FRAMES),
          };
        }
        learnScene(sceneRef.current, frame.data, { frozen: true });
      }
      const region = state.region;
      const videoWidth = video.videoWidth || ANALYSIS_WIDTH;
      const videoHeight = video.videoHeight || ANALYSIS_HEIGHT;
      const source = scaleBox(region.box, ANALYSIS_WIDTH, ANALYSIS_HEIGHT, videoWidth, videoHeight);
      const crop = ensureCanvas(cropCanvasRef, CROP_SIZE, CROP_SIZE);
      const cropContext = crop.getContext('2d');
      if (!cropContext) return { kind: 'whole', input: video };
      try {
        cropContext.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
        // Background is painted out, not merely cropped away.  A pixel inside the
        // square that still matches the stored empty scene is the table, the
        // room or the space beside the item, so it is replaced with a plain
        // plate and the classifier sees the object on its own.  Measured on 217
        // scenes: item-level accuracy 32.9% (crop only) -> about 60% (crop + this).
        const mask = objectMask(
          sceneFrames,
          frame.data,
          ANALYSIS_WIDTH,
          ANALYSIS_HEIGHT,
          region.box,
        );
        if (mask) {
          const maskCanvas = ensureCanvas(maskCanvasRef, mask.width, mask.height);
          const maskContext = maskCanvas.getContext('2d');
          if (maskContext) {
            const painted = maskContext.createImageData(mask.width, mask.height);
            painted.data.set(mask.data);
            maskContext.putImageData(painted, 0, 0);
            cropContext.drawImage(
              video,
              source.x,
              source.y,
              source.width,
              source.height,
              0,
              0,
              CROP_SIZE,
              CROP_SIZE,
            );
            // Keep only what the mask covers, then put a white plate behind it so
            // the model never sees transparency.
            cropContext.globalCompositeOperation = 'destination-in';
            cropContext.drawImage(maskCanvas, 0, 0, mask.width, mask.height, 0, 0, CROP_SIZE, CROP_SIZE);
            cropContext.globalCompositeOperation = 'destination-over';
            cropContext.fillStyle = '#ffffff';
            cropContext.fillRect(0, 0, CROP_SIZE, CROP_SIZE);
          } else {
            return { kind: 'whole', input: video };
          }
        } else {
          // No usable mask: the plain crop, exactly as before.
          cropContext.drawImage(
            video,
            source.x,
            source.y,
            source.width,
            source.height,
            0,
            0,
            CROP_SIZE,
            CROP_SIZE,
          );
        }
        cropContext.globalCompositeOperation = 'source-over';
      } catch {
        return { kind: 'whole', input: video };
      }
      return { kind: 'object', input: crop, region };
    },
    [focusOn],
  );

  // Syringes, cotton, napkins, diapers, urine bags and catheters are hazardous
  // waste, not one of the three bins.  The camera cannot reliably tell a
  // syringe from a plastic tube, so this is an explicit operator decision
  // rather than a guess: it records the item as "medical", lights no bin LED
  // and stops the camera.
  const recordHazardous = useCallback(async () => {
    if (acceptingRef.current) return;
    acceptingRef.current = true;
    setRecognitionError('');
    setDisposalMessage('');
    setDisposalError('');
    setNote('');
    setReferralLabel(null);
    setHazardousLabel('Medical waste');
    stopCamera();
    try {
      const result = await api.postRecognition({
        category: 'medical',
        confidence: 1,
        model: 'manual',
        requestId: api.newRequestId(),
      });
      setRecognition(result);
    } catch (cause) {
      setRecognitionError(errorMessage(cause));
    } finally {
      acceptingRef.current = false;
    }
  }, [stopCamera]);

  const loadModel = useCallback(async () => {
    if (!installed || modelState === 'loading' || modelState === 'ready') return;
    setModelState('loading');
    setModelError('');
    try {
      const status = await api.wasteResnetStatus();
      if (!status.installed) {
        throw new Error('the ResNet50 model is not installed on the backend');
      }
      // The classifier is now a thin adapter: the frame is sent to the
      // backend, which runs ResNet50 on the laptop's CPU.
      classifierRef.current = {
        async predict(input) {
          const canvas = document.createElement('canvas');
          canvas.width = CROP_SIZE;
          canvas.height = CROP_SIZE;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('this browser cannot read a canvas');
          ctx.drawImage(input, 0, 0, CROP_SIZE, CROP_SIZE);
          // Quality is an accuracy knob, not just a payload one.  Measured on
          // the same three sets through this exact path: 0.92 scores 50.0 /
          // 70.1 / 87.7% exact against 44.9 / 68.9 / 85.9% at 0.85, and 1.0 is
          // no better than 0.92 while being several times larger.  A frame is
          // a few kilobytes either way.
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          const result = await api.wasteClassify(dataUrl);
          return result.predictions;
        },
      };
      setModelState('ready');
      stabilizerRef.current.reset();
    } catch (cause) {
      classifierRef.current = null;
      setModelState('error');
      setModelError(
        `The ResNet50 model could not be loaded. ${errorMessage(cause)} A presenter can check the backend.`,
      );
    }
  }, [installed, modelState]);

  const startCamera = async () => {
    setCameraError('');
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setCameraError('This browser cannot open a camera here.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
          : { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraOn(true);
      // A one-press reading crops the middle of the picture and needs no room
      // learned, so only the watcher starts a warm-up. Showing "learning the
      // room 0%" beside a page that will never learn one was a lie.
      setSceneProgress(autoWatch ? 0 : null);
      setGroupedTop(null);
      setFrameWarning('');
      const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      setDevices(list.filter((device) => device.kind === 'videoinput'));
      if (installed) void loadModel();
    } catch (cause) {
      setCameraError(
        cause instanceof Error ? `The camera could not start: ${cause.message}` : 'The camera could not start.',
      );
    }
  };

  const accept = useCallback(async (event: StableEvent) => {
    if (acceptingRef.current) return;
    acceptingRef.current = true;
    setRecognitionError('');
    setDisposalMessage('');
    setDisposalError('');
    setNote('');
    const material = recyclingMaterial(event.category);
    const hazardous = hazardousMaterial(event.category);
    setReferralLabel(material);
    setHazardousLabel(hazardous);

    // Sara speaks from what was just decided, not from the reply.  Waiting for
    // the recording held her sentence for as long as the round trip took --
    // measured at 19-21 s with the controller switched off, because the record
    // asked the board for its fill levels.  The sentence is already known here:
    // a bin name for the three bins, a referral for anything else.
    const spoken =
      hazardous
        ? 'Hazardous waste. Do not put it in the bins. Hand it to the operator.'
        : material
          ? `Classified as ${event.label || event.category}. Please contact the operator.`
          : `Classified as ${event.category}. Put it in the ${event.category} bin.`;
    void speakText(spoken, voiceLanguage, 0.95);

    try {
      const result = await api.postRecognition({
        // One referral category for every recycler material and one for
        // hazardous material, so the backend records one outcome and never sends
        // a bin command for either.
        category: material ? 'other' : hazardous ? 'medical' : event.category,
        confidence: event.confidence,
        model: 'teachable-machine',
        // Keep what was actually named: "other" alone cannot answer "what did
        // it call my key fob?" when the session is reviewed afterwards.
        material: event.label || event.category,
        top: predictionsRef.current.map((row) => ({
          className: row.label,
          probability: row.confidence,
        })),
      });
      setRecognition(result);
      const binState = result.bin?.state;
      setAlert(
        result.alert ??
          (binState === 'full'
            ? `The ${event.category} bin is reported full. Empty it before the next item.`
            : binState === 'nearly_full'
              ? `The ${event.category} bin is nearly full.`
              : ''),
      );
    } catch (cause) {
      setRecognitionError(errorMessage(cause));
    } finally {
      acceptingRef.current = false;
      // The camera deliberately stays on.  The stabilizer waits for the item to
      // be removed and then re-arms, so the next item is classified without
      // pressing Start Camera again.
    }
  }, []);

  /**
   * Classify once, on demand.
   *
   * The automatic path decides for itself what is being shown, and in a room
   * with a person in it that decision is wrong often enough to be worse than
   * useless: reported as "it classified as thermocol" with nothing in hand. A
   * press cannot be wrong about whether an item is being shown, because the
   * person pressing it knows.
   *
   * It crops the middle of the picture — where an item held up to the camera
   * sits — and classifies that, with no reference to the room at all.
   */
  const classifyNow = useCallback(async () => {
    const video = videoRef.current;
    const classifier = classifierRef.current;
    if (!video || !classifier || busyRef.current || video.readyState < 2) return;
    busyRef.current = true;
    setReading(true);
    setFrameWarning('');
    setRecognition(null);
    setReferralLabel(null);
    setHazardousLabel(null);
    try {
      const analysis = ensureCanvas(analysisCanvasRef, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      const analysisContext = analysis.getContext('2d');
      const crop = ensureCanvas(cropCanvasRef, CROP_SIZE, CROP_SIZE);
      const cropContext = crop.getContext('2d');
      if (!analysisContext || !cropContext) return;

      // A stored backdrop is still worth subtracting -- it is the booth case and
      // it is not what fails here.
      let backgrounds: Uint8ClampedArray[] = backgroundRef.current.map((f) => f.data);
      if (backgrounds.length === 0) {
        const memory = sceneRef.current;
        if (sceneReady(memory)) backgrounds = [memory.background];
      }

      const box = centreCrop(ANALYSIS_WIDTH, ANALYSIS_HEIGHT, PRESS_CROP_SHARE);
      const videoWidth = video.videoWidth || ANALYSIS_WIDTH;
      const videoHeight = video.videoHeight || ANALYSIS_HEIGHT;
      const source = scaleBox(box, ANALYSIS_WIDTH, ANALYSIS_HEIGHT, videoWidth, videoHeight);

      /** One look at the item: crop the frame now, paint out the room, read it. */
      const readOnce = async (): Promise<Prediction[]> => {
        cropContext.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
        cropContext.drawImage(
          video,
          source.x,
          source.y,
          source.width,
          source.height,
          0,
          0,
          CROP_SIZE,
          CROP_SIZE,
        );

        analysisContext.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
        const frame = analysisContext.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
        const mask =
          backgrounds.length > 0
            ? objectMask(backgrounds, frame.data, ANALYSIS_WIDTH, ANALYSIS_HEIGHT, box)
            : null;
        if (mask) {
          const maskCanvas = ensureCanvas(maskCanvasRef, mask.width, mask.height);
          const maskContext = maskCanvas.getContext('2d');
          if (maskContext) {
            const painted = maskContext.createImageData(mask.width, mask.height);
            painted.data.set(mask.data);
            maskContext.putImageData(painted, 0, 0);
            cropContext.globalCompositeOperation = 'destination-in';
            cropContext.drawImage(maskCanvas, 0, 0, mask.width, mask.height, 0, 0, CROP_SIZE, CROP_SIZE);
            cropContext.globalCompositeOperation = 'destination-over';
            cropContext.fillStyle = '#ffffff';
            cropContext.fillRect(0, 0, CROP_SIZE, CROP_SIZE);
            cropContext.globalCompositeOperation = 'source-over';
          }
        }
        const raw = await classifier.predict(crop);
        return raw.map((row) => ({ label: row.className, confidence: row.probability }));
      };

      // Three looks at what the hand is holding, averaged.  A crop is redrawn
      // for each, so this is a reading of the video rather than of one still.
      const shots: Prediction[][] = [];
      for (let shot = 0; shot < PRESS_FRAMES; shot += 1) {
        if (shot > 0) {
          await new Promise((resolve) => setTimeout(resolve, PRESS_FRAME_GAP_MS));
          if (video.readyState < 2) break;
        }
        shots.push(await readOnce());
      }

      const averaged = averageFrames(shots);
      const all = averaged;
      const grouped = groupedPrediction(all);
      predictionsRef.current = all.slice(0, 3);
      setPredictions(predictionsRef.current);
      setGroupedTop(grouped);
      if (!grouped) return;
      const isBackground = grouped.label.trim().toLowerCase() === 'background';
      if (isBackground) {
        setStability({ ...stabilizerRef.current.snapshot(), stable: true });
        return;
      }
      // The threshold applies here too.  A pressed reading used to skip it, so a
      // three-way tie -- a handkerchief read as Leather 0.24, Paper 0.24,
      // Background 0.22 -- was recorded and lit nothing, as if the model had
      // chosen leather. Under the threshold the page names its best guess and
      // asks for a better look instead.
      if (grouped.confidence < confidence) return;
      const event: StableEvent = {
        label: grouped.material ?? grouped.label,
        category: (grouped.material ?? grouped.label).trim().toLowerCase(),
        confidence: grouped.confidence,
        at: Date.now(),
        material: grouped.material,
      };
      await accept(event);
    } catch (cause) {
      setRecognitionError(errorMessage(cause));
    } finally {
      busyRef.current = false;
      setReading(false);
    }
  }, [accept]);


  // The model is loaded when the page opens rather than when the camera starts,
  // so the start button can stay disabled until the pipeline can actually
  // answer.  Pressing it into a half-ready page is what made "it is learning the
  // room" look like a fault.
  useEffect(() => {
    if (!installed) return;
    if (modelState !== 'idle') return;
    void loadModel();
  }, [installed, modelState, loadModel]);

  useEffect(() => {
    if (!cameraOn || modelState !== 'ready' || !autoWatch) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const video = videoRef.current;
      const classifier = classifierRef.current;
      if (!video || !classifier || busyRef.current || video.readyState < 2) return;
      busyRef.current = true;
      try {
        const focused = focusInput(video);
        if (cancelled) return;
        if (!focused) return;
        if (focused.kind === 'warming') {
          setSceneProgress(focused.progress);
          // The room is being learned.  Nothing is classified yet, on purpose:
          // classifying a room is what named the wall "textile".
          setWarming(true);
          setFrameWarning('');
          const background = [{ label: 'Background', confidence: 1 }];
          setPredictions(background);
          setGroupedTop(background[0]);
          stabilizerRef.current.push(background);
          setStability(stabilizerRef.current.snapshot());
          return;
        }
        if (focused.kind === 'empty') {
          setWarming(false);
          setSceneProgress(null);
          // The empty scene (or a moved camera) is not a classification
          // problem: there is no object to sort.  Say so without asking the
          // model to name a material from the room.
          setFrameWarning('');
          const background = [{ label: 'Background', confidence: 1 }];
          setPredictions(background);
          setGroupedTop(background[0]);
          const event = stabilizerRef.current.push(background);
          setStability(stabilizerRef.current.snapshot());
          if (event) void accept(event);
          return;
        }
        if (focused.kind === 'whole') {
          setWarming(false);
          setSceneProgress(null);
          // Either focus is off, or the stored background no longer matches the
          // view.  The second case used to report “Not a waste item” and never
          // classify anything; now it says what to fix and still answers.
          setFrameWarning(focused.warning ?? '');
          const raw = await classifier.predict(focused.input);
          if (cancelled) return;
          const all = rankPredictions(
            raw.map((row) => ({ label: row.className, confidence: row.probability })),
            raw.length,
          );
          const grouped = groupedPrediction(all);
          predictionsRef.current = all.slice(0, 3);
          setPredictions(predictionsRef.current);
          setGroupedTop(grouped);
          const event = grouped ? stabilizerRef.current.push([grouped]) : null;
          setStability(stabilizerRef.current.snapshot());
          if (event) void accept(event);
          return;
        }
        setWarming(false);
        setSceneProgress(null);
        const { input, region } = focused;
        setFrameWarning(
          region?.edgeTouch && region.coverage > 0.18
            ? 'A hand or person is in the picture. Place the item on the table and step back so the camera sees only the waste.'
            : '',
        );
        const raw = await classifier.predict(input);
        if (cancelled) return;
        const all = rankPredictions(
          raw.map((row) => ({ label: row.className, confidence: row.probability })),
          raw.length,
        );
        const grouped = groupedPrediction(all);
        predictionsRef.current = all.slice(0, 3);
        setPredictions(predictionsRef.current);
        setGroupedTop(grouped);
        const event = grouped ? stabilizerRef.current.push([grouped]) : null;
        setStability(stabilizerRef.current.snapshot());
        if (event) void accept(event);
      } catch {
        if (!cancelled) {
          setPredictions([]);
          setGroupedTop(null);
          setFrameWarning('');
        }
      } finally {
        busyRef.current = false;
      }
    }, 300);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [cameraOn, modelState, autoWatch, accept, focusOn, captureBackground, focusInput]);

  const recognitionId = recognition?.recognition?.id ?? recognition?.recognition_id ?? null;
  const targetCategory =
    recognition?.category ?? recognition?.recognition?.category ?? recognition?.indicator?.category ?? null;

  const confirmDeposit = async () => {
    if (recognitionId === null) return;
    setDisposalError('');
    setDisposalMessage('');
    try {
      await api.postDisposal(recognitionId, note);
      setDisposalMessage('A separate deposit confirmation was recorded.');
    } catch (cause) {
      setDisposalError(errorMessage(cause));
    }
  };

  const top = groupedTop
    ? { label: groupedTop.material ?? groupedTop.label, confidence: groupedTop.confidence }
    : predictions[0];
  const strong = Boolean(
    groupedTop ? groupedTop.confidence >= confidence : top && top.confidence >= confidence,
  );
  const topIsBackground = Boolean(
    groupedTop
      ? groupedTop.label.trim().toLowerCase() === 'background'
      : top && top.label.trim().toLowerCase() === 'background',
  );
  const waitingRemoval = stability?.phase === 'waiting-removal';
  const removing = waitingRemoval && !recognition;

  const resultCategory = targetCategory ? capitalise(String(targetCategory)) : null;
  const referred = Boolean(referralLabel) || String(targetCategory ?? '').toLowerCase() === 'other';
  const hazardous = Boolean(hazardousLabel) || String(targetCategory ?? '').toLowerCase() === 'medical';
  const shownCategory = hazardous
    ? (hazardousLabel ?? 'Hazardous waste')
    : referred
      ? (referralLabel ?? 'Recycling agent')
      : resultCategory;

  return (
    <div className="page sort-waste">
      <WasteWelcome />
      <div className="waste-layout">
        <div className="camera-column">
          <div
            className="camera-frame camera-frame--large"
            style={videoAspect ? { aspectRatio: String(videoAspect) } : undefined}
          >
            <video
              ref={videoRef}
              className="camera-video"
              playsInline
              muted
              aria-label="Waste camera preview"
              onLoadedMetadata={(event) => {
                const { videoWidth, videoHeight } = event.currentTarget;
                if (videoWidth > 0 && videoHeight > 0) setVideoAspect(videoWidth / videoHeight);
              }}
            />
            {/*
              The square that will actually be read.  Drawn, not guessed: the
              same `PRESS_CROP_SHARE` sizes it and the crop, so what the operator
              frames is what the model sees.  Reported three times in a row --
              a bottle held at the edge read as paper, then glass -- because the
              crop took the middle, which was a face.
            */}
            {cameraOn && videoAspect !== null ? (
              (() => {
                const guide = cropGuide(videoAspect, PRESS_CROP_SHARE);
                if (!guide) return null;
                return (
                  <div
                    className="crop-guide"
                    data-testid="crop-guide"
                    style={guide}
                    aria-hidden="true"
                  />
                );
              })()
            ) : null}
            {/*
              The one thing a visitor has to know before showing an item: is the
              page ready?  The result panel below says it in a sentence, but a
              sentence under the picture is read after the item is already in
              the air, which is how "I could not tell whether it had learned the
              background" happened.
            */}
            {cameraOn && (
              <div className="camera-status" data-testid="camera-status">
                {autoWatch && sceneProgress !== null ? (
                  <span className="chip chip--warn">
                    Learning the room · {Math.round(sceneProgress * 100)}%
                  </span>
                ) : autoWatch ? (
                  waitingRemoval ? (
                    <span className="chip chip--neutral">Show the next item</span>
                  ) : (
                    <span className="chip chip--good">Ready — show one item</span>
                  )
                ) : (
                  <span className="chip chip--good">Ready — press “Check the item”</span>
                )}
              </div>
            )}
            {!cameraOn && (
              <div className="camera-placeholder">
                <IconCamera size={34} />
                <p>Start the camera, then show one clean item.</p>
                {cameraError && <p className="error-text">{cameraError}</p>}
              </div>
            )}
          </div>

          <div className="camera-actions">
            {cameraOn ? (
              <button type="button" className="btn btn--danger btn--large" onClick={stopCamera}>
                <IconStop size={18} /> Stop Camera
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary btn--large"
                onClick={() => void startCamera()}
                disabled={!cameraSupported || (installed && modelState !== 'ready')}
                title={
                  !cameraSupported
                    ? 'This browser cannot open a camera in this tab.'
                    : installed && modelState !== 'ready'
                      ? 'The classifier is still loading. The camera opens once it is ready.'
                      : installed
                        ? 'Open the camera preview.'
                        : 'Open the camera preview. Recognition stays off until a model is installed.'
                }
                data-testid="start-camera"
              >
                <IconCamera size={18} />{' '}
                {installed && modelState !== 'ready' ? 'Preparing the model…' : 'Start Camera'}
              </button>
            )}
            {cameraOn && (
              <button
                type="button"
                className="btn btn--primary btn--large"
                onClick={() => void classifyNow()}
                disabled={!installed || modelState !== 'ready' || reading}
                title={
                  installed && modelState === 'ready'
                    ? 'Classify whatever is in the middle of the picture right now.'
                    : 'The classifier is still loading.'
                }
                data-testid="classify-now"
              >
                <IconCheck size={18} /> {reading ? 'Reading…' : 'Check the item'}
              </button>
            )}
            {cameraOn && installed && (
              <div className="focus-controls">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => captureBackground()}
                  title={
                    backgroundCount >= MAX_BACKGROUNDS
                      ? 'Three backgrounds are stored; adding another replaces the oldest.'
                      : 'Optional: remember an empty table, so only the object that appears is classified.'
                  }
                  data-testid="set-background"
                >
                  <IconRefresh size={16} /> {backgroundCount === 0 ? 'Set background' : 'Add background'}
                </button>
                {backgroundCount > 0 && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={clearBackgrounds}
                    data-testid="clear-backgrounds"
                  >
                    Clear backgrounds
                  </button>
                )}
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={focusOn}
                    onChange={(event) => setFocusOn(event.target.checked)}
                  />
                  <span>Focus on the object</span>
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={autoWatch}
                    onChange={(event) => setAutoWatch(event.target.checked)}
                    data-testid="auto-watch"
                  />
                  <span>Watch automatically</span>
                </label>
              </div>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--large"
              data-testid="hazardous-button"
              onClick={() => void recordHazardous()}
            >
              Hazardous / medical
            </button>
            {focusNote && (
              <p className="hint" data-testid="focus-note">
                {focusNote}
              </p>
            )}
            {cameraOn && installed && focusOn && (
              <p className="hint">
                {backgroundReady
                  ? `${backgroundCount} of ${MAX_BACKGROUNDS} background${backgroundCount === 1 ? '' : 's'} stored on this device. The last set remains until you clear it; ${
                      backgroundCount >= MAX_BACKGROUNDS
                        ? 'adding another replaces the oldest.'
                        : 'add another for a door or lights that change.'
                    }`
                  : 'Show one item to the camera — held in your hand is fine. An empty scene is optional: set one only if the camera looks at a fixed, empty table, and then only the object that appears is classified.'}
              </p>
            )}
            {frameWarning && (
              <p className="warn-text" data-testid="frame-warning">
                {frameWarning}
              </p>
            )}
            <p className="camera-prompt">
              {!cameraSupported
                ? 'This browser cannot open a camera in this tab, so Start Camera is disabled.'
                : !modelKnown
                  ? 'The camera can be previewed, but recognition cannot be checked right now.'
                  : installed
                    ? cameraOn
                      ? 'Show one item to the camera. Hold it still.'
                      : 'Start the camera to begin.'
                    : cameraOn
                      ? 'Preview only — the recognition model is not installed.'
                      : 'Start the camera for a preview. Recognition needs the model.'}
            </p>
          </div>

          <div className="waste-guidance">
            <p>
              <strong>Hold it still</strong> for a few seconds.
            </p>
            <p>
              <strong>One item at a time.</strong> After an item is recognised, remove it; the camera
              arms itself for the next one.
            </p>
          </div>
        </div>

        <div className="result-column">
          <Card
            className="result-card"
            kicker={
              hazardous
                ? 'Hazardous waste'
                : referred
                  ? 'Not one of the three bins'
                  : 'Suggested bin'
            }
            title={
              hazardous
                ? 'Do not sort here'
                : referred
                  ? 'Recycling agent'
                  : resultCategory ?? (removing ? 'Remove the item' : 'Waiting for an item')
            }
          >
            {recognition ? (
              <>
                <p className="result-big" data-testid="waste-result">
                  {shownCategory}
                </p>
                {hazardous ? (
                  <>
                    <p className="result-sub" data-testid="waste-hazardous">
                      This is hazardous waste. Do not put it in the organic, plastic or paper bins.
                      Hand it to the operator and contact the operator.
                    </p>
                    <p className="hint">No bin LED is lit for this item.</p>
                  </>
                ) : referred ? (
                  <>
                    <p className="result-sub" data-testid="waste-referral">
                      {referralLabel ? `${referralLabel} does` : 'This item does'} not go in the
                      organic, plastic or paper bins. Hand it to our recycling agent and contact the
                      operator.
                    </p>
                    <p className="hint">No bin LED is lit for this item.</p>
                  </>
                ) : (
                  <p className="result-sub">
                    Put it in the <strong>{resultCategory?.toLowerCase()}</strong> bin and watch that
                    bin&apos;s LED.
                  </p>
                )}
                {alert && <Notice tone="warn">{alert}</Notice>}
                <p className="hint">
                  This is a camera suggestion, not proof that the item was put in the bin.
                </p>
                {stability?.phase === 'waiting-removal' && (
                  <p className="hint" data-testid="waste-rearm">
                    Remove the item; the camera arms itself for the next one.
                  </p>
                )}
                {stability?.phase === 'armed' && (
                  <p className="hint" data-testid="waste-ready">
                    Camera armed. Show the next item when you are ready.
                  </p>
                )}
                {!cameraOn && (
                  <p className="hint" data-testid="waste-camera-stopped">
                    The camera stopped after this item. Start it again for the next one.
                  </p>
                )}
              </>
            ) : !autoWatch && !recognition && !top ? (
              <p className="result-sub" data-testid="waste-press-hint">
                Hold the item up and press <strong>Check the item</strong>. Nothing is
                classified until you do.
              </p>
            ) : warming ? (
              <p className="result-sub" data-testid="waste-warming">
                Learning this room so the background is never classified as an
                item. Hold the item up in a moment.
              </p>
            ) : removing ? (
              <p className="result-sub" data-testid="waste-remove">
                Take this item away — the camera re-arms by itself.
              </p>
            ) : cameraOn ? (
              <p className="result-sub">
                {top
                  ? topIsBackground
                    ? 'Nothing to sort — this does not look like waste. Show one item, held in your hand is fine.'
                    : strong
                      ? `Looking at ${displayLabel(top.label)}… hold still.`
                      : `Best guess ${displayLabel(top.label)} at ${Math.round(top.confidence * 100)}% — not sure enough to choose a bin. Move it a little and hold it still.`
                  : 'Waiting for the camera to see something.'}
              </p>
            ) : cameraOn && previewOnly ? (
              <p className="result-sub" data-testid="waste-preview-only">
                Preview only — no bin is suggested because the recognition model is not available.
                A presenter can install it from Setup → Voice &amp; Camera.
              </p>
            ) : (
              <p className="result-sub">Start the camera, then show one clean item.</p>
            )}

            {recognitionError && <Notice tone="bad">{recognitionError}</Notice>}

            {recognition && (
              <details className="advanced">
                <summary>
                  {hazardous
                    ? 'Record that the operator took it'
                    : referred
                      ? 'Record that the recycling agent took it'
                      : 'Record that you put it in the bin'}
                </summary>
                <div className="advanced-body">
                  <p className="hint">
                    This is a separate record. A recognition does not prove that the item was placed
                    in a bin.
                  </p>
                  <label className="field">
                    <span>Note (optional)</span>
                    <input
                      className="input"
                      value={note}
                      maxLength={200}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="e.g. plastic bottle from the kitchen"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn--primary btn--small"
                    onClick={() => void confirmDeposit()}
                    disabled={recognitionId === null || Boolean(disposalMessage)}
                  >
                    <IconCheck size={15} /> {hazardous ? 'Confirm reported' : referred ? 'Confirm handed over' : 'Confirm deposited'}
                  </button>
                  {disposalMessage && <p className="ok-text">{disposalMessage}</p>}
                  {disposalError && <p className="error-text">{disposalError}</p>}
                </div>
              </details>
            )}
          </Card>

          {modelStatus.error ? (
            <Notice tone="warn" title="Model status could not be checked">
              {errorMessage(modelStatus.error)}. The camera preview still works; recognition stays
              off until the model can be confirmed.
            </Notice>
          ) : modelStatus.loading ? (
            <Notice tone="info" title="Checking the recognition model…">
              The camera preview is available. Recognition starts only after the model is confirmed.
            </Notice>
          ) : !installed ? (
            <Notice tone="warn" title="Recognition model is missing">
              No waste model is installed, so the camera will not guess. The preview is still
              available. A presenter can install it from{' '}
              <Link to="/setup#voice-camera">Setup → Voice &amp; Camera</Link>.
            </Notice>
          ) : modelError ? (
            <Notice tone="bad" title="The model could not be loaded">
              {modelError}
            </Notice>
          ) : null}

          <details className="advanced">
            <summary>Confidence and model details</summary>
            <div className="advanced-body">
              <div className="prediction-meta">
                <span>Confidence threshold {Math.round(confidence * 100)}%</span>
                <span>{stabilityFrames} frames to accept</span>
                <span>
                  {focusOn
                    ? 'Rearm after the item is removed'
                    : `Cooldown ${Math.round(cooldownMs / 1000)}s`}
                </span>
              </div>
              {predictions.length > 0 ? (
                <ul className="prediction-list">
                  {predictions.map((row) => (
                    <li
                      key={row.label}
                      className={cx(
                        (row.confidence >= confidence ||
                          (strong && groupedTop?.material === row.label)) &&
                          'is-strong',
                      )}
                    >
                      <div className="prediction-head">
                        <span>{displayLabel(row.label)}</span>
                        <span className="prediction-value">{Math.round(row.confidence * 100)}%</span>
                      </div>
                      <div className="prediction-bar">
                        <span style={{ width: `${Math.min(100, Math.max(0, row.confidence * 100))}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint">No predictions yet.</p>
              )}
              <div className="camera-controls">
                <label className="field">
                  <span>Camera device</span>
                  <select
                    className="select"
                    value={deviceId}
                    onChange={(event) => setDeviceId(event.target.value)}
                    disabled={cameraOn}
                  >
                    <option value="">Default camera</option>
                    {devices.map((device, index) => (
                      <option key={device.deviceId || index} value={device.deviceId}>
                        {device.label || `Camera ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                {installed && modelState !== 'ready' && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => void loadModel()}
                    disabled={modelState === 'loading'}
                  >
                    <IconRefresh size={14} /> {modelState === 'loading' ? 'Loading model…' : 'Load model'}
                  </button>
                )}
              </div>
              <p className="hint">
                Model folder <code>{base}</code>. Recognition settings live in{' '}
                <Link to="/setup#voice-camera">Setup</Link>.
              </p>
              <p className="hint">
                <IconInfo size={13} /> Camera frames stay in this browser tab. Only the recognised
                label and its confidence are posted to the local backend.
              </p>
            </div>
          </details>

          <details className="advanced">
            <summary>How it works</summary>
            <div className="advanced-body">
              <p>
                A label must clear the confidence threshold for several consecutive frames before it
                is accepted. The camera then stops itself, so one bottle is not counted on every
                frame and the next item gets a fresh session when the operator starts it again.
              </p>
              <p className="hint">
                The camera recognises waste; it does not identify people, measure weight, or prove
                that anything was placed in a bin. Bin fill comes from the distance sensors.
              </p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
