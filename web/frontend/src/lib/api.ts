import { localVillage } from './localVillage';
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

/**
 * There is no village service: show the built-in demo instead of an error.
 *
 * The page is then a look at the exhibit with invented readings, which is what
 * a student opening the hosted copy needs.  It is announced (`Demo copy`) and
 * locked to Simulation - an invented village must never pass for the board's.
 */
function enterLocalDemo() {
  localMode = true;
  setApiMode('demo');
  try {
    window.localStorage.setItem('village.demoMode', 'demo');
  } catch {
    /* storage can be unavailable in private modes */
  }
  return {
    authenticated: true,
    username: 'demo',
    auth_enabled: true,
    guest: true,
  };
}

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

/**
 * True once the page has decided there is no village service behind it.
 *
 * That is the hosted copy (Cloudflare Pages): a static bundle with no backend.
 * The visitor page then runs on `localVillage` — a small simulation — and both
 * the page and the app say so.  It is never true on the exhibit laptop, whose
 * backend answers `/auth/session`.
 */
let localMode = false;

export function isLocalDemo(): boolean {
  return localMode;
}

/** What each endpoint answers when there is no backend. */
function localRequest<T>(path: string, options: RequestOptions): T {
  const method = options.method ?? 'GET';
  const body = (options.body ?? {}) as Record<string, unknown>;
  const mode = options.mode ?? activeMode;

  if (method === 'GET') {
    switch (path) {
      case '/state':
        return localVillage.frame(mode) as T;
      case '/events':
        return localVillage.eventsResponse() as T;
      case '/settings':
        return {
          language: 'en',
          tts_enabled: false,
          waste_model_path: '',
          camera_device_id: null,
          waste_confidence: 0.62,
          waste_stability_frames: 4,
          waste_cooldown_ms: 8000,
          updated_at: new Date().toISOString(),
        } as T;
      case '/profiles':
        return { profiles: [] } as T;
      case '/voice/intents':
        return { languages: [], intents: [] } as T;
      case '/voice/readiness':
        return {
          ready: false,
          server_reachable: false,
          whisper: {
            ready: false,
            message: 'This demo copy has no speech service.',
          },
        } as T;
      case '/waste/model-status':
        return { installed: false } as T;
      case '/waste/resnet-status':
        return { installed: false, model: 'not installed', classes: [] } as T;
      default:
        break;
    }
  } else {
    switch (path) {
      case '/commands':
        return localVillage.command(
          String(body.type ?? ''),
          (body.parameters ?? {}) as Record<string, unknown>,
          mode,
        ) as T;
      case '/demo/scenario':
      case '/simulator/scenario':
        return localVillage.scenario(body) as T;
      case '/demo/reset':
        return localVillage.reset() as T;
      default:
        break;
    }
  }

  throw new ApiError(404, 'This demo copy does not provide that.', { code: 'DEMO_ONLY' });
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (localMode) return localRequest<T>(path, options);
  const mode = options.mode ?? activeMode;
  const url = withMode(`${API_BASE}${PREFIX}${path}`, mode);
  const headers: Record<string, string> = { Accept: 'application/json' };
  // A hosted copy's session is a bearer token (see `TOKEN_STORAGE_KEY`).
  const token = getSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  // Same origin: the cookie is the session.  Another origin with a token: no
  // credentials at all, so no third-party cookie is asked for and none is
  // refused.  Another origin without a token: ask for the cookie anyway - a
  // deployment that trusts its origin may still make that work.
  const credentials: RequestCredentials = API_BASE
    ? token
      ? 'omit'
      : 'include'
    : 'same-origin';
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

  wasteResnetStatus(): Promise<{
    installed: boolean;
    model: string;
    classes: string[];
    /** The hosted model that names the object, when one is configured. */
    vision?: {
      provider: string | null;
      model: string | null;
      ready: boolean;
      chain?: number;
      /** Every account/provider in the order it is tried, with its model id. */
      attempts?: Array<{ provider: string; model: string }>;
    };
  }> {
    return request<{
      installed: boolean;
      model: string;
      classes: string[];
      vision?: { provider: string | null; model: string | null; ready: boolean };
    }>('/waste/resnet-status', { mode: undefined });
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
   * Ask the hosted vision model what the object in this crop is.
   *
   * It returns the *name* ("clear plastic lid"), which the page's rules turn
   * into a route — its material word can choose a bin.  It is not the whole
   * answer: the rules check special care and object routes first, and a name
   * with nothing usable falls through to the classifier.
   *
   * `object` is null when nothing was configured or the call failed; `empty` is
   * true only when the model looked and answered "nothing" — an empty scene is a
   * different fact from an unavailable service, and the page treats it as
   * "nothing to sort" rather than falling back.
   */
  wasteIdentify(
    image: string,
    language: 'en' | 'hi' | 'ml' = 'en',
  ): Promise<{
    object: string | null;
    /** The same name in the page's language, when the translator answered. */
    object_local?: string | null;
    /** The model saw no object.  A distinct outcome from a failed call. */
    empty?: boolean;
    provider: string | null;
    model: string | null;
    ms: number;
    reason?: string;
  }> {
    return request<{
      object: string | null;
      object_local?: string | null;
      empty?: boolean;
      provider: string | null;
      model: string | null;
      ms: number;
      reason?: string;
    }>('/waste/identify', {
      method: 'POST',
      body: { image, language },
      mode: undefined,
    });
  },

  /**
   * Put every bin LED out before a new item is checked.
   *
   * The board switches a lit LED off by itself after `indicate_ms` (8 s); this
   * makes the same thing happen at the start of a check, so the previous item's
   * lamp cannot sit above the new answer.  The answer does not depend on it: a
   * controller that refuses is reported, not thrown.
   */
  wasteClear(requestId?: string): Promise<{
    cleared: boolean;
    confirmed: boolean;
    ack?: { result?: string; reason?: string } | null;
    note?: string | null;
  }> {
    return request('/waste/clear', {
      method: 'POST',
      body: { mode: activeMode, request_id: requestId ?? newRequestId() },
    });
  },

  /**
   * File this crop under the class the hosted model named.
   *
   * The booth's offline model is the fallback for a lost connection, so every
   * named item is a training photo the venue did not have before.  Best effort:
   * the page ignores the answer, and a failure must never fail the press.
   */
  wasteTeach(
    image: string,
    label: string,
    said = '',
    model = '',
  ): Promise<{ saved: boolean; file?: string; label?: string; reason?: string }> {
    return request<{ saved: boolean; file?: string; label?: string; reason?: string }>(
      '/waste/teach',
      { method: 'POST', body: { image, label, said, model }, mode: undefined },
    );
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
    /**
     * The **local classifier's** top probability — not a confidence in the
     * answer.  It is 0 when the classifier returned nothing, and it is kept
     * apart from a decision the hosted name made (`source`).
     */
    confidence: number;
    model?: string;
    requestId?: string;
    /** What the classifier read, and its best few guesses. */
    material?: string | null;
    top?: Array<{ className: string; probability: number }> | null;
    /** The hosted model's words for the item, when one answered. */
    item?: string | null;
    /** The route this check actually decided (`bin.plastic`, `collect.metal`, …). */
    route?: string | null;
    /** Which reader decided: the hosted name, or the classifier alone. */
    source?: 'vision' | 'local' | null;
    /** The hosted model that supplied the name, for the record. */
    namer?: string | null;
  }): Promise<WasteRecognitionResult> {
    return request<WasteRecognitionResult>('/waste/recognition', {
      method: 'POST',
      body: {
        mode: activeMode,
        category: input.category,
        confidence: input.confidence,
        model: input.model ?? 'resnet50',
        request_id: input.requestId ?? newRequestId(),
        material: input.material ?? null,
        top: input.top ?? null,
        item: input.item ?? null,
        route: input.route ?? null,
        source: input.source ?? null,
        namer: input.namer ?? null,
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
  async session(): Promise<{
    authenticated: boolean;
    username: string | null;
    auth_enabled: boolean;
    guest?: boolean;
  }> {
    try {
      const answer = await request<{
        authenticated?: boolean;
        username?: string | null;
        auth_enabled?: boolean;
        guest?: boolean;
      }>('/auth/session', { mode: undefined });
      // A static host answers with its own index.html (or a 404 page) rather
      // than a session; anything that is not an answer means no backend.
      if (!answer || typeof answer.authenticated !== 'boolean') {
        return enterLocalDemo();
      }
      return answer as { authenticated: boolean; username: string | null; auth_enabled: boolean };
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      const status = error instanceof ApiError ? error.status : 0;
      // `503 API_ORIGIN_MISSING` is this deployment's own Worker answering: it
      // proxies /api/* to a backend whose address has not been configured.  No
      // backend, so the built-in demo is the honest page (502/504 included:
      // those are a gateway with nothing behind it).
      const noBackend =
        code === 'NETWORK' ||
        code === 'API_ORIGIN_MISSING' ||
        status === 404 ||
        status === 502 ||
        status === 503 ||
        status === 504;
      if (noBackend) return enterLocalDemo();
      throw error;
    }
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
