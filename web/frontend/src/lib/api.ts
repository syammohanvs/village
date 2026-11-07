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

const PREFIX = '/api/v1';

let activeMode: Mode = 'live';

export function setApiMode(mode: Mode): void {
  activeMode = mode;
}

export function getApiMode(): Mode {
  return activeMode;
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
  const url = withMode(`${PREFIX}${path}`, mode);
  const headers: Record<string, string> = { Accept: 'application/json' };
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

  deviceConfig(): Promise<DeviceConfigDocument> {
    return request<DeviceConfigDocument>('/device/config');
  },

  putDeviceConfig(revision: number, config: DeviceConfig): Promise<DeviceConfigDocument> {
    return request<DeviceConfigDocument>('/device/config', {
      method: 'PUT',
      body: { mode: activeMode, config_revision: revision, config },
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

  postRecognition(input: {
    category: string;
    confidence: number;
    model?: string;
    requestId?: string;
  }): Promise<WasteRecognitionResult> {
    return request<WasteRecognitionResult>('/waste/recognition', {
      method: 'POST',
      body: {
        mode: activeMode,
        category: input.category,
        confidence: input.confidence,
        model: input.model ?? 'teachable-machine',
        request_id: input.requestId ?? newRequestId(),
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
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error ?? 'Unknown error');
}
