import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { cx } from '../lib/format';
import { useApi } from '../lib/useApi';
import { useDemo } from '../lib/demo';
import { createWasteStabilizer, type Prediction, type StabilizerSnapshot, type StableEvent } from '../lib/wasteStabilizer';
import { Card, Chip, EmptyState, ErrorBlock, Notice } from '../components/ui';
import { IconCamera, IconCheck, IconInfo, IconRefresh } from '../components/Icons';
import type { WasteRecognitionResult } from '../types';

interface Classifier {
  predict(input: HTMLVideoElement, maxPredictions: number): Promise<{ className: string; probability: number }[]>;
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

export function Waste() {
  const { demo } = useDemo();
  const settings = useApi(['settings'], () => api.settings(), {});
  const modelStatus = useApi(['waste-model'], () => api.wasteModelStatus(), {});

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [modelState, setModelState] = useState<ModelState>('idle');
  const [modelError, setModelError] = useState('');
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [stability, setStability] = useState<StabilizerSnapshot | null>(null);
  const [recognition, setRecognition] = useState<WasteRecognitionResult | null>(null);
  const [recognitionError, setRecognitionError] = useState('');
  const [alert, setAlert] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [note, setNote] = useState('');
  const [disposalMessage, setDisposalMessage] = useState('');
  const [disposalError, setDisposalError] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const classifierRef = useRef<Classifier | null>(null);
  const stabilizerRef = useRef(createWasteStabilizer());
  const busyRef = useRef(false);
  const acceptingRef = useRef(false);

  const installed = modelInstalled(modelStatus.data);
  const base = modelBase(settings.data?.waste_model_path);
  const confidence = settings.data?.waste_confidence ?? 0.62;
  const stabilityFrames = settings.data?.waste_stability_frames ?? 4;
  const cooldownMs = settings.data?.waste_cooldown_ms ?? 8000;

  useEffect(() => {
    stabilizerRef.current = createWasteStabilizer({
      threshold: confidence,
      consecutiveFrames: stabilityFrames,
      cooldownMs,
    });
  }, [confidence, stabilityFrames, cooldownMs]);

  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media || typeof media.enumerateDevices !== 'function') return;
    void media
      .enumerateDevices()
      .then((list) => setDevices(list.filter((device) => device.kind === 'videoinput')))
      .catch(() => undefined);
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
    setPredictions([]);
    stabilizerRef.current.reset();
  }, []);

  const loadModel = useCallback(async () => {
    if (!installed || modelState === 'loading' || modelState === 'ready') return;
    setModelState('loading');
    setModelError('');
    try {
      await import('@tensorflow/tfjs');
      const tm = (await import('@teachablemachine/image')) as unknown as {
        load: (model: string, metadata: string) => Promise<Classifier>;
      };
      const classifier = await tm.load(`${base}model.json`, `${base}metadata.json`);
      classifierRef.current = classifier;
      setModelState('ready');
      stabilizerRef.current.reset();
    } catch (cause) {
      classifierRef.current = null;
      setModelState('error');
      setModelError(
        `The model could not be loaded from ${base}. ${errorMessage(cause)} Check model.json, metadata.json and weights.bin.`,
      );
    }
  }, [installed, modelState, base]);

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
    setAccepting(true);
    setRecognitionError('');
    setDisposalMessage('');
    setDisposalError('');
    setNote('');
    try {
      const result = await api.postRecognition({
        category: event.category,
        confidence: event.confidence,
        model: 'teachable-machine',
      });
      setRecognition(result);
      const binState = result.bin?.state;
      const resultAlert =
        result.alert ??
        (binState === 'full'
          ? `The ${event.category} bin is reported full. Empty it before the next item.`
          : binState === 'nearly_full'
            ? `The ${event.category} bin is nearly full.`
            : '');
      setAlert(resultAlert);
    } catch (cause) {
      setRecognitionError(errorMessage(cause));
    } finally {
      acceptingRef.current = false;
      setAccepting(false);
    }
  }, []);

  useEffect(() => {
    if (!cameraOn || modelState !== 'ready') return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const video = videoRef.current;
      const classifier = classifierRef.current;
      if (!video || !classifier || busyRef.current || video.readyState < 2) return;
      busyRef.current = true;
      try {
        const raw = await classifier.predict(video, 3);
        if (cancelled) return;
        const top = raw.slice(0, 3).map((row) => ({
          label: row.className,
          confidence: row.probability,
        }));
        setPredictions(top);
        const event = stabilizerRef.current.push(top);
        setStability(stabilizerRef.current.snapshot());
        if (event) void accept(event);
      } catch {
        if (!cancelled) setPredictions([]);
      } finally {
        busyRef.current = false;
      }
    }, 600);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [cameraOn, modelState, accept]);

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

  const top = predictions[0];
  const stableLabel =
    stability?.phase === 'waiting-removal'
      ? 'Remove the item (or show the empty background) before the next recognition.'
      : stability?.stable
        ? `Stable: ${stability.streakLabel}`
        : `Looking for ${stabilityFrames} agreeing frames in a row.`;

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Local image recognition</p>
          <h2 className="page-title">Waste camera</h2>
          <p className="page-lede">
            The model suggests a category and lights the matching bin LED. It does not identify
            people, measure weight, or prove that anything was placed in a bin.
          </p>
        </div>
        <div className="intro-chips">
          <Chip tone={installed ? 'live' : 'warn'}>
            {installed ? 'Model installed' : 'Recognition model not installed'}
          </Chip>
          {demo && <Chip tone="warn">Demo</Chip>}
        </div>
      </div>

      {Boolean(modelStatus.error) && (
        <ErrorBlock error={modelStatus.error} onRetry={modelStatus.reload} />
      )}

      {!modelStatus.loading && !installed && !modelStatus.error && (
        <Card kicker="Setup" title="Recognition model not installed" className="model-missing">
          <p>
            Copy the Teachable Machine image export into the folder below, then reload this page.
            Until then the camera will not make predictions — it never invents them.
          </p>
          <pre className="code-block">{`models/waste/
  model.json
  metadata.json
  weights.bin`}</pre>
          <ul className="plain-list">
            <li>Train an Image Project with Organic, Plastic, Paper and Background classes.</li>
            <li>Export as TensorFlow.js, download the ZIP, and copy these three files.</li>
            <li>
              The app looks in <code>{base}</code> and reports exactly this message when a file is
              missing.
            </li>
          </ul>
          <p className="hint">
            The backend serves the folder at <code>/models/waste/</code>. No cloud service is used.
          </p>
        </Card>
      )}

      <div className="waste-layout">
        <Card
          kicker="Camera"
          title="Live video"
          actions={
            <span className={cx('chip', cameraOn ? 'chip--live' : 'chip--neutral')}>
              {cameraOn ? 'Camera on' : 'Camera off'}
            </span>
          }
        >
          <div className="camera-frame">
            <video ref={videoRef} className="camera-video" playsInline muted aria-label="Waste camera preview" />
            {!cameraOn && (
              <div className="camera-placeholder">
                <IconCamera size={26} />
                <p>{cameraError || 'Start the camera to preview the bin.'}</p>
              </div>
            )}
          </div>

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
            {cameraOn ? (
              <button type="button" className="btn btn--ghost" onClick={stopCamera}>
                Stop camera
              </button>
            ) : (
              <button type="button" className="btn btn--primary" onClick={() => void startCamera()} disabled={!installed}>
                <IconCamera size={16} /> Start camera
              </button>
            )}
            {installed && modelState !== 'ready' && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void loadModel()}
                disabled={modelState === 'loading'}
              >
                <IconRefresh size={15} /> {modelState === 'loading' ? 'Loading model…' : 'Load model'}
              </button>
            )}
          </div>
          {modelError && <Notice tone="bad">{modelError}</Notice>}
          <p className="hint">
            Camera frames stay in this browser tab. Only the recognised label and its confidence are
            posted to the local backend.
          </p>
        </Card>

        <Card
          kicker="Classifier"
          title="Predictions"
          actions={
            <span className={cx('chip', modelState === 'ready' ? 'chip--live' : 'chip--neutral')}>
              {modelState === 'ready' ? 'Model ready' : installed ? 'Model not loaded' : 'No model'}
            </span>
          }
        >
          {!installed ? (
            <EmptyState title="No predictions">
              Recognition stays off until the model is installed. Nothing is guessed or substituted.
            </EmptyState>
          ) : predictions.length === 0 ? (
            <EmptyState title="No predictions yet">
              {cameraOn ? 'Point the camera at one item in the bin.' : 'Start the camera to read the model.'}
            </EmptyState>
          ) : (
            <>
              <ul className="prediction-list">
                {predictions.map((row) => (
                  <li key={row.label} className={cx(row.confidence >= confidence && 'is-strong')}>
                    <div className="prediction-head">
                      <span>{row.label}</span>
                      <span className="prediction-value">{Math.round(row.confidence * 100)}%</span>
                    </div>
                    <div className="prediction-bar">
                      <span style={{ width: `${Math.min(100, Math.max(0, row.confidence * 100))}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="prediction-meta">
                <span>Threshold {Math.round(confidence * 100)}%</span>
                <span>{stabilityFrames} frames to accept</span>
                <span>Cooldown {Math.round(cooldownMs / 1000)}s</span>
              </div>
              <p className={cx('stability-line', stability?.stable && 'is-stable')}>
                {accepting ? 'Recording the recognition…' : stableLabel}
              </p>
              {top && top.confidence < confidence && (
                <p className="hint">
                  Top guess is below the confidence threshold, so it is ignored. Move the item closer
                  or improve the light.
                </p>
              )}
            </>
          )}
        </Card>
      </div>

      {recognitionError && <Notice tone="bad" title="Recognition was not recorded">{recognitionError}</Notice>}

      {recognition && (
        <Card kicker="Recorded event" title="Suggested bin" className="recognition-card">
          <div className="recognition-head">
            <div>
              <p className="recognition-category">{String(targetCategory ?? 'unknown').replace(/^\w/, (c) => c.toUpperCase())}</p>
              <p className="hint">
                One event was recorded for this presentation. The classifier stays locked until the
                item is removed and the cooldown has elapsed.
              </p>
            </div>
            <Chip tone={recognition.bin?.state === 'full' ? 'bad' : 'gold'}>
              {recognition.bin?.state ? recognition.bin.state.replace('_', ' ') : 'indicated'}
            </Chip>
          </div>

          {alert && <Notice tone="warn">{alert}</Notice>}

          <div className="deposit-block">
            <p className="setting-name">Confirm deposited</p>
            <p className="hint">
              This is a separate record. Recognition suggests a category; it does not prove that the
              item went into the bin. Only press this after you have actually placed it there.
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
              className="btn btn--primary"
              onClick={() => void confirmDeposit()}
              disabled={recognitionId === null || Boolean(disposalMessage)}
            >
              <IconCheck size={16} /> Confirm deposited
            </button>
            {disposalMessage && <p className="ok-text">{disposalMessage}</p>}
            {disposalError && <p className="error-text">{disposalError}</p>}
            <p className="hint">
              Deposits and recognitions are stored as different records in the local database.
            </p>
          </div>
        </Card>
      )}

      <Card kicker="How it decides" title="One event per item">
        <div className="two-col">
          <div>
            <p>
              A label must clear the confidence threshold for several consecutive frames. After one
              event is accepted the classifier waits for the background class (or an empty frame) for
              a few frames and for the cooldown to pass before it can record another item.
            </p>
            <p className="hint">
              This stops a single bottle being counted on every frame while it sits in front of the
              camera.
            </p>
          </div>
          <ul className="plain-list">
            <li>Confidence threshold: {Math.round(confidence * 100)}%</li>
            <li>Consecutive frames: {stabilityFrames}</li>
            <li>Cooldown: {Math.round(cooldownMs / 1000)}s</li>
            <li>Edit these in Settings → App preferences.</li>
          </ul>
        </div>
        <p className="hint">
          <IconInfo size={14} /> An accepted recognition lights the bin indicator for a bounded time
          and records an event. Bin fill comes from the ultrasonic sensor, not the camera.
        </p>
        {!cameraOn && <p className="hint">Last camera reading: stopped.</p>}
        {cameraOn && <p className="hint">Camera has been running for this session; frames are not stored.</p>}
        <p className="hint">Model path: <code>{base}</code> · cooldown is {Math.round(cooldownMs / 1000)} seconds.</p>
      </Card>
    </div>
  );
}
