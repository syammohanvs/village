export type Mode = 'live' | 'demo';

export type SoilState = 'dry' | 'adequate' | 'wet' | 'uncalibrated' | 'unavailable';
export type ReservoirState = 'available' | 'low' | 'uncalibrated' | 'unavailable';
export type Brightness = 'bright' | 'dark' | 'unknown';
export type BinState = 'available' | 'nearly_full' | 'full' | 'unavailable' | 'not_installed';

export interface Connection {
  connected: boolean;
  stale: boolean;
  age_ms: number | null;
  last_success_at: string | null;
  last_error: string | null;
  boot_id: string | null;
  device_id: string | null;
  reconnects: number;
}

export interface SoilReading {
  valid: boolean;
  calibrated: boolean;
  raw: number | null;
  percent: number | null;
  state: SoilState;
  age_ms: number | null;
  fault: string | null;
}

export interface ReservoirReading {
  valid: boolean;
  calibrated: boolean;
  state: ReservoirState;
  millivolts: number | null;
  conductive: boolean | null;
  age_ms: number | null;
  fault: string | null;
}

export interface LightReading {
  valid: boolean;
  raw: number | null;
  brightness: Brightness;
  output_type?: string;
  age_ms: number | null;
  fault: string | null;
}

export interface BinReading {
  id: 'organic' | 'plastic' | 'paper' | string;
  installed: boolean;
  valid: boolean;
  distance_cm: number | null;
  fill_pct_estimate: number | null;
  state: BinState;
  age_ms: number | null;
  fault: string | null;
  near_blind_zone?: boolean;
}

export interface Sensors {
  soil?: SoilReading;
  reservoir?: ReservoirReading;
  light?: LightReading;
  bins?: BinReading[];
}

export interface PumpState {
  commanded: boolean;
  commissioned: boolean;
  feedback?: string;
}

export interface StreetlightState {
  mode: 'auto' | 'manual' | 'unknown' | string;
  commanded: boolean;
  led_count: number;
  installed: boolean;
  feedback?: string;
}

export interface WasteIndicatorState {
  category: 'organic' | 'plastic' | 'paper' | null;
  active: boolean;
  remaining_ms: number;
}

export interface IrrigationState {
  auto_enabled: boolean;
  state: 'idle' | 'pumping' | 'soaking' | 'cooldown' | 'blocked' | string;
  session: 'none' | 'auto' | 'manual' | string;
  pulses_done: number;
  pulse_limit: number;
  cumulative_pump_ms: number;
  max_cumulative_pump_ms: number;
  cooldown_remaining_ms: number;
  reason_code: string;
  reason: string;
  last_session?: unknown;
}

export interface DeviceEvent {
  at_uptime_ms?: number;
  code?: string;
  text: string;
  level?: string;
}

export interface DeviceStatus {
  protocol_version: number;
  device_id: string;
  boot_id: string;
  uptime_ms: number;
  sample_seq: number;
  config_revision: number;
  sensors: Sensors;
  actuators: {
    pump?: PumpState;
    streetlights?: StreetlightState;
    waste_indicator?: WasteIndicatorState;
  };
  irrigation: IrrigationState;
  faults?: (string | { code?: string; text?: string })[];
  recent_events?: DeviceEvent[];
}

export interface SourceInfo {
  kind: string;
  label: string;
}

export interface StateEnvelope {
  mode: Mode;
  physical: boolean;
  source: SourceInfo;
  server_time: string;
  connection: Connection;
  status: DeviceStatus | null;
  simulator?: Record<string, unknown> | null;
  demo?: Record<string, unknown> | null;
}

export interface SoilConfig {
  dry_raw: number;
  wet_raw: number;
  min_span_raw: number;
  samples?: number;
  max_age_ms?: number;
  calibrated?: boolean;
}

export interface ReservoirConfig {
  wet_threshold_mv: number;
  dry_threshold_mv: number;
  confirm_readings?: number;
  max_age_ms?: number;
  calibrated?: boolean;
}

export interface LightConfig {
  installed: boolean;
  output_type: 'analog' | 'digital' | string;
  analog_bright_high: boolean;
  digital_dark_when_high: boolean;
  dark_threshold: number;
  bright_threshold: number;
  stable_ms?: number;
  max_age_ms?: number;
}

export interface BinConfig {
  id: string;
  installed: boolean;
  empty_cm: number;
  full_cm: number;
  near_full_pct: number;
  full_pct: number;
  median_samples?: number;
  confirm_readings?: number;
  timeout_us?: number;
  blind_zone_cm?: number;
  max_range_cm?: number;
}

export interface IrrigationConfig {
  auto_enabled: boolean;
  pump_enabled: boolean;
  dry_start_pct: number;
  stop_pct: number;
  dry_confirm_ms: number;
  pulse_ms: number;
  max_pulse_ms: number;
  soak_ms: number;
  max_cumulative_ms: number;
  max_pulses: number;
  cooldown_ms: number;
  link_timeout_ms: number;
}

export interface WasteConfig {
  indicate_ms: number;
}

export interface DeviceConfig {
  soil: SoilConfig;
  reservoir: ReservoirConfig;
  light: LightConfig;
  bins: BinConfig[];
  irrigation: IrrigationConfig;
  waste: WasteConfig;
}

