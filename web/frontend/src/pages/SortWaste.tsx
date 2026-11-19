import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import type { Prediction } from '../lib/wasteStabilizer';
import { useApi } from '../lib/useApi';
import { BinLeds } from '../components/BinLeds';
import { Card, Notice } from '../components/ui';
import { IconCamera, IconCheck, IconStop } from '../components/Icons';
import { centreCrop, cropGuide, scaleBox } from '../lib/focus';
import { backdropBox } from '../lib/backdrop';
import { MATERIAL_BAR, decide, type Decision } from '../lib/wasteDecision';
import { speakText } from '../lib/speech';
import {
  CAMERA_STORAGE_KEY,
  cameraErrorMessage,
  openCameraStream,
  readStoredCamera,
  waitForFrames,
} from '../lib/camera';
import { BIN_CONFIDENCE, SUPPORT } from '../lib/wasteGuide';
import { useT } from '../lib/i18n';
import type { MessageKey } from '../lib/messages';
import { useVoiceUi } from '../lib/voiceUi';
import { useDemo } from '../lib/demo';
import { useVillage } from '../lib/village';
import type { WasteRecognitionResult } from '../types';

const ANALYSIS_WIDTH = 160;
const ANALYSIS_HEIGHT = 120;
const CROP_SIZE = 224;
const PRESS_CROP_SHARE = 0.8;

/**
 * How long the page waits for the hosted model's name before it answers.
 *
 * Workers AI answers in about a second; OpenCode Go takes five to twelve.  A
 * visitor is not made to wait longer than this for a name — the category is
 * already decided, and the name fills in behind the card if it arrives late.
 */
// Measured 2026-11-19: the first Workers AI call after a restart took 4.7 s
// (cold model), later ones 0.8–1.0 s, and the DeepSeek fallback 5–7 s.  A 4 s
// cap made the first press of a session say "identification unavailable" on a
// backend that had just been started, so the cap covers a cold call.
const VISION_WAIT_MS = 6000;


function ensureCanvas(ref: { current: HTMLCanvasElement | null }, width: number, height: number) {
  if (!ref.current) ref.current = document.createElement('canvas');
  const canvas = ref.current;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas;
}

/**
 * The two things a result screen always offers.
 *
 * "Contact Gram Sahayak" is only a button when there is a number to call.  With
 * no number configured it is the desk sentence instead — a press that cannot
 * work is worse than a sentence that says where to go.
 */
function CardActions({ onScanAnother, support }: { onScanAnother: () => void; support: { desk: string; contact: string } }) {
  const t = useT();
  return (
    <div className="camera-actions" data-testid="waste-actions">
      <button type="button" className="btn btn--primary" onClick={onScanAnother} data-testid="scan-another">
        {t('sort.scanAnother')}
      </button>
      {support.contact ? (
        <a className="btn btn--ghost" href={`tel:${support.contact}`} data-testid="contact-sahayak">
          {t('sort.contactSahayak')}
        </a>
      ) : (
        <span className="hint" data-testid="contact-sahayak">
          {t('sort.supportDesk')}
        </span>
      )}
    </div>
  );
}

