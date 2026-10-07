import { useEffect, useState } from 'react';
import type { FrequencyIndex } from '@shared/decks';
import { FREQUENCY_DECAL_KEY, frequencyKeyLine, frequencyTier, type FrequencyDecal } from '@shared/explorer';
import { loadWordFrequency } from '../../services/wordFrequency';

/*
 * Frequency decals (docs/LANGUAGE_EXPLORER.md "Frequency decals"): a 1.5px outline around a
 * word / character tile from its rank in the shipped word-freq list (already loaded for the
 * Word view's "#N most common"), via the shared `frequencyTier`. One O(1) map lookup per tile.
 */

/** The shipped frequency index once loaded (null while loading / unavailable → no decals). */
export function useFrequencyIndex(): FrequencyIndex | null {
  const [index, setIndex] = useState<FrequencyIndex | null>(null);
  useEffect(() => {
    let alive = true;
    void loadWordFrequency().then((idx) => alive && setIndex(idx));
    return () => {
      alive = false;
    };
  }, []);
  return index;
}

/** The decal of a word / character, or null (index not loaded, or the unmarked middle band). */
export function decalFor(index: FrequencyIndex | null, text: string, kind: 'word' | 'char'): FrequencyDecal | null {
  if (!index) return null;
  return frequencyTier((kind === 'char' ? index.chars : index.words).get(text) ?? null, kind);
}

/** ` freq-decal freq-decal--top100` (leading space) or '' — append to a tile's className. */
export function decalClass(tier: FrequencyDecal | null): string {
  return tier ? ` freq-decal freq-decal--${tier}` : '';
}

/** The ⓘ next to a list header; tapping it shows / hides the one-line key under the header. */
export function FrequencyKeyButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="freq-key-btn"
      onClick={onToggle}
      aria-expanded={open}
      aria-label="What the coloured outlines mean"
      data-testid="freq-key-toggle"
    >
      ⓘ
    </button>
  );
}

export function FrequencyKey() {
  return (
    <div className="freq-key" role="note" aria-label={`Outlines: ${frequencyKeyLine()}`} data-testid="freq-key">
      {FREQUENCY_DECAL_KEY.map((k, i) => (
        // The separator ends an entry, so a wrapped line starts with a swatch, never a "·".
        <span key={k.tier} className="freq-key-item">
          <span className={`freq-key-swatch freq-decal freq-decal--${k.tier}`} aria-hidden="true" />
          {k.colour} {k.label}
          {i < FREQUENCY_DECAL_KEY.length - 1 && <span className="freq-key-sep" aria-hidden="true">·</span>}
        </span>
      ))}
    </div>
  );
}
