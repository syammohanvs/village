import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { cx } from '../lib/format';
import { useApi } from '../lib/useApi';
import { createWasteStabilizer, type Prediction, type StabilizerSnapshot, type StableEvent } from '../lib/wasteStabilizer';
import { Card, Notice } from '../components/ui';
import { IconCamera, IconCheck, IconInfo, IconRefresh, IconStop } from '../components/Icons';
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

function capitalise(value: string): string {
  return value.replace(/^\w/, (c) => c.toUpperCase());
}

export function SortWaste() {
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
        `The model could not be loaded from ${base}. ${errorMessage(cause)} A presenter can check the model files in Setup.`,
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
  const strong = Boolean(top && top.confidence >= confidence);
  const waitingRemoval = stability?.phase === 'waiting-removal';
  const removing = waitingRemoval && !recognition;

  const resultCategory = targetCategory ? capitalise(String(targetCategory)) : null;

  return (
    <div className="page sort-waste">
      <div className="waste-layout">
        <div className="camera-column">
          <div className="camera-frame camera-frame--large">
            <video ref={videoRef} className="camera-video" playsInline muted aria-label="Waste camera preview" />
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
                disabled={!cameraSupported}
                title={
                  !cameraSupported
                    ? 'This browser cannot open a camera in this tab.'
                    : installed
                      ? 'Open the camera preview.'
                      : 'Open the camera preview. Recognition stays off until a model is installed.'
                }
                data-testid="start-camera"
              >
                <IconCamera size={18} /> Start Camera
              </button>
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
              <strong>One item only.</strong> Remove this item before showing another.
            </p>
          </div>
        </div>

        <div className="result-column">
          <Card className="result-card" kicker="Suggested bin" title={resultCategory ?? (removing ? 'Remove the item' : 'Waiting for an item')}>
            {recognition ? (
              <>
                <p className="result-big" data-testid="waste-result">
                  {resultCategory}
                </p>
                <p className="result-sub">
                  Put it in the <strong>{resultCategory?.toLowerCase()}</strong> bin and watch that
                  bin&apos;s LED.
                </p>
                {alert && <Notice tone="warn">{alert}</Notice>}
                <p className="hint">
                  This is a camera suggestion, not proof that the item was put in the bin.
                </p>
              </>
            ) : removing ? (
              <p className="result-sub" data-testid="waste-remove">
                Take the item away (or show the empty table) before the next one.
              </p>
            ) : cameraOn ? (
              <p className="result-sub">
                {top
                  ? strong
                    ? `Looking at ${top.label}… hold still.`
                    : 'Not sure yet — move the item a little and hold it still.'
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
                <summary>Record that you put it in the bin</summary>
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
                    <IconCheck size={15} /> Confirm deposited
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
                <span>Cooldown {Math.round(cooldownMs / 1000)}s</span>
              </div>
              {predictions.length > 0 ? (
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
                is accepted. After one event the classifier waits for the item to be removed and for
                the cooldown to pass, so one bottle is not counted on every frame.
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
