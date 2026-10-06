/**
 * /admin/audio — which TTS provider speaks, in what order, in which voices
 * (docs/AUDIO.md "Providers"). Edits ONE TtsConfig (shared/tts/config.ts),
 * validated live with mergeTtsConfig and saved with PUT /api/admin/audio/settings.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DEFAULT_TTS_CONFIG,
  TTS_PROVIDER_NAMES,
  TTS_VOICE_CATALOGUE,
  TTS_VOICE_ROLES,
  cloneTtsConfig,
  mergeTtsConfig,
  providerRate,
  PROVIDER_RATE_RANGE,
  type TtsConfig,
  type TtsProviderId,
  type TtsVoiceOption,
  type TtsVoiceRole,
} from '@shared/tts';
import {
  AudioAdminError,
  getAudioBackfill,
  getAudioSample,
  getAudioSettings,
  resetAudioSettings,
  retryFailedAudio,
  runAudioBackfill,
  saveAudioSettings,
  type AudioBackfillStatus,
  type AudioSettingsView,
  type AzureRegionVoices,
  type TtsProviderStatus,
} from '../api/audioAdmin';
import { InlineNotice, type Notice } from '../components/chat/InlineNotice';
import { moveProvider, orderRows, sameTtsConfig, toggleProvider } from '../utils/ttsOrder';
import './AdminAudioPage.css';

const ROLE_LABELS: Record<TtsVoiceRole, string> = { default: 'Default', female: 'Female', male: 'Male' };
const CARD_SPEED = 0.6;

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

type StatusTone = 'off' | 'warn' | 'bad' | 'ok';

function providerStatusLine(status: TtsProviderStatus | undefined, enabled: boolean): { tone: StatusTone; label: string; detail: string | null } {
  if (!status) return { tone: 'off', label: 'Unknown', detail: null };
  if (!status.configured) return { tone: 'off', label: 'Not configured', detail: status.missing.length ? `Missing secret${status.missing.length > 1 ? 's' : ''}: ${status.missing.join(', ')}` : null };
  if (!enabled) return { tone: 'warn', label: 'Disabled', detail: 'Skipped in every order until enabled.' };
  if (status.account_problem) {
    const p = status.account_problem;
    return {
      tone: 'bad',
      label: 'Paused',
      detail: `Account problem ${p.code}: ${p.message}${p.paused_until ? ` · paused until ${formatWhen(p.paused_until)}` : p.probing ? ' · probing now' : ''}`,
    };
  }
  return { tone: 'ok', label: 'Working', detail: status.last_success_at ? `Last clip ${formatWhen(status.last_success_at)}` : 'No clip made yet' };
}

/** Why a provider in an order is skipped at run time (null = it is tried). */
function skipReason(status: TtsProviderStatus | undefined, config: TtsConfig, id: TtsProviderId): string | null {
  if (status && !status.configured) return 'skipped — not configured';
  if (!config.providers[id].enabled) return 'skipped — disabled';
  if (status?.account_problem) return 'paused — account problem';
  return null;
}

function voiceLabel(v: TtsVoiceOption): string {
  return `${v.name} · ${v.gender}${v.note ? ` — ${v.note}` : ''}`;
}

