import type {
  AppSettings,
  CommandResponse,
  DeviceConfig,
  DeviceConfigDocument,
  DeviceHealthResponse,
  EventsResponse,
  HealthResponse,
  Mode,
  ModelStatus,
  ProfilesResponse,
  SetupChecklist,
  StateEnvelope,
  VoiceIntentsResponse,
  VoiceReadiness,
  VoiceTranscribeResponse,
  WasteRecognitionResult,
} from '../types';

// Where the backend lives.  By default the page talks to the same origin that
// served it (the exhibit's normal case: one laptop, one port).  A deployment
// that only serves the built SPA (Cloudflare Pages) can be aimed at a backend
// by setting VITE_API_BASE_URL at build time, or at runtime with `?api=https://…`
// once — the choice is remembered in localStorage (`village.apiBase`).  That is
// what lets a shared build point at a tunneled village without a rebuild.
const API_BASE_STORAGE_KEY = 'village.apiBase';

function readApiBase(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('api');
    if (fromQuery) {
      const cleaned = fromQuery.replace(/\/$/, '');
      window.localStorage.setItem(API_BASE_STORAGE_KEY, cleaned);
      // Keep the URL clean so a refresh does not re-apply it.
      params.delete('api');
      const next = `${window.location.pathname}${
        params.toString() ? '?' + params.toString() : ''
      }${window.location.hash}`;
      window.history.replaceState({}, '', next);
      return cleaned;
    }
  } catch {
    /* ignore — the page may be rendered in an environment without a URL */
  }
  const fromEnv = (import.meta.env as Record<string, string | undefined>).VITE_API_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const fromStorage = window.localStorage.getItem(API_BASE_STORAGE_KEY);
  if (fromStorage) return fromStorage.replace(/\/$/, '');
  return '';
}

const API_BASE = readApiBase();
const PREFIX = '/api/v1';

// The signed session, for a page that is not on the backend's origin.
//
// Same origin, the cookie is the session and this is never written.  On the
// hosted copy (Cloudflare Pages) the browser refuses a third-party cookie, so
// the sign-in and the share link hand back the same signed token and it lives
// here instead.  It is not a password: changing the password re-signs every
// session, which retires it.
const TOKEN_STORAGE_KEY = 'village.sessionToken';

export function setSessionToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* storage can be unavailable in private modes */
  }
}

export function getSessionToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * `?share=<key>` is how a hosted copy opens a visit link.
 *
 * It is read (and taken out of the address) at sign-in time rather than at
 * import time, because the exchange is one request and the page needs to be
 * mounted to show the result.  `?api=` is handled with the base URL above.
 */
export function takePendingShareKey(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const key = params.get('share');
    if (!key) return null;
    params.delete('share');
    const query = params.toString();
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    );
    return key;
  } catch {
    return null;
  }
}

let activeMode: Mode = 'live';

export function getApiBase(): string {
  return API_BASE;
}

export function setApiMode(mode: Mode): void {
  activeMode = mode;
}

export function getApiMode(): Mode {
  return activeMode;
}

/**
 * The share link, as the backend describes it: the direct one (its own origin)
 * and the key, which a hosted page composes its own link from.
 */
export interface ShareLink {
  enabled: boolean;
  guest: string;
  key?: string;
  url: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly confirmed?: boolean;
  readonly body?: unknown;

