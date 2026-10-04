/**
 * Admin: TTS providers, their order and voices (worker/src/routes/audio-settings.ts)
 * and the clip backlog (worker/src/routes/audio-backfill.ts). docs/AUDIO.md "Providers".
 */
import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { TtsConfig, TtsProviderId, TtsVoiceOption, TtsVoiceRole } from '@shared/tts';

const API_PATH = `${API_BASE}/api`;

/** An API error that keeps the status and the server's `problems` list (400 on invalid settings). */
export class AudioAdminError extends Error {
  status: number;
  problems: string[];
  rateLimited: boolean;
  constructor(message: string, status: number, problems: string[] = [], rateLimited = false) {
    super(message);
    this.status = status;
    this.problems = problems;
    this.rateLimited = rateLimited;
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_PATH}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw new AudioAdminError('Unauthorized', 401);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; problems?: string[]; rate_limited?: boolean };
    throw new AudioAdminError(body.error || `HTTP ${response.status}`, response.status, body.problems ?? [], !!body.rate_limited);
  }
  return response.json() as Promise<T>;
}

export interface TtsProviderStatus {
  id: TtsProviderId;
  name: string;
  configured: boolean;
  /** Secret names only. */
  missing: string[];
  enabled: boolean;
  available: boolean;
  account_problem: null | {
    code: string | number;
    message: string;
    since: string | null;
    errors_in_a_row: number;
    paused_until: string | null;
    probing: boolean;
  };
  learned_rpm: number | null;
  rpm_cap: number | null;
  last_rate_limited_at: string | null;
  last_success_at: string | null;
  last_error: null | { at: string | null; reason: string };
  last_hour: null | { ok: number; failed: number; rate_limited: number; denied: number };
  region?: string | null;
}

export interface AzureRegionVoices {
  ok: boolean;
  voices?: Array<{ name: string; gender: string; local: string }>;
  error?: string;
}

export interface AudioSettingsView {
  settings: TtsConfig;
  defaults: TtsConfig;
  catalogue: Record<TtsProviderId, TtsVoiceOption[]>;
  providers: TtsProviderStatus[];
  effective: {
    stored_order: TtsProviderId[];
    live_order: TtsProviderId[];
    stored_primary: TtsProviderId | null;
    primary_unavailable: boolean;
    current_providers: TtsProviderId[];
    rates: Record<TtsProviderId, { cards: number; conversations: number }>;
  };
  updated_at: string | null;
  updated_by: string | null;
  azure_region_voices?: AzureRegionVoices;
}

export function getAudioSettings(opts: { azureVoices?: boolean } = {}): Promise<AudioSettingsView> {
  return apiFetch<AudioSettingsView>(`/admin/audio/settings${opts.azureVoices ? '?azure_voices=1' : ''}`);
}

export function saveAudioSettings(settings: TtsConfig): Promise<AudioSettingsView> {
  return apiFetch<AudioSettingsView>('/admin/audio/settings', { method: 'PUT', body: JSON.stringify(settings) });
}

export function resetAudioSettings(): Promise<AudioSettingsView> {
  return apiFetch<AudioSettingsView>('/admin/audio/settings', { method: 'PUT', body: JSON.stringify({ reset: true }) });
}

export interface AudioSample {
  audio_base64: string;
  content_type: string;
  provider: TtsProviderId;
  voice: string;
  rate: number | null;
  bytes: number;
}

export function getAudioSample(input: { provider: TtsProviderId; voice?: string; role?: TtsVoiceRole; text?: string; speed?: number }): Promise<AudioSample> {
  return apiFetch<AudioSample>('/admin/audio/sample', { method: 'POST', body: JSON.stringify(input) });
}

export interface ClipKindCounts {
  total: number;
  current: number;
  missing: number;
  google: number;
  old_voice: number;
  waiting_retry: number;
  due_soon_missing: number;
}

export interface AudioBackfillStatus {
  account_problem: null | { code: string | number; message: string; paused_until: string | null };
  backlog: number;
  kinds: Record<string, ClipKindCounts>;
  eta_minutes: number | null;
  eta_at: string | null;
  clips_waiting_on_account_errors: number | null;
  throughput?: { per_minute: number } | null;
}

export function getAudioBackfill(): Promise<AudioBackfillStatus> {
  return apiFetch<AudioBackfillStatus>('/admin/audio/backfill');
}

export function runAudioBackfill(limit = 100): Promise<{ pump_started: boolean; queued: number }> {
  return apiFetch('/admin/audio/backfill/run', { method: 'POST', body: JSON.stringify({ limit }) });
}

export function retryFailedAudio(): Promise<{ reset: number; account_probe_now: boolean; pump_started: boolean }> {
  return apiFetch('/admin/audio/retry-failed', { method: 'POST', body: JSON.stringify({}) });
}
