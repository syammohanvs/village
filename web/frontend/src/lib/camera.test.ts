import { describe, expect, it, vi } from 'vitest';
import { cameraErrorMessage, cameraLadder, openCameraStream, waitForFrames } from './camera';

const stream = { id: 'fake-stream' } as unknown as MediaStream;

describe('cameraLadder', () => {
  it('never asks a laptop for a rear camera first', () => {
    const ladder = cameraLadder(null);
    const first = ladder[0].video as MediaTrackConstraints;
    expect(first.facingMode).toBeUndefined();
    expect(first.width).toEqual({ ideal: 640 });
    // The environment hint is still there, one rung down, for a phone.
    expect(JSON.stringify(ladder)).toContain('environment');
  });

  it('tries the chosen camera first, and still has a way out', () => {
    const ladder = cameraLadder('cam-7');
    expect((ladder[0].video as MediaTrackConstraints).deviceId).toEqual({ exact: 'cam-7' });
    expect(ladder.length).toBeGreaterThan(1);
    // The last rung asks for nothing at all, which cannot be over-constrained.
    expect(ladder[ladder.length - 1].video).toBe(true);
  });
});

describe('openCameraStream', () => {
  it('opens on the first rung when the chosen camera works', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const opened = await openCameraStream({ getUserMedia }, 'cam-7');
    expect(opened.rung).toBe(0);
    expect(opened.usedDeviceId).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('falls back when a remembered deviceId no longer exists', async () => {
    // Reported as "The camera could not start: Timeout starting video source":
    // the exact-id request failed and nothing else was tried.
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('no such device'), { name: 'OverconstrainedError' }))
      .mockResolvedValue(stream);
    const opened = await openCameraStream({ getUserMedia }, 'gone-camera');
    expect(opened.stream).toBe(stream);
    expect(opened.usedDeviceId).toBe(false);
    expect(getUserMedia.mock.calls.length).toBeGreaterThan(1);
  });

  it('keeps trying when the rear-camera hint is the thing that fails', async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new Error('busy'))
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValue(stream);
    const opened = await openCameraStream({ getUserMedia }, null);
    expect(opened.stream).toBe(stream);
  });

  it('reports the last failure when nothing opens', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('Timeout starting video source'));
    await expect(openCameraStream({ getUserMedia })).rejects.toThrow(/Timeout starting video source/);
    expect(getUserMedia).toHaveBeenCalledTimes(cameraLadder(null).length);
  });
});

describe('cameraErrorMessage', () => {
  it('turns the reported timeout into something actionable', () => {
    const message = cameraErrorMessage(new Error('Timeout starting video source'));
    expect(message).toMatch(/another app is probably using it/i);
    expect(message).toMatch(/close zoom/i);
  });

  it('separates a permission refusal from a busy camera', () => {
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    expect(cameraErrorMessage(denied)).toMatch(/not allowed to use the camera/i);
    const busy = Object.assign(new Error('device in use'), { name: 'NotReadableError' });
    expect(cameraErrorMessage(busy)).toMatch(/another app is probably using it/i);
  });

  it('keeps an unknown failure readable', () => {
    expect(cameraErrorMessage(new Error('weird'))).toMatch(/could not start: weird/);
  });
});

describe('waitForFrames', () => {
  it('accepts a camera that delivers a picture at once', async () => {
    expect(await waitForFrames({ videoWidth: 640, videoHeight: 480 }, 50, 10)).toBe(true);
  });

  it('accepts one that starts a moment later', async () => {
    let polls = 0;
    const video = {
      get videoWidth() {
        polls += 1;
        return polls > 3 ? 640 : 0;
      },
      videoHeight: 480,
    };
    expect(await waitForFrames(video, 2000, 5)).toBe(true);
  });

  it('gives up on a stream that never sends a frame', async () => {
    // The reported "camera is not loading": a live stream, a black preview, and
    // nothing on screen to explain it.
    expect(await waitForFrames({ videoWidth: 0, videoHeight: 0 }, 60, 10)).toBe(false);
  });
});

describe('the message for a silent stream', () => {
  it('names the device list instead of blaming another app', async () => {
    const silent = Object.assign(new Error('the camera opened but sent no picture'), { name: 'TimeoutError' });
    const message = cameraErrorMessage(silent);
    expect(message).toMatch(/never sent a picture/i);
    expect(message).toMatch(/choose another camera/i);
  });
});