  constructor(
    status: number,
    message: string,
    options: { code?: string; confirmed?: boolean; body?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = options.code;
    this.confirmed = options.confirmed;
    this.body = options.body;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  form?: FormData;
  mode?: Mode;
  signal?: AbortSignal;
}

function withMode(path: string, mode: Mode | undefined): string {
  if (!mode) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}mode=${encodeURIComponent(mode)}`;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describeError(status: number, body: unknown, statusText: string): { message: string; code?: string } {
  if (typeof body === 'string' && body.trim()) {
    return { message: body.trim() };
  }
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const error = record.error;
    if (typeof error === 'string' && error.trim()) {
      return { message: error, code: typeof record.code === 'string' ? record.code : undefined };
    }
    if (error && typeof error === 'object') {
      const detail = error as Record<string, unknown>;
      return {
        message: typeof detail.message === 'string' ? detail.message : statusText,
        code: typeof detail.code === 'string' ? detail.code : undefined,
      };
    }
    if (typeof record.message === 'string') {
      return {
        message: record.message,
        code: typeof record.code === 'string' ? record.code : undefined,
      };
    }
    if (typeof record.detail === 'string') {
      return { message: record.detail };
    }
  }
  return { message: statusText || `Request failed with status ${status}` };
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const mode = options.mode ?? activeMode;
  const url = withMode(`${API_BASE}${PREFIX}${path}`, mode);
  // Cookies only travel cross-origin when asked for; same-origin never needs it.
  const credentials: RequestCredentials = API_BASE ? 'include' : 'same-origin';
  const headers: Record<string, string> = { Accept: 'application/json' };
  // A hosted copy's session is a bearer token (see `TOKEN_STORAGE_KEY`).
  const token = getSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;

  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: options.signal,
      credentials,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(
      0,
      'Cannot reach the village service on this laptop. Is the backend running?',
      { code: 'NETWORK', body: cause },
    );
  }

  const parsed = await readBody(response);
  if (response.status === 401 && !path.startsWith('/auth/login')) {
    window.dispatchEvent(new Event('village:unauthorised'));
  }
  if (!response.ok) {
    const { message, code } = describeError(response.status, parsed, response.statusText);
    const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    throw new ApiError(response.status, message, {
      code,
      confirmed: typeof record.confirmed === 'boolean' ? record.confirmed : undefined,
      body: parsed,
    });
  }
  return parsed as T;
}

function newRequestId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export const api = {
  newRequestId,

  systemHealth(): Promise<HealthResponse> {
    return request<HealthResponse>('/system/health', { mode: undefined });
  },

  deviceHealth(): Promise<DeviceHealthResponse> {
    return request<DeviceHealthResponse>('/device/health', { mode: activeMode });
  },

  state(mode?: Mode): Promise<StateEnvelope> {
    return request<StateEnvelope>('/state', { mode });
  },

  sendCommand(input: {
    type: string;
    parameters?: Record<string, unknown>;
    source?: 'browser' | 'voice' | 'system';
    requestId?: string;
    mode?: Mode;
  }): Promise<CommandResponse> {
    const mode = input.mode ?? activeMode;
    return request<CommandResponse>('/commands', {
      method: 'POST',
      mode,
      body: {
        mode,
        type: input.type,
        parameters: input.parameters ?? {},
        request_id: input.requestId ?? newRequestId(),
        source: input.source ?? 'browser',
      },
    });
  },

  /**
   * `voice` is English only: "sara" (American, the same speaker as hi/ml) or
   * "indian" (the neural Indian voice).  The server ignores it elsewhere.
   */
  async speak(
    text: string,
    language: string,
    lengthScale = 1,
    voice?: 'sara' | 'indian',
  ): Promise<Blob> {
    const url = withMode(`${PREFIX}/voice/speak`, activeMode);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
        body: JSON.stringify({
          text,
          language,
          length_scale: lengthScale,
          ...(voice ? { voice } : {}),
        }),
      });
    } catch (cause) {
      throw new ApiError(0, 'Cannot reach the village service on this laptop.', {
        code: 'NETWORK',
        body: cause,
      });
    }
    if (!response.ok) {
      let message = `Speech request failed with status ${response.status}`;
      try {
        const payload = (await response.json()) as { error?: { message?: string } };
        message = payload.error?.message ?? message;
      } catch {
        /* keep the status text */
      }
      throw new ApiError(response.status, message);
    }
    return response.blob();
  },

  deviceConfig(mode: Mode = activeMode): Promise<DeviceConfigDocument> {
    // The mode is passed explicitly by the caller as well as defaulting here:
    // when the Simulation switch flips, the child's fetch and the provider's
    // setApiMode happen in the same commit, so the explicit value is the only
    // one that cannot race.
    return request<DeviceConfigDocument>('/device/config', { mode });
  },

  putDeviceConfig(revision: number, config: DeviceConfig, mode: Mode = activeMode): Promise<DeviceConfigDocument> {
    return request<DeviceConfigDocument>('/device/config', {
      method: 'PUT',
      body: { mode, config_revision: revision, config },
    });
  },

  calibrateSoil(dryRaw: number, wetRaw: number): Promise<unknown> {
    return request('/calibration/soil', {
      method: 'POST',
      body: { mode: activeMode, dry_raw: dryRaw, wet_raw: wetRaw },
    });
  },

  calibrateReservoir(dryThresholdMv: number, wetThresholdMv: number): Promise<unknown> {
    return request('/calibration/reservoir', {
      method: 'POST',
      body: {
        mode: activeMode,
        dry_threshold_mv: dryThresholdMv,
        wet_threshold_mv: wetThresholdMv,
      },
    });
  },

  events(limit = 100): Promise<EventsResponse> {
    return request<EventsResponse>(`/events?limit=${limit}`);
  },

  wasteModelStatus(): Promise<ModelStatus> {
    return request<ModelStatus>('/waste/model-status', { mode: undefined });
  },

  wasteResnetStatus(): Promise<{ installed: boolean; model: string; classes: string[] }> {
    return request<{ installed: boolean; model: string; classes: string[] }>(
      '/waste/resnet-status',
      { mode: undefined },
    );
  },

  wasteClassify(image: string): Promise<{
    model: string;
    predictions: { className: string; probability: number }[];
    /** The crop the backend kept, so a correction can point at this exact frame. */
    file?: string | null;
  }> {
    return request<{
      model: string;
      predictions: { className: string; probability: number }[];
      file?: string | null;
    }>('/waste/classify', { method: 'POST', body: { image }, mode: undefined });
  },

  /**
   * Tell the backend what the item really was.  The crop is copied into the
   * training tree, so a mistake at the venue becomes a training photo.
   */
  wasteCorrect(file: string, actual: 'organic' | 'plastic' | 'paper' | 'separate'): Promise<{
    file: string;
    actual: string;
    saved_as: string;
  }> {
    return request<{ file: string; actual: string; saved_as: string }>('/waste/correction', {
      method: 'POST',
      body: { file, actual },
      mode: undefined,
    });
  },

  postRecognition(input: {
    category: string;
    confidence: number;
    model?: string;
    requestId?: string;
    /** What the model named. A recycler is posted as "other", so this is the
     *  only record of the material the visitor was shown. */
    material?: string | null;
    /** The best few guesses, for a session that has to be reviewed later. */
    top?: Array<{ className: string; probability: number }> | null;
  }): Promise<WasteRecognitionResult> {
    return request<WasteRecognitionResult>('/waste/recognition', {
      method: 'POST',
      body: {
        mode: activeMode,
        category: input.category,
        confidence: input.confidence,
        model: input.model ?? 'teachable-machine',
        request_id: input.requestId ?? newRequestId(),
        material: input.material ?? null,
        top: input.top ?? null,
      },
    });
  },

  postDisposal(recognitionId: number | string, note = ''): Promise<unknown> {
    return request('/waste/disposals', {
      method: 'POST',
      body: { mode: activeMode, recognition_id: Number(recognitionId), note },
    });
  },

  profiles(): Promise<ProfilesResponse> {
    return request<ProfilesResponse>('/profiles', { mode: undefined });
  },

  voiceInterpret(text: string, language: string): Promise<VoiceTranscribeResponse> {
    // Typed and spoken requests share one parser, so a keyboard user cannot get
    // a different answer from the microphone user.
    return request<VoiceTranscribeResponse>('/voice/interpret', {
      method: 'POST',
      body: { text, language, source: 'typed' },
    });
  },

  voiceTranscribe(audio: Blob, language: string): Promise<VoiceTranscribeResponse> {
    const form = new FormData();
    form.append('audio', audio, 'command.wav');
    form.append('language', language);
    form.append('mode', activeMode);
    return request<VoiceTranscribeResponse>('/voice/transcribe', {
      method: 'POST',
      form,
    });
  },

  voiceIntents(language: string): Promise<VoiceIntentsResponse> {
    return request<VoiceIntentsResponse>(
      `/voice/intents?language=${encodeURIComponent(language)}`,
      { mode: undefined },
    );
  },

  voiceReadiness(): Promise<VoiceReadiness> {
    return request<VoiceReadiness>('/voice/readiness', { mode: undefined });
  },

  setupChecklist(): Promise<SetupChecklist> {
    return request<SetupChecklist>('/setup/checklist', { mode: undefined });
  },

  settings(): Promise<AppSettings> {
    return request<{ settings: AppSettings }>('/settings', { mode: undefined }).then(
      (response) => response.settings,
    );
  },

  putSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return request<{ settings: AppSettings }>('/settings', {
      method: 'PUT',
      body: patch,
    }).then((response) => response.settings);
  },

  demoScenario(scenario: Record<string, unknown>): Promise<unknown> {
    return request('/demo/scenario', { method: 'POST', body: scenario });
  },

  demoReset(): Promise<unknown> {
    return request('/demo/reset', { method: 'POST', body: {} });
  },

  /** Who am I, and is the gate even on? */
  session(): Promise<{
    authenticated: boolean;
    username: string | null;
    auth_enabled: boolean;
    guest?: boolean;
  }> {
    return request('/auth/session', { mode: undefined });
  },

  /**
   * The link an operator hands to a student: opening it signs in as a
   * Simulation-only visitor, with no password.  Reading it needs the account.
   */
  shareLink(): Promise<ShareLink> {
    return request('/auth/share-link', { mode: undefined });
  },

  /** A new link; every copy handed out before this stops opening the app. */
  newShareLink(): Promise<ShareLink> {
    return request('/auth/share-link', { method: 'POST', body: {}, mode: undefined });
  },

  async login(
    username: string,
    password: string,
  ): Promise<{ authenticated: boolean; username: string; token?: string }> {
    const answer = await request<{
      authenticated: boolean;
      username: string;
      token?: string;
    }>('/auth/login', {
      method: 'POST',
      body: { username, password },
      mode: undefined,
    });
    // Kept for a page on another origin, where the cookie will be refused.
    if (answer.token) setSessionToken(answer.token);
    return answer;
  },

  /**
   * Exchange a share key for a guest session.  This is the hosted copy's half
   * of `/auth/magic`: the redirect form would navigate off the hosted page.
   */
  async shareLogin(key: string): Promise<{ authenticated: boolean; guest?: boolean; token?: string }> {
    const answer = await request<{
      authenticated: boolean;
      username: string;
      guest?: boolean;
      token?: string;
    }>('/auth/magic', { method: 'POST', body: { key }, mode: undefined });
    if (answer.token) setSessionToken(answer.token);
    return answer;
  },

  async logout(): Promise<unknown> {
    try {
      return await request('/auth/logout', { method: 'POST', body: {}, mode: undefined });
    } finally {
      setSessionToken(null);
    }
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error ?? 'Unknown error');
}