export interface DeviceConfigDocument {
  protocol_version?: number;
  device_id?: string;
  config_revision: number;
  config: DeviceConfig;
  connection?: Connection;
}

export interface CommandAck {
  protocol_version?: number;
  command_id?: string;
  type?: string;
  result?: 'ACCEPTED' | 'REJECTED' | 'DUPLICATE' | string;
  reason_code?: string;
  reason?: string;
  at_uptime_ms?: number;
  irrigation?: Record<string, unknown>;
}

export interface CommandResponse {
  confirmed: boolean;
  mode: Mode;
  physical: boolean;
  ack: CommandAck | null;
  error: { code: string; message: string } | null;
  duplicate_request?: boolean;
  state?: unknown;
}

export interface ActivityEvent {
  id?: number | string;
  at?: string;
  created_at?: string;
  timestamp?: string;
  kind?: string;
  type?: string;
  code?: string;
  text?: string;
  message?: string;
  detail?: string;
  result?: string;
  mode?: Mode;
  source?: string;
  command?: string;
}

export interface EventsResponse {
  events?: ActivityEvent[];
  items?: ActivityEvent[];
  retention_days?: number;
  retention?: string;
  total?: number;
}

export interface AppSettings {
  language: 'en' | 'ml' | 'hi' | string;
  tts_enabled: boolean;
  waste_model_path: string;
  camera_device_id: string | null;
  waste_confidence: number;
  waste_stability_frames: number;
  waste_cooldown_ms: number;
  demo_mode?: boolean;
  updated_at?: string;
}

export interface ModelStatus {
  installed?: boolean;
  available?: boolean;
  present?: boolean;
  path?: string;
  model_path?: string;
  missing?: string[];
  files?: string[];
  classes?: string[];
  message?: string;
}

export interface WasteRecognitionResult {
  ok?: boolean;
  recognition?: { id: number | string; category?: string; confidence?: number };
  recognition_id?: number | string;
  category?: string;
  indicator?: { category?: string; active?: boolean; remaining_ms?: number };
  bin?: { id?: string; state?: BinState; fill_pct_estimate?: number | null };
  alert?: string | null;
  message?: string;
}

export interface VoiceLanguage {
  code: 'en' | 'ml' | 'hi' | string;
  label: string;
  whisper?: string;
  available?: boolean;
}

export interface VoiceIntent {
  id: string;
  command?: string | null;
  actuation?: boolean;
  label: Record<string, string> | string;
  phrases?: Record<string, string[]> | string[];
}

export interface VoiceIntentsResponse {
  version?: number;
  languages?: VoiceLanguage[];
  intents?: VoiceIntent[];
  help_order?: string[];
  unknown?: string | Record<string, string>;
  no_speech?: string | Record<string, string>;
  pending?: string | Record<string, string>;
}

export interface VoiceTranscribeResponse {
  status?: string;
  intent?: string | null;
  command?: string | null;
  actuation?: boolean;
  text?: string;
  transcript?: string;
  message?: string;
  confidence?: number;
  language?: string;
  matched_phrase?: string;
  available?: boolean;
}

export interface VoiceReadiness {
  ready?: boolean;
  whisper?: {
    ready?: boolean;
    model?: string;
    path?: string;
    message?: string;
    installed?: boolean;
  };
  audio_assets?: { ready?: boolean; languages?: string[]; missing?: string[] };
  languages?: VoiceLanguage[];
  unavailable_languages?: string[];
  message?: string;
}

export interface ChecklistItem {
  id?: string;
  key?: string;
  label: string;
  ok?: boolean;
  status?: 'ok' | 'warn' | 'fail' | string;
  detail?: string;
  message?: string;
}

export interface SetupChecklist {
  items?: ChecklistItem[];
  checks?: ChecklistItem[];
  ready?: boolean;
  complete?: boolean;
  message?: string;
}

export interface HealthResponse {
  ok?: boolean;
  status?: string;
  app_version?: string;
  version?: string;
  device?: {
    mode?: string;
    url?: string;
    reachable?: boolean;
    connected?: boolean;
    message?: string;
    source?: SourceInfo;
  };
  device_mode?: string;
  device_url?: string;
  connected?: boolean;
  stale?: boolean;
  services?: Record<string, unknown>;
  whisper?: Record<string, unknown>;
  waste_model?: Record<string, unknown>;
  server_time?: string;
}

export interface DeviceHealthResponse {
  ok?: boolean;
  reachable?: boolean;
  device_id?: string;
  boot_id?: string;
  firmware?: string;
  uptime_ms?: number;
  wifi?: { ssid?: string; ip?: string; rssi?: number; mode?: string };
  pump_commissioned?: boolean;
  message?: string;
  error?: string;
}

export interface Profile {
  id?: number | string;
  name: string;
  house_no?: string;
  house?: string;
  avatar?: string;
  points?: number;
  history?: { at?: string; category?: string; points?: number; item?: string }[];
  last_category?: string;
  updated_at?: string;
}

export interface ProfilesResponse {
  profiles?: Profile[];
  items?: Profile[];
}
