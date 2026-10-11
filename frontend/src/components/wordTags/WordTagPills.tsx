import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FrequencyIndex } from '@shared/decks';
import { wordTagKey, type WordTag, type WordTagKind, type WordTagLexicon } from '@shared/cards/word-tags';
import { AI_WORD_TAG_NOTICE, explainWordTag, parseAiWordTags, wordTagsWithAi, type AiWordTags } from '@shared/cards/word-tags-ai';
import { loadWordTagLexicon, onWordTagsPrefChange, readWordTagsOn } from '../../services/wordTags';
import { loadWordFrequency } from '../../services/wordFrequency';
import { track } from '../../services/analytics';
import '../explorer/explorer.css';
import './wordTags.css';

/** The lexicon + frequency list once loaded (null while loading / unavailable). */
function useWordTagData(): { lexicon: WordTagLexicon | null; freq: FrequencyIndex | null; loaded: boolean } {
  const [state, setState] = useState<{ lexicon: WordTagLexicon | null; freq: FrequencyIndex | null; loaded: boolean }>({ lexicon: null, freq: null, loaded: false });
  useEffect(() => {
    let alive = true;
    void Promise.all([loadWordTagLexicon(), loadWordFrequency()]).then(([lexicon, freq]) => {
      if (alive) setState({ lexicon, freq, loaded: true });
    });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/** Settings → Study → "Word tags on the answer" (live: a change elsewhere on the page applies at once). */
export function useWordTagsOn(): boolean {
  const [on, setOn] = useState(readWordTagsOn);
  useEffect(() => {
    const unsubscribe = onWordTagsPrefChange(setOn);
    return unsubscribe;
  }, []);
  return on;
}

/**
 * The quiet row of word tags (docs/STUDY_SESSION.md "Word tags") — under the meaning on a
 * card's answer side and in the explorer's Word view header. Part of speech, separable verb,
 * register, measure word, HSK level, how common, traditional form, from the shipped lexicon
 * (shared/cards/word-tags.ts) — no network. Where the lexicon has nothing, the note's AI verdict
 * (`aiTags` = notes.word_tags, shared/cards/word-tags-ai.ts) adds transitivity / a register,
 * marked ✨. A tap on a pill opens a one-line explanation. Renders nothing while loading, when
 * there are no tags, or when switched off.
 */
export function WordTagPills({
  hanzi,
  aiTags,
  source,
  exclude,
  className,
}: {
  hanzi: string;
  /** The note's AI word tags (notes.word_tags JSON); absent / null = lexicon only. */
  aiTags?: string | null;
  source: 'study' | 'explorer';
  exclude?: readonly WordTagKind[];
  className?: string;
}) {
  const on = useWordTagsOn();
  const { lexicon, freq } = useWordTagData();
  const [open, setOpen] = useState<WordTag | null>(null);
  const key = wordTagKey(hanzi);
  const excludeKey = (exclude ?? []).join(',');
  const ai = useMemo(() => parseAiWordTags(aiTags ?? null), [aiTags]);
  const tags = useMemo(() => {
    if (!lexicon) return [];
    const rank = freq ? (([...key].length === 1 ? freq.chars.get(key) : freq.words.get(key)) ?? null) : undefined;
    return wordTagsWithAi(hanzi, lexicon, ai, { rank, exclude: excludeKey ? (excludeKey.split(',') as WordTagKind[]) : [] });
  }, [hanzi, key, lexicon, freq, excludeKey, ai]);

  useEffect(() => {
    setOpen(null);
  }, [hanzi]);

  if (!on || tags.length === 0) return null;
  return (
    <>
      <div className={`word-tags${className ? ` ${className}` : ''}`} data-testid="word-tags" aria-label="Word tags">
        {tags.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`word-tag word-tag--${t.tone}${t.kind === 'frequency' ? ` freq-decal freq-decal--${t.tone}` : ''}${t.ai ? ' word-tag--ai' : ''}`}
            data-tag={t.id}
            data-ai={t.ai ? 'true' : undefined}
            aria-label={t.ai ? `${t.label} (suggested by AI)` : undefined}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(t);
              track('study.word_tag_open', { kind: t.kind, tag: t.id, source, tag_source: t.ai ? 'ai' : 'lexicon' });
            }}
          >
            {t.ai && <AiMark />}
            <span lang={t.kind === 'trad' || t.kind === 'measure' ? 'zh-CN' : undefined}>{t.label}</span>
          </button>
        ))}
      </div>
      {open && <WordTagSheet tag={open} hanzi={hanzi} lexicon={lexicon} ai={ai} onClose={() => setOpen(null)} />}
    </>
  );
}

/** The ✨ before an AI-suggested pill's label. */
function AiMark() {
  return (
    <span className="word-tag-ai-mark" aria-hidden="true">
      ✨
    </span>
  );
}

/** The tiny explanation sheet: what the tag means, one example, where it comes from (+ the AI notice and note). */
function WordTagSheet({
  tag,
  hanzi,
  lexicon,
  ai,
  onClose,
}: {
  tag: WordTag;
  hanzi: string;
  lexicon: WordTagLexicon | null;
  ai: AiWordTags | null;
  onClose: () => void;
}) {
  const e = explainWordTag(tag, hanzi, lexicon, ai);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        // Close only this sheet, not the explorer / study screen underneath.
        ev.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <>
      <div
        className="word-tag-backdrop"
        role="presentation"
        onClick={(ev) => {
          ev.stopPropagation();
          onClose();
        }}
      />
      <div className="word-tag-sheet" role="dialog" aria-label={e.title} data-testid="word-tag-sheet" onClick={(ev) => ev.stopPropagation()}>
        <div className="word-tag-sheet-grip" aria-hidden="true" />
        <div className="word-tag-sheet-head">
          <span className={`word-tag word-tag--${tag.tone} word-tag--static${tag.kind === 'frequency' ? ` freq-decal freq-decal--${tag.tone}` : ''}${tag.ai ? ' word-tag--ai' : ''}`}>
            {tag.ai && <AiMark />}
            {tag.label}
          </span>
          <h2 className="word-tag-sheet-title">{e.title}</h2>
        </div>
        {e.ai && (
          <p className="word-tag-sheet-ai" data-testid="word-tag-sheet-ai">
            <span aria-hidden="true">✨ </span>
            {AI_WORD_TAG_NOTICE}
          </p>
        )}
        <p className="word-tag-sheet-body">{e.body}</p>
        {e.note && (
          <p className="word-tag-sheet-note" data-testid="word-tag-sheet-note">
            {e.note}
          </p>
        )}
        {e.example && (
          <p className="word-tag-sheet-example" lang="zh-CN">
            {e.example}
          </p>
        )}
        <p className="word-tag-sheet-source">Source: {e.source}</p>
        <div className="sheet-footer word-tag-sheet-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} autoFocus>
            Got it
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