export function SortWaste() {
  const t = useT();
  const modelStatus = useApi(['waste-resnet'], () => api.wasteResnetStatus(), {});

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  // The camera the operator chose is remembered: an exhibit laptop usually has
  // a built-in camera AND an external one on a USB lead, and the browser's
  // default is the built-in one — so without this the exhibit came back on the
  // wrong camera after every reload (2026-11-17).
  const [deviceId, setDeviceId] = useState<string>(() => readStoredCamera());
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  // The loop runs on an interval, and `accept` is a callback whose identity must
  // not change per frame, so it read a stale empty list -- which is why every
  // recorded event said `top: []`.  A ref is the frame's guesses as of now.
  const { language: voiceLanguage } = useVoiceUi();
  // Classifying ends at a bin LED, so the page is offered only while the board
  // can light one -- Simulation mode is the way to show the model without it
  // (decided 2026-11-16).
  const { connected, status } = useVillage();
  const { demo } = useDemo();
  const boardOffline = !connected && !demo;
  const [recognition, setRecognition] = useState<WasteRecognitionResult | null>(null);
  // One press = one check.  `phase` drives the panel, `decision` is what the
  // page acts on, and `seq` (a ref) makes a late result from an older press
  // harmless.
  const [check, setCheck] = useState<{
    phase: 'idle' | 'identifying' | 'done';
    identify: 'idle' | 'checking' | 'done' | 'unavailable';
    classify: 'idle' | 'checking' | 'done' | 'uncertain';
    decision: Decision | null;
    crop: string | null;
    cropMode: 'backdrop' | 'centre' | null;
    error: string;
  }>({ phase: 'idle', identify: 'idle', classify: 'idle', decision: null, crop: null, cropMode: null, error: '' });
  const checkSeq = useRef(0);
  // Corrections write into the training tree, so they are an operator action:
  // open the page with ?operator=1 to see them.  A visitor never does.
  const operatorMode =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('operator') === '1';
  const [correction, setCorrection] = useState('');
  const [alert, setAlert] = useState('');
  // A hosted name that arrived *after* the answer was shown, spoken and sent to
  // the board.  It is operator detail only (`Model details`): the visitor's
  // answer, the lamp and Sara's sentence are already final for this check, and
  // a late name must never rewrite one of them without the others.
  const [lateName, setLateName] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const acceptingRef = useRef(false);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // A press reads three frames now, so it takes about a second.  The button
  // says so instead of looking like it did nothing.
  const [reading, setReading] = useState(false);
  // The hosted model's name for the object in front of the camera.  The name is
  // an *input to the decision*: `wasteDecision` reads its material word, so
  // "clear plastic bottle" can put an item in the plastic bin.  It is not the
  // whole answer either — the rules in wasteDecision.ts decide the route.
  const lastCropRef = useRef<string | null>(null);
  // The camera's own shape, so the frame shows the WHOLE picture.  A fixed 4:3
  // box with `object-fit: cover` silently hid the left and right edges of a
  // 16:9 camera, so an item could be in shot and not on screen -- and the read
  // did not match what the Gram Sahayak could see.
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  // The crop behind the current answer, and what the operator said it really
  // was.  One press per mistake is the venue's whole learning loop.
  const captureFileRef = useRef<string | null>(null);
  const [frameWarning, setFrameWarning] = useState('');

  // Two readers, run in parallel on every press: the hosted model names the
  // object (online), and the local ResNet50 classifies the material (offline,
  // and the fallback when the name is missing).  The page needs the hosted one
  // configured to check at all; the local one is what keeps the booth working
  // when the internet is not.
  const installed = Boolean(modelStatus.data?.vision?.ready);
  const visionReady = installed;
  // The naming chain in the order it is tried, named once per *model*: the
  // Cloudflare accounts all answer with the same model, and the OpenCode Go /
  // DeepSeek id comes after them when it is configured.  Shown in Model details
  // so the redundancy is visible without reading the source.
  const namerChain = useMemo(() => {
    const attempts = modelStatus.data?.vision?.attempts ?? [];
    return [...new Set(attempts.map((attempt) => attempt.model).filter(Boolean))];
  }, [modelStatus.data]);
  // Three different facts: the browser can open a camera, the model status is
  // known, and the model is installed.  Collapsing them into one boolean is
  // what produced "the camera can still be used" next to a disabled button.
  const cameraSupported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getUserMedia === 'function';
  const modelKnown = !modelStatus.loading && !modelStatus.error;


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
    setFrameWarning('');
  }, []);

  // One place paints "What it is reading", so no path can return without
  // saying what the model is about to be handed.  The box used to be drawn on
  // only one of the ways out of focusInput, and its canvas has a white
  // background, so a path that returned early left a blank white square
  // captioned "What it is reading" (reported from the venue 2026-11-16).
  const drawPreview = useCallback(
    (source: CanvasImageSource, box: { x: number; y: number; width: number; height: number }) => {
      const preview = previewCanvasRef.current;
      const context = preview?.getContext('2d');
      if (!preview || !context) return;
      context.clearRect(0, 0, preview.width, preview.height);
      context.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, preview.width, preview.height);
    },
    [],
  );



  /**
   * List the cameras without opening one.
   *
   * The picker used to be filled only after a stream opened -- so the one
   * moment a visitor needs it (the camera will not open) is the one moment it
   * was empty, and a virtual camera sitting first in the browser's order could
   * not be skipped.  Before permission the labels are blank but the ids are
   * real, which is enough to choose a different device.
   */
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') return;
    const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    setDevices(list.filter((device) => device.kind === 'videoinput'));
  }, []);

  /** Choose a camera, and remember it for the next visit. */
  const chooseDevice = useCallback((next: string) => {
    setDeviceId(next);
    try {
      if (next) window.localStorage.setItem(CAMERA_STORAGE_KEY, next);
      else window.localStorage.removeItem(CAMERA_STORAGE_KEY);
    } catch {
      /* private modes can refuse storage; the choice still holds this visit */
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  // A camera plugged in while the page is open must appear without a reload —
  // that is exactly how an external camera arrives at a venue.
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media || typeof media.addEventListener !== 'function') return undefined;
    const onChange = () => void refreshDevices();
    media.addEventListener('devicechange', onChange);
    return () => media.removeEventListener('devicechange', onChange);
  }, [refreshDevices]);

  const startCamera = async () => {
    setCameraError('');
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setCameraError('This browser cannot open a camera here.');
      return;
    }
    try {
      // The ladder rather than one request: the rear-camera hint is for a
      // phone, and a remembered deviceId may name a camera that has gone.
      const opened = await openCameraStream(navigator.mediaDevices, deviceId);
      const stream = opened.stream;
      // A device that no longer answers must not be asked for again.
      if (deviceId && !opened.usedDeviceId) chooseDevice('');
      streamRef.current = stream;
      const element = videoRef.current;
      // `getVideoTracks` is the standard accessor but a stand-in stream (and
      // some older browsers) only have `getTracks`, so it is asked defensively.
      const trackLabel =
        (typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks()[0] : undefined)?.label ?? '';
      if (element) {
        element.srcObject = stream;
        // A rejected play() used to be swallowed, which left a black preview
        // with no message -- "the camera is not loading".
        await element.play();
        if (!(await waitForFrames(element))) {
          stream.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          element.srcObject = null;
          throw Object.assign(new Error('the camera opened but sent no picture'), {
            name: 'TimeoutError',
            deviceLabel: trackLabel,
          });
        }
      }
      setCameraOn(true);
        setFrameWarning('');
      const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      setDevices(list.filter((device) => device.kind === 'videoinput'));
    } catch (cause) {
      setCameraError(cameraErrorMessage(cause));
      // So the picker offers the other cameras after a failure.
      void refreshDevices();
    }
  };

  const CLASS_KEY: Record<string, MessageKey> = {
    organic: 'waste.item.organic',
    plastic: 'waste.item.plastic',
    paper: 'waste.item.paper',
    glass: 'waste.item.glass',
    metal: 'waste.item.metal',
    textile: 'waste.item.textile',
    leather: 'waste.item.leather',
    footwear: 'waste.item.footwear',
    thermocol: 'waste.item.thermocol',
    ewaste: 'waste.item.ewaste',
    background: 'waste.item.background',
  };

  /** The class name a decision is shown with, in the page's language. */
  const categoryName = (decision: Decision): string => {
    const key = decision.classId ? CLASS_KEY[decision.classId] : undefined;
    return key ? t(key) : t('sort.stateUncertain');
  };

  /**
   * The one sentence a decision is spoken and written as.
   *
   * The status comes before the route: a conflicting answer has a route that
   * looks ordinary, and saying it would be the confident-wrong-answer this page
   * exists to avoid.
   */
  const actionSentence = useCallback(
    (decision: Decision): string => {
      if (decision.status === 'nothing') return t('sort.actionNothing');
      if (decision.reasonId === 'conflict' || decision.reasonId === 'specialCare') {
        return t('sort.actionConflict');
      }
      if (decision.reasonId === 'identificationMissing') return t('sort.actionConfirm');
      if (decision.status === 'uncertain') return t('sort.actionSeparate');
      if (decision.routeId === 'collect.ewaste') return t('sort.actionEwaste');
      if (decision.routeId.startsWith('collect.')) return t('sort.actionCollect');
      if (decision.bin === 'organic') return t('sort.actionBin', { bin: t('bin.organic.name') });
      if (decision.bin === 'plastic') return t('sort.actionBin', { bin: t('waste.bin.plastic.title') });
      if (decision.bin === 'paper') return t('sort.actionBin', { bin: t('waste.bin.paper.title') });
      return t('sort.actionSeparate');
    },
    [t],
  );

  /**
   * The sentence Sara says: the label, the category, then the path.
   *
   * Spoken once per press, and only for the decision that was actually taken —
   * a late name is dropped before this is reached.
   */
  const spokenAnswer = (decision: Decision): string => {
    const item = decision.itemLabel?.trim();
    const category = categoryName(decision);
    const action = actionSentence(decision);
    if (!item) return `${category}. ${action}`;
    return t('sort.spoken', { item, category, action });
  };

  /**
   * One press, one check, one decision.
   *
   * The two readers answer different questions and run **in parallel**: the
   * local ResNet50 gives a material distribution in ~70 ms, the hosted model
   * gives a name in ~1 s.  The name is an input to the route (its material
   * word can choose a bin) and the classifier is the fallback when no name
   * arrives; the page waits for both, or for the name's timeout, before
   * anything physical happens — so a bin is never lit and then reconsidered.
   *
   * `checkSeq` is the request identity.  A result belonging to an older press —
   * a late cloud answer, a frame that finished after the button was pressed
   * again — is dropped rather than overwriting the newer answer.
   */
  const runCheck = useCallback(async () => {
    const video = videoRef.current;
    if (!video || busyRef.current || video.readyState < 2) return;
    const seq = ++checkSeq.current;
    busyRef.current = true;
    setReading(true);
    setAlert('');
    setRecognition(null);
    setLateName(null);
    // Set once this check's answer has been shown, spoken and posted.  A name
    // resolving after that is kept for the details and nothing else.
    let settled = false;
    setCheck({
      phase: 'identifying',
      identify: visionReady ? 'checking' : 'idle',
      classify: 'checking',
      decision: null,
      crop: null,
      cropMode: null,
      error: '',
    });

    let naming: Promise<string | null> = Promise.resolve(null);
    // The offline model runs in the background on every press.  It is not the
    // answer any more, but it must keep seeing the booth's own objects: it is
    // what answers if the internet goes, and every press teaches it (below).
    let local: Promise<Prediction[]> = Promise.resolve([]);
    let asked = false;
    try {
      const analysis = ensureCanvas(analysisCanvasRef, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      const analysisContext = analysis.getContext('2d');
      const crop = ensureCanvas(cropCanvasRef, CROP_SIZE, CROP_SIZE);
      const cropContext = crop.getContext('2d');
      if (!analysisContext || !cropContext) return;
      const videoWidth = video.videoWidth || ANALYSIS_WIDTH;
      const videoHeight = video.videoHeight || ANALYSIS_HEIGHT;
      let cropMode: 'backdrop' | 'centre' = 'centre';

      /** One look at the item: find it on the sheet, crop it, read it. */
      const readOnce = async (): Promise<void> => {
        analysisContext.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
        const frame = analysisContext.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
        const found = backdropBox(frame.data, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
        cropMode = found.box ? 'backdrop' : 'centre';
        const box = found.box ?? centreCrop(ANALYSIS_WIDTH, ANALYSIS_HEIGHT, PRESS_CROP_SHARE);
        const source = scaleBox(box, ANALYSIS_WIDTH, ANALYSIS_HEIGHT, videoWidth, videoHeight);
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
        if (!asked) {
          asked = true;
          lastCropRef.current = crop.toDataURL('image/jpeg', 0.92);
          // The namer is asked about the same square the classifier is handed,
          // and asked once — its answer is a name, never a bin.
          if (visionReady && lastCropRef.current) {
            const image = lastCropRef.current;
            naming = api
              .wasteIdentify(image)
              .then((answer) => {
                const name = answer.object;
                // Late: the decision has already been given.  Record it for the
                // operator, never as the visitor's answer.
                if (name && settled && seq === checkSeq.current) setLateName(name);
                return name;
              })
              .catch(() => null);
          }
          if (lastCropRef.current) {
            const image = lastCropRef.current;
            local = api
              .wasteClassify(image)
              .then((answer) => {
                // The crop the classifier kept, so the operator's correction can
                // point at the exact frame it was shown.
                captureFileRef.current = answer.file ?? null;
                return answer.predictions.map((row) => ({
                  label: row.className,
                  confidence: row.probability,
                }));
              })
              .catch(() => [] as Prediction[]);
          }
        }
      };

      // One frame is enough now: the hosted model names what it sees, and the
      // local classifier that needed three frames to settle is gone.
      await readOnce();
      if (seq !== checkSeq.current) return;
      // Overlapped with the frames, capped so a slow cloud model cannot hold
      // the answer hostage.
      const itemLabel = visionReady
        ? await Promise.race([
            naming,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), VISION_WAIT_MS)),
          ])
        : null;
      const predictions = await local;
      if (seq !== checkSeq.current) return;

      const decision = decide({
        predictions,
        itemLabel,
        visionConfigured: visionReady,
        binBar: BIN_CONFIDENCE,
        materialBar: MATERIAL_BAR,
      });
      setCheck({
        phase: 'done',
        identify: visionReady ? (itemLabel ? 'done' : 'unavailable') : 'idle',
        classify: decision.status === 'uncertain' ? 'uncertain' : 'done',
        decision,
        crop: lastCropRef.current,
        cropMode,
        error: '',
      });
      // From here the answer is final: a name that resolves later is kept in
      // the details only.
      settled = true;

      // Teach the offline model in the background: this crop, under the class
      // the hosted model named.  Fire-and-forget — a training copy must never
      // delay or fail a press.  Nothing is filed for an item the name placed in
      // none of our bins (a pencil): there is no class to teach.
      if (lastCropRef.current && decision.source === 'vision' && decision.classId) {
        const label = decision.classId.charAt(0).toUpperCase() + decision.classId.slice(1);
        void api
          .wasteTeach(lastCropRef.current, label, itemLabel ?? '', modelStatus.data?.vision?.model ?? '')
          .catch(() => undefined);
      }

      // Sara says the whole answer once, in the language it began in: what the
      // item is, what it is made of, and where it goes.
      void speakText(spokenAnswer(decision), voiceLanguage, 0.95);
      if (decision.status === 'nothing') return;

      // Only a bin decision may ask the board for a lamp.  Everything else is
      // recorded honestly: 'medical' for the special-care refusal, 'other' for
      // a referral or an uncertain answer.  Neither sends INDICATE_WASTE, so no
      // lamp is lit for them — and the board's own timer clears the previous
      // one within its `indicate_ms` (8 s), because the firmware has no clear
      // command (see docs/waste-approach.md §6).
      if (acceptingRef.current) return;
      acceptingRef.current = true;
      try {
        // What the classifier actually read, kept apart from the decision: with
        // a name present the classifier did not decide, and its probability is
        // not a confidence in the answer.  Ranked here rather than assuming the
        // array arrives sorted, and taken from the decision's own top reading so
        // the record and the card cannot disagree.
        const ranked = [...predictions].sort((a, b) => b.confidence - a.confidence);
        const top = ranked.slice(0, 3).map((row) => ({
          className: row.label,
          probability: Math.round(Math.min(1, row.confidence) * 1000) / 1000,
        }));
        const result = await api.postRecognition({
          category:
            decision.reasonId === 'specialCare'
              ? 'medical'
              : decision.allowLamp && decision.bin
                ? decision.bin
                : 'other',
          confidence: Math.min(1, Math.max(0, decision.localConfidence)),
          model: 'resnet50',
          material: decision.localClassId ?? 'unknown',
          top,
          item: decision.itemLabel ?? null,
          route: decision.routeId,
          source: decision.source,
          namer: modelStatus.data?.vision?.model ?? null,
        });
        if (seq !== checkSeq.current) return;
        setRecognition(result);
        setAlert(result.alert ?? '');
      } finally {
        acceptingRef.current = false;
      }
    } catch (cause) {
      if (seq === checkSeq.current) {
        setCheck((old) => ({ ...old, phase: 'done', error: errorMessage(cause) }));
      }
    } finally {
      if (seq === checkSeq.current) setReading(false);
      busyRef.current = false;
    }
  }, [actionSentence, visionReady, voiceLanguage]);  // spokenAnswer is stable: t only


  // The model is loaded when the page opens rather than when the camera starts,
  // so the start button can stay disabled until the pipeline can actually
  // answer.  Pressing it into a half-ready page is what made "it is learning the
  // room" look like a fault.

  // The box is captioned "What it is reading" and sits on screen the whole time
  // the camera is on, but it was only painted while a read was in flight -- so
  // between reads it was an empty square, and with the canvas' white background
  // that looked like the model had been handed a white plate.  A cheap refresh
  // keeps it showing the camera; a read still overwrites it with the exact crop
  // (mask included) that was judged.
  useEffect(() => {
    if (!cameraOn) return;
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      drawPreview(video, {
        x: 0,
        y: 0,
        width: video.videoWidth || ANALYSIS_WIDTH,
        height: video.videoHeight || ANALYSIS_HEIGHT,
      });
    }, 500);
    return () => clearInterval(timer);
  }, [cameraOn, drawPreview]);

  /** Back to waiting: a new press starts a new check with a new identity. */
  const resetCheck = useCallback(() => {
    checkSeq.current += 1;
    setCheck({
      phase: 'idle',
      identify: 'idle',
      classify: 'idle',
      decision: null,
      crop: null,
      cropMode: null,
      error: '',
    });
    setRecognition(null);
    captureFileRef.current = null;
  }, []);

  return (
    <div className="page sort-waste">
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
              autoPlay
              aria-label={t('sort.previewAria')}
              onLoadedMetadata={(event) => {
                const { videoWidth, videoHeight } = event.currentTarget;
                if (videoWidth > 0 && videoHeight > 0) setVideoAspect(videoWidth / videoHeight);
              }}
            />
            {/*
              The square that will actually be read.  Drawn, not guessed: the
              same `PRESS_CROP_SHARE` sizes it and the crop, so what the Gram Sahayak
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
            {/* The exact 224-px square the model will be handed, so a visitor can
                see their own hair in it before pressing rather than after. */}
            {cameraOn ? (
              <figure className="crop-preview" data-testid="crop-preview">
                <canvas
                  ref={previewCanvasRef}
                  width={112}
                  height={112}
                  aria-hidden="true"
                />
                <figcaption>{t('sort.whatReading')}</figcaption>
              </figure>
            ) : null}
            {!cameraOn && (
              <div className="camera-placeholder">
                <IconCamera size={34} />
                <p>{t('sort.startThenShow')}</p>
                {cameraError && <p className="error-text">{cameraError}</p>}
              </div>
            )}
          </div>

          <div className="camera-actions">
            {boardOffline && (
              <p className="hint" data-testid="waste-offline">
                {t('sort.offlineHint')}
              </p>
            )}
            {cameraOn ? (
              <button type="button" className="btn btn--danger btn--large" onClick={stopCamera}>
                <IconStop size={18} /> {t('sort.stopCamera')}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary btn--large"
                onClick={() => void startCamera()}
                disabled={boardOffline || !cameraSupported}
                title={
                  boardOffline
                    ? t('sort.titleOffline')
                    : !cameraSupported
                      ? t('sort.titleNoBrowser')
                      : installed
                        ? t('sort.titleOpen')
                        : t('sort.titlePreviewOnly')
                }
                data-testid="start-camera"
              >
                <IconCamera size={18} /> {t('sort.startCamera')}
              </button>
            )}
            {cameraOn && (
              <button
                type="button"
                className="btn btn--primary btn--large"
                onClick={() => void runCheck()}
                disabled={!installed || reading}
                title={
                  installed
                    ? 'Name whatever is on the base right now.'
                    : 'The item-naming model is not available.'
                }
                data-testid="classify-now"
              >
                <IconCheck size={18} /> {reading ? 'Reading…' : 'Check the item'}
              </button>
            )}
            <div className="camera-picker" data-testid="camera-picker">
              <label className="field">
                <span>{t('sort.cameraDevice')}</span>
                <select
                  className="select"
                  value={deviceId}
                  onChange={(event) => chooseDevice(event.target.value)}
                  disabled={cameraOn}
                  data-testid="camera-device"
                  title={cameraOn ? t('sort.stopToChoose') : t('sort.pickDevice')}
                >
                  <option value="">{t('sort.defaultCamera')}</option>
                  {devices.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              {devices.some((device) => !device.label) && (
                <p className="hint" data-testid="camera-labels-hint">
                  {t('sort.labelsHint')}
                </p>
              )}
            </div>
            {frameWarning && (
              <p className="warn-text" data-testid="frame-warning">
                {frameWarning}
              </p>
            )}
            <p className="camera-prompt">
              {!cameraSupported
                ? t('sort.promptNoBrowser')
                : !modelKnown
                  ? t('sort.promptModelUnknown')
                  : installed
                    ? cameraOn
                      ? t('sort.promptHoldStill')
                      : t('sort.promptStart')
                    : cameraOn
                      ? t('sort.promptPreviewOnly')
                      : t('sort.promptPreviewModel')}
            </p>
          </div>

          <div className="waste-guidance">
            <p>{t('sort.holdStill')}</p>
            <p>{t('sort.oneAtATime')}</p>
          </div>
        </div>

        <div className="result-column">
          {/* Simulation only: a classification sends INDICATE_WASTE, and the
              demo device holds that category for a few seconds — so these are
              the real lamps, drawn where the board's own are. */}
          {demo && (
            <BinLeds
              active={
                status?.actuators?.waste_indicator?.active
                  ? status.actuators.waste_indicator.category
                  : null
              }
            />
          )}
          {visionReady && (
            <p className="hint" data-testid="waste-disclosure">
              {t('sort.disclosure')}
            </p>
          )}
          <Card className="result-card" title={t('sort.suggestedBin')}>
            {/*
              The big answer first — what the item is, what it is made of, where
              it goes — and the two model readings underneath, because that is
              the order a visitor reads it in.  Nothing is classified until the
              button is pressed, and the card says so while it waits.
            */}
            {!check.decision && !reading ? (
              <div data-testid="waste-waiting-block">
                <p className="result-big" data-testid="waste-waiting">
                  {t('sort.waitingForItem')}
                </p>
                <p className="result-lead">{t('sort.helpLine')}</p>
                <p className="result-press" data-testid="waste-press-hint">
                  {t('sort.pressHint')}
                </p>
              </div>
            ) : (
              <>
                <div className="model-state" data-testid="waste-identify">
                  <div className="model-state-head">
                    <span className="model-state-label">{t('sort.labelIdentification')}</span>
                    <span className="model-state-source">{t('sort.sourceVision')}</span>
                  </div>
                  <p className="model-state-value" data-testid="waste-sees">
                    {check.identify === 'checking'
                      ? t('sort.stateIdentifying')
                      : check.identify === 'done' && check.decision?.itemLabel
                        ? check.decision.itemLabel
                        : t('sort.stateUnavailable')}
                  </p>
                </div>

                <div className="model-state model-state--class" data-testid="waste-classify">
                  <div className="model-state-head">
                    <span className="model-state-label">{t('sort.labelClassification')}</span>
                    <span className="model-state-source">
                      {check.decision?.source === 'vision' ? t('sort.sourceName') : t('sort.sourceLocal')}
                    </span>
                  </div>
                  <p className="model-state-value" data-testid="waste-result">
                    {!check.decision || check.classify === 'checking'
                      ? t('sort.stateClassifying')
                      : check.classify === 'uncertain'
                        ? `${categoryName(check.decision)} · ${t('sort.stateUncertain')}`
                        : categoryName(check.decision)}
                  </p>
                </div>

                <div className="suggested-action" data-testid="waste-action">
                  <span className="suggested-label">{t('sort.labelAction')}</span>
                  <p>{check.decision ? actionSentence(check.decision) : t('sort.stateWaiting')}</p>
                </div>
              </>
            )}

            {check.error && <Notice tone="bad">{check.error}</Notice>}
            {recognition?.led_note && (
              <p className="hint" data-testid="waste-led-note">
                {recognition.led_note}
              </p>
            )}
            {alert && <Notice tone="warn">{alert}</Notice>}
            {!connected && !demo && (
              <p className="hint" data-testid="waste-lamp-unavailable">
                {t('sort.lampUnavailable')}
              </p>
            )}

            <details className="advanced" data-testid="waste-details">
              <summary>{t('sort.modelDetails')}</summary>
              <div className="advanced-body">
                {check.crop && (
                  <figure className="crop-thumb" data-testid="waste-crop">
                    <img src={check.crop} alt="" width={72} height={72} />
                    <figcaption>{t('sort.cropLabel')}</figcaption>
                  </figure>
                )}
                {check.cropMode === 'centre' && (
                  <p className="hint" data-testid="waste-crop-centre">
                    {t('sort.cropCentre')}
                  </p>
                )}
                {lateName && (
                  <p className="hint" data-testid="waste-late-name">
                    {t('sort.lateName', { item: lateName })}
                  </p>
                )}
                <p className="hint" data-testid="waste-details-namer">
                  {t('sort.detailsNamer')}:{' '}
                  {modelStatus.data?.vision?.model ?? t('sort.stateUnavailable')}
                </p>
                <p className="hint" data-testid="waste-details-classifier">
                  {t('sort.detailsClassifier')}: {modelStatus.data?.model ?? 'resnet50'}
                </p>
                {namerChain.length > 1 && (
                  <p className="hint" data-testid="waste-details-chain">
                    {t('sort.detailsChain', { models: namerChain.join(' → ') })}
                  </p>
                )}
              </div>
            </details>

            {operatorMode && captureFileRef.current && (
              <div className="correction-row" data-testid="waste-correction">
                {correction ? (
                  <p className="hint">{correction}</p>
                ) : (
                  <>
                    <span className="correction-prompt">{t('sort.wrongItWas')}</span>
                    {(
                      [
                        ['organic', t('sort.correctOrganic')],
                        ['plastic', t('sort.correctPlastic')],
                        ['paper', t('sort.correctPaper')],
                        ['separate', t('sort.correctSeparate')],
                      ] as const
                    ).map(([actual, label]) => (
                      <button
                        key={actual}
                        type="button"
                        className="chip chip--neutral correction-chip"
                        data-testid={`correct-${actual}`}
                        onClick={() => {
                          const file = captureFileRef.current;
                          if (!file) return;
                          void api
                            .wasteCorrect(file, actual)
                            .then(() => setCorrection(t('sort.correctionThanks', { label })))
                            .catch((cause: unknown) => setCorrection(errorMessage(cause)));
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
            <CardActions onScanAnother={resetCheck} support={SUPPORT} />
            <p className="hint">{t('sort.plainBackground')}</p>
          </Card>

          {/*
            The help that used to be a row of buttons.  It is text, because it
            is guidance about waste, not a claim that the model recognises a new
            class — and it is collapsed, because the card already answers the
            common case.
          */}
          <details className="waste-guide" data-testid="waste-guide">
            <summary>{t('sort.guideTitle')}</summary>
            <div className="waste-guide-body">
              <p className="hint">{t('sort.guideDemo')}</p>
              <ul>
                {[
                  'sort.guideWet',
                  'sort.guidePaper',
                  'sort.guidePlastic',
                  'sort.guideGlass',
                  'sort.guideMetal',
                  'sort.guideTextile',
                  'sort.guideThermocol',
                  'sort.guideEwaste',
                  'sort.guideBattery',
                  'sort.guideSanitary',
                  'sort.guidePencil',
                  'sort.guideSharps',
                  'sort.guideSpecial',
                  'sort.guideOtherDry',
                  'sort.guideUnknown',
                ].map((key) => (
                  <li key={key}>{t(key as MessageKey)}</li>
                ))}
              </ul>
              <p className="hint">{t('sort.guideLocal')}</p>
            </div>
          </details>

          {modelStatus.error ? (
            <Notice tone="warn" title={t('sort.modelStatusUnknown')}>
              {errorMessage(modelStatus.error)}. The camera preview still works; recognition stays
              off until the model can be confirmed.
            </Notice>
          ) : modelStatus.loading ? (
            <Notice tone="info" title={t('sort.checkingModel')}>
              The camera preview is available. Recognition starts only after the model is confirmed.
            </Notice>
          ) : !installed ? (
            <Notice tone="warn" title={t('sort.modelMissing')}>
              {t('sort.modelMissingBody')}
            </Notice>
          ) : null}


          <details className="advanced">
            <summary>{t('sort.howItWorks')}</summary>
            <div className="advanced-body">
              <p>
                One picture is taken when you press <strong>Check the item</strong>, and a hosted
                vision model names what it sees. The waste category comes from that name — if the
                name says plastic, the item is plastic — and the three demonstration bins light
                their own lamp. Nothing is read until you press.
              </p>
              <p className="hint">
                {t('sort.safetyNote')}
              </p>
              {visionReady && (
                // A hosted model means the crop leaves the laptop.  Saying it
                // only when one is configured keeps the note true either way.
                <p className="hint" data-testid="waste-vision-note">
                  {t('sort.visionNote')}
                </p>
              )}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
