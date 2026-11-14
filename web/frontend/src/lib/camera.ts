/**
 * Opening the camera, with a way back from the ways it fails.
 *
 * Reported from the venue: *"The camera could not start: Timeout starting video
 * source"* — Chrome's own wording for a device that was chosen and then sent no
 * frames.  Two of the causes were ours:
 *
 *   - the first request always asked for `facingMode: 'environment'`, which is a
 *     phone's rear camera.  A laptop has none, and depending on the driver
 *     Chrome answers by selecting nothing and timing out.
 *   - a remembered `deviceId` was requested as `exact`.  A camera that has been
 *     unplugged, or picked on another machine, then fails the whole call even
 *     though a perfectly good camera is attached.
 *
 * So the stream is opened through a short ladder: the chosen camera, then any
 * camera at the same size, then the rear-camera hint a phone needs, then
 * whatever the browser will give.  The first success wins, and the caller is
 * told which rung it landed on so the device list can follow along.
 */

export interface CameraMedia {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

export interface CameraStream {
  stream: MediaStream;
  /** How far down the ladder we had to go; 0 is the first choice. */
  rung: number;
  usedDeviceId: boolean;
}

/** The constraints to try, best first. */
export function cameraLadder(deviceId?: string | null): MediaStreamConstraints[] {
  const size = { width: { ideal: 640 }, height: { ideal: 480 } };
  const ladder: MediaStreamConstraints[] = [];
  if (deviceId) ladder.push({ audio: false, video: { deviceId: { exact: deviceId }, ...size } });
  ladder.push({ audio: false, video: size });
  // A phone's rear camera is the right one to show an item to.  A laptop has no
  // such thing, so this is a rung rather than the first request.
  ladder.push({ audio: false, video: { ...size, facingMode: { ideal: 'environment' } } });
  ladder.push({ audio: false, video: true });
  return ladder;
}

export async function openCameraStream(
  media: CameraMedia,
  deviceId?: string | null,
): Promise<CameraStream> {
  const ladder = cameraLadder(deviceId);
  let lastError: unknown = null;
  for (let rung = 0; rung < ladder.length; rung += 1) {
    try {
      const stream = await media.getUserMedia(ladder[rung]);
      const usedDeviceId = rung === 0 && Boolean(deviceId);
      return { stream, rung, usedDeviceId };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('no camera would open');
}

/**
 * Chrome's errors, in words a visitor can act on.
 *
 * The default text for the reported failure is *"Timeout starting video
 * source"*, which tells nobody anything.  Each of these is a different fix.
 */
export function cameraErrorMessage(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : '';
  const text = cause instanceof Error ? cause.message : String(cause ?? '');
  if (name === 'NotAllowedError' || /permission/i.test(text)) {
    return 'The browser is not allowed to use the camera. Allow camera access for this page (the padlock in the address bar), then press Start Camera again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera answered. Check it is plugged in, then press Start Camera again.';
  }
  if (name === 'TimeoutError') {
    return 'The camera opened but never sent a picture. Choose another camera from the list, or close anything else that films (a virtual camera, or another tab), then press Start Camera again.';
  }
  if (/Timeout starting video source|Could not start video source|NotReadableError/i.test(text) || name === 'NotReadableError') {
    return 'The camera opened but sent no picture. Another app is probably using it — close Zoom, Teams or the Camera app (and any other browser tab showing the camera), then press Start Camera again.';
  }
  if (/device in use|TrackStartError/i.test(text)) {
    return 'Another program is using the camera. Close it and press Start Camera again.';
  }
  return `The camera could not start: ${text || 'unknown reason'}.`;
}

/**
 * Wait until the stream is really producing pictures.
 *
 * `getUserMedia` can hand back a live stream from a device that then delivers
 * nothing -- a virtual camera, a wedged driver, a device another program is
 * holding half-open.  The video element then stays black and the page looks
 * "not loading" with no error at all, which is impossible to act on.  Four
 * seconds is well past the first frame of any working camera.
 */
export async function waitForFrames(
  video: { videoWidth: number; videoHeight: number },
  timeoutMs = 4000,
  stepMs = 100,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (video.videoWidth > 0 && video.videoHeight > 0) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}
