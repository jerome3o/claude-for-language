import { useEffect, useState } from 'react';
import {
  SENTENCE_STYLES,
  SENTENCE_STYLE_COPY,
  SENTENCE_STYLE_NOTE,
  DEFAULT_SENTENCE_STYLE,
  type SentenceStyle,
} from '@shared/study/sentenceStyle';
import { updateSentenceStyle } from '../../api/client';
import { SENTENCE_STYLE_CHANGED, readSentenceStyle, writeSentenceStyle } from '../../services/sentenceStyle';
import { track } from '../../services/analytics';

/**
 * Settings → Study → "Example sentence style" (per account, Everyday by default; shared/study/sentenceStyle.ts,
 * docs/STUDY_SESSION.md "Example sentence style"): the register the example sentences are written in — Standard
 * (textbook-safe), Everyday (how people talk, the occasional common colloquialism) or Casual (chatty). New
 * sentences only. Shown from the device's cache (offline too), saved on the server.
 */
export function SentenceStyleSetting() {
  const [style, setStyle] = useState<SentenceStyle>(readSentenceStyle);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onChange = () => setStyle(readSentenceStyle());
    window.addEventListener(SENTENCE_STYLE_CHANGED, onChange);
    return () => window.removeEventListener(SENTENCE_STYLE_CHANGED, onChange);
  }, []);

  const choose = async (next: SentenceStyle) => {
    if (next === style || saving) return;
    const before = style;
    setStyle(next);
    setError(null);
    setSaving(true);
    writeSentenceStyle(next);
    track('settings.sentence_style', { style: next, from: before });
    try {
      writeSentenceStyle(await updateSentenceStyle(next === DEFAULT_SENTENCE_STYLE ? null : next));
    } catch (err) {
      writeSentenceStyle(before);
      setStyle(before);
      setError(err instanceof Error && navigator.onLine ? err.message : 'You are offline — try again when you have a connection.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset className="settings-radio-group" data-testid="sentence-style">
      <legend>Example sentence style</legend>
      <p className="settings-section-desc" style={{ marginTop: '0.25rem' }}>
        How the example sentences on your cards are written. {SENTENCE_STYLE_NOTE}
      </p>
      {SENTENCE_STYLES.map((s) => (
        <label key={s} className="settings-toggle-row" style={{ alignItems: 'flex-start' }}>
          <input
            type="radio"
            name="sentence-style"
            value={s}
            checked={style === s}
            disabled={saving}
            onChange={() => void choose(s)}
            data-testid={`sentence-style-${s}`}
          />
          <span>
            {SENTENCE_STYLE_COPY[s].label}
            {s === DEFAULT_SENTENCE_STYLE && ' (default)'}
            <span className="settings-radio-hint">{SENTENCE_STYLE_COPY[s].description}</span>
          </span>
        </label>
      ))}
      {error && <div className="export-error">{error}</div>}
    </fieldset>
  );
}