export function AdminAudioPage() {
  const [view, setView] = useState<AudioSettingsView | null>(null);
  const [draft, setDraft] = useState<TtsConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(async () => {
    try {
      const v = await getAudioSettings();
      setView(v);
      setDraft(cloneTtsConfig(v.settings));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const problems = useMemo(() => (draft ? mergeTtsConfig(DEFAULT_TTS_CONFIG, draft).problems : []), [draft]);
  const dirty = !!(view && draft && !sameTtsConfig(view.settings, draft));

  const update = useCallback((fn: (c: TtsConfig) => void) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneTtsConfig(prev);
      fn(next);
      return next;
    });
    setServerProblems([]);
  }, []);

  const applyView = useCallback((v: AudioSettingsView) => {
    setView((prev) => ({ ...v, azure_region_voices: prev?.azure_region_voices }));
    setDraft(cloneTtsConfig(v.settings));
    setServerProblems([]);
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setNotice(null);
    try {
      applyView(await saveAudioSettings(draft));
      setNotice({ kind: 'success', text: 'Saved — the new settings apply to the next clip.' });
    } catch (err) {
      if (err instanceof AudioAdminError && err.problems.length) setServerProblems(err.problems);
      setNotice({ kind: 'error', text: `Couldn't save: ${errorText(err)}` });
    } finally {
      setSaving(false);
    }
  }, [draft, applyView]);

  const handleReset = useCallback(async () => {
    setConfirmReset(false);
    setSaving(true);
    setNotice(null);
    try {
      applyView(await resetAudioSettings());
      setNotice({ kind: 'success', text: 'Back to the default settings.' });
    } catch (err) {
      setNotice({ kind: 'error', text: `Couldn't reset: ${errorText(err)}` });
    } finally {
      setSaving(false);
    }
  }, [applyView]);

  if (loadError && !view) {
    return (
      <div className="container">
        <div className="audio-admin">
          <Link to="/admin" className="audio-admin-back">← Admin</Link>
          <h1>Audio providers</h1>
          <div className="audio-notice-error" role="alert">Couldn't load the audio settings: {loadError}</div>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>Try again</button>
        </div>
      </div>
    );
  }

  if (!view || !draft) {
    return (
      <div className="container">
        <div className="audio-admin">
          <Link to="/admin" className="audio-admin-back">← Admin</Link>
          <h1>Audio providers</h1>
          <p className="audio-muted">Loading…</p>
        </div>
      </div>
    );
  }

  const statusOf = (id: TtsProviderId) => view.providers.find((p) => p.id === id);
  const allProblems = [...problems, ...serverProblems.filter((p) => !problems.includes(p))];

  return (
    <div className="container">
      <div className="audio-admin">
        <Link to="/admin" className="audio-admin-back">← Admin</Link>
        <h1>Audio providers</h1>
        <p className="audio-lead">
          Which text-to-speech service makes the app's audio, in what order, and in which voices.
          {view.updated_at && <> Last changed {formatWhen(view.updated_at)}.</>}
        </p>

        {view.effective.primary_unavailable && (
          <div className="audio-notice-warn" role="status">
            {TTS_PROVIDER_NAMES[view.settings.stored_order[0]]} (first for stored clips) is unavailable right now
            {view.effective.stored_order.length > 0
              ? ` — new clips come from ${view.effective.stored_order.map((p) => TTS_PROVIDER_NAMES[p]).join(' → ')}.`
              : ' — and no other provider can make stored clips.'}
          </div>
        )}

        <div className="audio-provider-grid">
          {(['minimax', 'azure', 'google'] as TtsProviderId[]).map((id) => (
            <ProviderCard
              key={id}
              id={id}
              status={statusOf(id)}
              config={draft}
              catalogue={view.catalogue?.[id] ?? TTS_VOICE_CATALOGUE[id]}
              azureVoices={id === 'azure' ? view.azure_region_voices : undefined}
              onAzureVoices={(v) => setView((prev) => (prev ? { ...prev, azure_region_voices: v } : prev))}
              update={update}
            />
          ))}
        </div>

        <h2>Order</h2>
        <p className="audio-muted">
          Each clip asks the first provider that is enabled, configured and not paused; the rest are backups.
        </p>
        <div className="audio-orders">
        <OrderList
          list="stored"
          title="Stored clips (kept on devices)"
          hint="Word, card sentence and example sentence clips: saved and cached by both apps."
          order={draft.stored_order}
          config={draft}
          statusOf={statusOf}
          running={view.effective.stored_order}
          onChange={(order) => update((c) => { c.stored_order = order; })}
        />
        <OrderList
          list="live"
          title="Live playback (played once)"
          hint="Chat read-aloud fallback and role-play replies: nobody keeps these."
          order={draft.live_order}
          config={draft}
          statusOf={statusOf}
          running={view.effective.live_order}
          onChange={(order) => update((c) => { c.live_order = order; })}
        />
        </div>

        <label className="audio-switch-row">
          <input
            type="checkbox"
            checked={draft.upgrade_backup_clips}
            onChange={(e) => update((c) => { c.upgrade_backup_clips = e.target.checked; })}
            data-testid="audio-upgrade-toggle"
          />
          <span>
            <strong>Upgrade backup clips to the first provider when it's available</strong>
            <span className="audio-muted"> Clips a backup provider made are remade by the backfill once {TTS_PROVIDER_NAMES[draft.stored_order[0]] ?? 'the first provider'} answers again.</span>
          </span>
        </label>

        <BacklogCard />

        <div className="page-footer audio-footer">
          {allProblems.length > 0 && (
            <ul className="audio-problems" role="alert" data-testid="audio-problems">
              {allProblems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <InlineNotice notice={notice} onDismiss={() => setNotice(null)} />
          {confirmReset ? (
            <div className="audio-footer-row">
              <span className="audio-footer-state">Reset every provider, voice and order to the defaults?</span>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmReset(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => void handleReset()} data-testid="audio-reset-confirm">Reset</button>
            </div>
          ) : (
            <div className="audio-footer-row">
              <span className="audio-footer-state">{dirty ? (allProblems.length ? 'Fix the problems above to save' : 'Unsaved changes') : 'No changes'}</span>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmReset(true)} disabled={saving} data-testid="audio-reset">
                Reset to defaults
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSave()}
                disabled={!dirty || problems.length > 0 || saving}
                data-testid="audio-save"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- provider card

function ProviderCard({
  id,
  status,
  config,
  catalogue,
  azureVoices,
  onAzureVoices,
  update,
}: {
  id: TtsProviderId;
  status: TtsProviderStatus | undefined;
  config: TtsConfig;
  catalogue: readonly TtsVoiceOption[];
  azureVoices: AzureRegionVoices | undefined;
  onAzureVoices: (v: AzureRegionVoices) => void;
  update: (fn: (c: TtsConfig) => void) => void;
}) {
  const p = config.providers[id];
  const line = providerStatusLine(status, p.enabled);
  const [sampleBusy, setSampleBusy] = useState<TtsVoiceRole | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [checkingAzure, setCheckingAzure] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const playSample = async (role: TtsVoiceRole) => {
    setSampleBusy(role);
    setNotice(null);
    try {
      const s = await getAudioSample({ provider: id, voice: p.voices[role], role });
      audioRef.current?.pause();
      const audio = new Audio(`data:${s.content_type};base64,${s.audio_base64}`);
      audioRef.current = audio;
      await audio.play();
    } catch (err) {
      const busy = err instanceof AudioAdminError && err.rateLimited;
      setNotice({ kind: 'error', text: busy ? `${TTS_PROVIDER_NAMES[id]} is busy — try again in a minute.` : errorText(err) });
    } finally {
      setSampleBusy(null);
    }
  };

  const checkAzure = async () => {
    setCheckingAzure(true);
    try {
      const v = await getAudioSettings({ azureVoices: true });
      onAzureVoices(v.azure_region_voices ?? { ok: false, error: 'no answer' });
    } catch (err) {
      onAzureVoices({ ok: false, error: errorText(err) });
    } finally {
      setCheckingAzure(false);
    }
  };

  const fixedSpeed = id === 'minimax';
  const cardsRate = providerRate(p, CARD_SPEED);
  const canSample = !!status?.configured;

  return (
    <section className="audio-card" data-testid={`provider-card-${id}`}>
      <div className="audio-card-head">
        <h2>{TTS_PROVIDER_NAMES[id]}</h2>
        <span className={`audio-pill audio-pill-${line.tone}`}>{line.label}</span>
      </div>
      {line.detail && <p className="audio-card-detail">{line.detail}</p>}
      {id === 'azure' && status?.region && <p className="audio-card-detail">Region: {status.region}</p>}

      <label className="audio-switch-row compact">
        <input
          type="checkbox"
          checked={p.enabled}
          onChange={(e) => update((c) => { c.providers[id].enabled = e.target.checked; })}
          data-testid={`provider-enabled-${id}`}
        />
        <span>Enabled</span>
      </label>

      <div className="audio-field-row">
        <label className="audio-field">
          <span>Max requests / min</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={600}
            step={1}
            value={Number.isNaN(p.max_rpm) ? '' : p.max_rpm}
            onChange={(e) => update((c) => { c.providers[id].max_rpm = e.target.value === '' ? Number.NaN : Number(e.target.value); })}
            data-testid={`provider-rpm-${id}`}
          />
        </label>
        <div className="audio-stat">
          <span>Learned rate</span>
          <strong>{status?.learned_rpm ?? '—'}{status?.rpm_cap ? ` / ${status.rpm_cap}` : ''}</strong>
        </div>
      </div>

      {status?.last_hour && (
        <p className="audio-card-detail">
          Last hour: {status.last_hour.ok} ok · {status.last_hour.failed} failed · {status.last_hour.rate_limited} rate-limited
          {status.last_hour.denied ? ` · ${status.last_hour.denied} denied` : ''}
        </p>
      )}
      {status?.last_error && (
        <p className="audio-card-detail audio-card-error">Last error {formatWhen(status.last_error.at)}: {status.last_error.reason}</p>
      )}

      <div className="audio-voices">
        {TTS_VOICE_ROLES.map((role) => {
          const current = p.voices[role];
          const known = catalogue.some((v) => v.id === current);
          return (
            <div key={role} className="audio-voice-row">
              <label className="audio-field">
                <span>{ROLE_LABELS[role]} voice</span>
                <select
                  value={current}
                  onChange={(e) => update((c) => { c.providers[id].voices[role] = e.target.value; })}
                  data-testid={`provider-voice-${id}-${role}`}
                >
                  {!known && <option value={current}>{current} (custom)</option>}
                  {catalogue.map((v) => <option key={v.id} value={v.id}>{voiceLabel(v)}</option>)}
                </select>
              </label>
              <button
                type="button"
                className="audio-play"
                onClick={() => void playSample(role)}
                disabled={!canSample || sampleBusy !== null}
                aria-label={`Play a ${ROLE_LABELS[role].toLowerCase()} voice sample from ${TTS_PROVIDER_NAMES[id]}`}
                title={canSample ? 'Play a sample' : 'Not configured'}
              >
                {sampleBusy === role ? '…' : '▶'}
              </button>
            </div>
          );
        })}
      </div>
      <InlineNotice notice={notice} onDismiss={() => setNotice(null)} />

      <label className="audio-field">
        <span>Speed factor</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={2}
          step={0.05}
          disabled={fixedSpeed}
          value={fixedSpeed ? 1 : Number.isNaN(p.speed_factor) ? '' : p.speed_factor}
          onChange={(e) => update((c) => { c.providers[id].speed_factor = e.target.value === '' ? Number.NaN : Number(e.target.value); })}
          data-testid={`provider-speed-${id}`}
        />
      </label>
      <p className="audio-hint">
        {fixedSpeed
          ? 'MiniMax is the reference: card clips are spoken at the app’s own speed (0.6).'
          : Number.isNaN(p.speed_factor)
            ? 'Enter a factor between 0 and 2.'
            : `Card clips 0.6 → ${cardsRate}.${id === 'azure' ? ' HD voices ignore it and speak at their own pace.' : ''}`}
      </p>

      <label className="audio-field">
        <span>Conversation speed</span>
        <input
          type="number"
          inputMode="decimal"
          min={PROVIDER_RATE_RANGE[id].good_min}
          max={PROVIDER_RATE_RANGE[id].good_max}
          step={0.05}
          value={Number.isNaN(p.conversation_rate) ? '' : p.conversation_rate}
          onChange={(e) => update((c) => { c.providers[id].conversation_rate = e.target.value === '' ? Number.NaN : Number(e.target.value); })}
          data-testid={`provider-conversation-rate-${id}`}
        />
      </label>
      <p className="audio-hint">
        {`${TTS_PROVIDER_NAMES[id]}'s own rate for conversation exercises (1 = its natural pace; sounds natural ${PROVIDER_RATE_RANGE[id].good_min}–${PROVIDER_RATE_RANGE[id].good_max}). The default until a learner picks a speed in the exercise's Audio menu.`}
      </p>

      {id === 'azure' && status?.configured && (
        <div className="audio-azure">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void checkAzure()} disabled={checkingAzure}>
            {checkingAzure ? 'Checking…' : 'Check region voices'}
          </button>
          {azureVoices && !azureVoices.ok && <p className="audio-card-error">Couldn't list voices: {azureVoices.error}</p>}
          {azureVoices?.ok && (
            <details open>
              <summary>{azureVoices.voices?.length ?? 0} zh-CN voices in this region</summary>
              <ul className="audio-azure-list">
                {(azureVoices.voices ?? []).map((v) => (
                  <li key={v.name}><code>{v.name}</code> {v.local} · {v.gender}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- order lists

function OrderList({
  list,
  title,
  hint,
  order,
  config,
  statusOf,
  running,
  onChange,
}: {
  list: 'stored' | 'live';
  title: string;
  hint: string;
  order: TtsProviderId[];
  config: TtsConfig;
  statusOf: (id: TtsProviderId) => TtsProviderStatus | undefined;
  running: TtsProviderId[];
  onChange: (order: TtsProviderId[]) => void;
}) {
  const rows = orderRows(order);
  return (
    <section className="audio-card audio-order" data-testid={`audio-order-${list}`}>
      <h3>{title}</h3>
      <p className="audio-muted">{hint}</p>
      <ol className="audio-order-list">
        {rows.map((row, i) => {
          const reason = row.included ? skipReason(statusOf(row.id), config, row.id) : null;
          const onlyOne = row.included && order.length === 1;
          return (
            <li key={row.id} className={`audio-order-row${row.included ? '' : ' excluded'}${reason ? ' skipped' : ''}`} data-provider={row.id}>
              <label className="audio-order-include" title={onlyOne ? 'At least one provider must stay' : undefined}>
                <input
                  type="checkbox"
                  checked={row.included}
                  disabled={onlyOne}
                  onChange={(e) => onChange(toggleProvider(order, row.id, e.target.checked))}
                  aria-label={`Use ${TTS_PROVIDER_NAMES[row.id]} for ${title.toLowerCase()}`}
                  data-testid={`order-include-${list}-${row.id}`}
                />
              </label>
              <span className="audio-order-pos">{row.position ?? '–'}</span>
              <span className="audio-order-name">
                {TTS_PROVIDER_NAMES[row.id]}
                {!row.included && <span className="audio-order-note">not used</span>}
                {reason && <span className="audio-order-note">{reason}</span>}
              </span>
              {row.included && (
                <span className="audio-order-moves">
                  <button
                    type="button"
                    onClick={() => onChange(moveProvider(order, row.id, -1))}
                    disabled={i === 0}
                    aria-label={`Move ${TTS_PROVIDER_NAMES[row.id]} up`}
                    data-testid={`order-up-${list}-${row.id}`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(moveProvider(order, row.id, 1))}
                    disabled={i === order.length - 1}
                    aria-label={`Move ${TTS_PROVIDER_NAMES[row.id]} down`}
                    data-testid={`order-down-${list}-${row.id}`}
                  >
                    ↓
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="audio-effective" data-testid={`audio-effective-${list}`}>
        Running now (saved): {running.length ? running.map((p) => TTS_PROVIDER_NAMES[p]).join(' → ') : <strong>nothing — no provider in this order can speak</strong>}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- backlog

function BacklogCard() {
  const [status, setStatus] = useState<AudioBackfillStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'retry' | 'run' | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await getAudioBackfill());
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sum = (k: 'missing' | 'old_voice' | 'waiting_retry' | 'google') =>
    status ? Object.values(status.kinds ?? {}).reduce((n, c) => n + (c?.[k] ?? 0), 0) : 0;

  const retry = async () => {
    setBusy('retry');
    setResult(null);
    try {
      const r = await retryFailedAudio();
      setResult(`${r.reset} failed clip${r.reset === 1 ? '' : 's'} due again now${r.account_probe_now ? ' · probing the accounts' : ''}${r.pump_started ? ' · backfill running' : ''}.`);
      void load();
    } catch (err) {
      setResult(`Couldn't retry: ${errorText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    setBusy('run');
    setResult(null);
    try {
      const r = await runAudioBackfill(100);
      setResult(`Queued ${r.queued} clip${r.queued === 1 ? '' : 's'}${r.pump_started ? ' · backfill running' : ''}.`);
      void load();
    } catch (err) {
      setResult(`Couldn't run the backfill: ${errorText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="audio-card audio-backlog" data-testid="audio-backlog">
      <h2>Backlog</h2>
      {error && <p className="audio-card-error">Couldn't load the backlog: {error}</p>}
      {!status && !error && <p className="audio-muted">Loading…</p>}
      {status && (
        <>
          <div className="audio-backlog-stats">
            <div><strong>{status.backlog}</strong><span>to make</span></div>
            <div><strong>{sum('missing')}</strong><span>missing</span></div>
            <div><strong>{sum('old_voice') + sum('google')}</strong><span>old voice</span></div>
            <div><strong>{sum('waiting_retry')}</strong><span>waiting retry</span></div>
          </div>
          <p className="audio-muted">
            {status.backlog === 0
              ? 'Every clip is current.'
              : status.eta_minutes !== null
                ? `About ${status.eta_minutes < 90 ? `${status.eta_minutes} min` : `${Math.round(status.eta_minutes / 6) / 10} h`} at the current rate (done ~${formatWhen(status.eta_at)}).`
                : 'No rate measured yet — ETA unknown.'}
            {status.clips_waiting_on_account_errors ? ` ${status.clips_waiting_on_account_errors} clips wait on an account error.` : ''}
          </p>
        </>
      )}
      <div className="audio-backlog-actions">
        <button type="button" className="btn btn-secondary" onClick={() => void retry()} disabled={busy !== null}>
          {busy === 'retry' ? 'Retrying…' : 'Retry failed now'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void run()} disabled={busy !== null}>
          {busy === 'run' ? 'Starting…' : 'Run backfill'}
        </button>
      </div>
      {result && <p className="audio-backlog-result" role="status">{result}</p>}
    </section>
  );
}
