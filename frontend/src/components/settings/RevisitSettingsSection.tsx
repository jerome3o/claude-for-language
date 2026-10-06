/**
 * Settings → "Lessons & readers": when a finished mini lesson or graded reader
 * comes back (shared/study/revisit.ts). Hard / Good / Easy gaps in days, how
 * much the gap grows each later visit, and the longest gap; Reset to defaults.
 * Saved on the account (PUT /api/profile/revisit-settings) and mirrored on the
 * device so the schedule works offline (services/revisit.ts).
 */
import { useEffect, useState } from 'react';
import {
  DEFAULT_REVISIT_SETTINGS,
  REVISIT_LIMITS,
  computeRevisitState,
  isDefaultRevisitSettings,
  pickRevisitSettingsUpdate,
  revisitGapLabel,
  type RevisitSettings,
} from '@shared/study/revisit';
import { readRevisitSettings, REVISIT_SETTINGS_CHANGED, saveRevisitSettings } from '../../services/revisit';
import { track } from '../../services/analytics';

type Draft = Record<keyof RevisitSettings, string>;

const FIELDS: Array<{ key: keyof RevisitSettings; label: string; hint: string; unit: string; step: string }> = [
  { key: 'hard_days', label: 'Hard', hint: 'First gap after Hard', unit: 'days', step: '1' },
  { key: 'good_days', label: 'Good', hint: 'First gap after Good', unit: 'days', step: '1' },
  { key: 'easy_days', label: 'Easy', hint: 'First gap after Easy', unit: 'days', step: '1' },
  { key: 'growth', label: 'Growth', hint: 'Each later visit multiplies the gap', unit: '×', step: '0.1' },
  { key: 'cap_days', label: 'Longest gap', hint: 'Never longer than', unit: 'days', step: '1' },
];

const toDraft = (s: RevisitSettings): Draft => ({
  hard_days: String(s.hard_days),
  good_days: String(s.good_days),
  easy_days: String(s.easy_days),
  growth: String(s.growth),
  cap_days: String(s.cap_days),
});

/** "14 days → 4 wk → 8 wk → 4 mo → 6 mo": what Good, Good, Good… does. */
function goodChain(s: RevisitSettings): string {
  const gaps: string[] = [];
  const events = [];
  for (let i = 0; i < 5; i++) {
    events.push({ id: `p${i}`, at: new Date(Date.UTC(2026, 0, 1 + i * 400)).toISOString(), kind: 'rating' as const, rating: 2 });
    gaps.push(revisitGapLabel(computeRevisitState(events, s).gap_days));
  }
  return gaps.join(' → ');
}

export function RevisitSettingsSection() {
  const [saved, setSavedSettings] = useState<RevisitSettings>(() => readRevisitSettings());
  const [draft, setDraft] = useState<Draft>(() => toDraft(readRevisitSettings()));
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    const onChange = () => {
      const next = readRevisitSettings();
      setSavedSettings(next);
      setDraft(toDraft(next));
    };
    window.addEventListener(REVISIT_SETTINGS_CHANGED, onChange);
    return () => window.removeEventListener(REVISIT_SETTINGS_CHANGED, onChange);
  }, []);

  const { update, problems: draftProblems } = pickRevisitSettingsUpdate(draft, saved);
  const dirty = (Object.keys(draft) as Array<keyof RevisitSettings>).some(k => Number(draft[k]) !== saved[k]);
  const preview: RevisitSettings = draftProblems.length ? saved : { ...saved, ...(update as Partial<RevisitSettings>) };

  const run = async (body: Partial<RevisitSettings> | { reset: true }, reset: boolean) => {
    setSaving(true);
    setProblems([]);
    try {
      const next = await saveRevisitSettings(body);
      track('settings.revisit_changed', { fields: reset ? 5 : Object.keys(body).length, reset });
      setSavedSettings(next);
      setDraft(toDraft(next));
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } catch (err) {
      const p = (err as { problems?: string[] }).problems;
      setProblems(p?.length ? p : [err instanceof Error ? err.message : 'Could not save']);
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (draftProblems.length) { setProblems(draftProblems); return; }
    const body: Partial<RevisitSettings> = {};
    for (const k of Object.keys(update) as Array<keyof RevisitSettings>) {
      const v = update[k];
      if (typeof v === 'number' && v !== saved[k]) body[k] = v;
    }
    void run(body, false);
  };

  const isDefault = isDefaultRevisitSettings(saved);

  return (
    <div className="settings-section" data-testid="revisit-settings">
      <h2>Lessons &amp; readers</h2>
      <p className="settings-section-desc">
        When a finished mini lesson or story comes back. Again brings it back tomorrow; each later
        visit makes the gap longer. <strong>Done for good</strong> after finishing means it never comes back.
      </p>
      <div className="revisit-grid">
        {FIELDS.map(f => (
          <label key={f.key} className="revisit-field">
            <span className="revisit-field-label">{f.label}</span>
            <span className="revisit-field-input">
              <input
                type="number"
                inputMode={f.key === 'growth' ? 'decimal' : 'numeric'}
                min={f.key === 'growth' ? REVISIT_LIMITS.growth.min : 1}
                max={f.key === 'growth' ? REVISIT_LIMITS.growth.max : f.key === 'cap_days' ? REVISIT_LIMITS.cap_days.max : REVISIT_LIMITS.days.max}
                step={f.step}
                value={draft[f.key]}
                onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                disabled={saving}
                data-testid={`revisit-${f.key}`}
                aria-label={`${f.label} (${f.unit})`}
              />
              <span className="revisit-field-unit">{f.unit}</span>
            </span>
            <span className="revisit-field-hint">{f.hint}</span>
          </label>
        ))}
      </div>
      <p className="revisit-chain" data-testid="revisit-chain">
        Good each time: {goodChain(preview)}
      </p>
      <div className="feedback-actions">
        <button className="btn btn-primary" onClick={save} disabled={saving || !dirty} data-testid="revisit-save">
          {saving ? 'Saving…' : done ? 'Saved ✓' : 'Save'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => void run({ reset: true }, true)}
          disabled={saving || (isDefault && !dirty)}
          data-testid="revisit-reset"
        >
          Reset to defaults
        </button>
      </div>
      {isDefault && !dirty && (
        <p className="settings-section-desc" style={{ marginTop: '0.4rem' }}>
          Defaults: Hard {DEFAULT_REVISIT_SETTINGS.hard_days} days · Good {DEFAULT_REVISIT_SETTINGS.good_days} days ·
          Easy {DEFAULT_REVISIT_SETTINGS.easy_days} days · ×{DEFAULT_REVISIT_SETTINGS.growth} · at most {DEFAULT_REVISIT_SETTINGS.cap_days} days.
        </p>
      )}
      {(problems.length > 0 || (dirty && draftProblems.length > 0)) && (
        <div className="export-error" data-testid="revisit-problems">
          {(problems.length ? problems : draftProblems).join(' · ')}
        </div>
      )}
    </div>
  );
}
