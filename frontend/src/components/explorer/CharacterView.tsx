import { useEffect, useState } from 'react';
import { CHAR_STATUS_LABEL, charWordsSummary, type CharRecord, type CharWord, type CharWordRow } from '@shared/chars';
import { buildDrill, type DrillTarget, type FrequencyDecal } from '@shared/explorer';
import { isHanCodePoint } from '@shared/progress/known';
import { charWordStatuses, explainChar, lookupChar, type CharLookup } from '../../services/charDict';
import { track } from '../../services/analytics';
import { useExplorer } from './ExplorerContext';
import { FrequencyKey, FrequencyKeyButton, decalClass, decalFor, useFrequencyIndex } from './FrequencyDecal';

const isHan = (ch: string | null | undefined) => !!ch && [...ch].length === 1 && isHanCodePoint(ch.codePointAt(0)!);

/**
 * The Character view (the character sheet of docs/STUDY_SESSION.md, now a view of the
 * language explorer): card-independent dictionary data, cached on the device — readings,
 * meaning, radical / components (tappable → another Character view), strokes, frequency, and
 * the frequent words with the character marked ✓ Known / 📚 In your decks (→ the Word view).
 */
export function CharacterView({
  char,
  cardHanzi,
  onWrite,
  onClose,
  onDrill,
}: {
  char: string;
  cardHanzi?: string | null;
  onWrite?: (char: string) => void;
  onClose: () => void;
  /** "🎯 Quick drill" over this character and its words. */
  onDrill?: (target: DrillTarget, pool: CharWord[]) => void;
}) {
  const explorer = useExplorer();
  const [lookup, setLookup] = useState<CharLookup | null>(null);
  const [rows, setRows] = useState<CharWordRow<CharWord>[] | null>(null);
  const [more, setMore] = useState<{ state: 'idle' | 'loading' | 'done' | 'offline' | 'error'; text?: string }>({ state: 'idle' });
  const freq = useFrequencyIndex();
  const [keyOpen, setKeyOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    lookupChar(char).then((r) => {
      if (!alive) return;
      setLookup(r);
      track('study.char_sheet_open', { found: r.status === 'ok', words: r.status === 'ok' ? r.record.words.length : 0 });
    });
    return () => {
      alive = false;
    };
  }, [char]);

  const record: CharRecord | null = lookup?.status === 'ok' ? lookup.record : null;

  useEffect(() => {
    if (!record) return;
    let alive = true;
    charWordStatuses(record.words, cardHanzi)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows(record.words.map((word) => ({ word, status: 'none', note_ids: [], current: false }))));
    return () => {
      alive = false;
    };
  }, [record, cardHanzi]);

  async function askMore() {
    setMore({ state: 'loading' });
    track('study.char_explain', {});
    const out = await explainChar(char);
    if (out.status === 'ok') setMore({ state: 'done', text: out.text });
    else if (out.status === 'offline') setMore({ state: 'offline' });
    else setMore({ state: 'error', text: out.message });
  }

  function openRow(row: CharWordRow<CharWord>) {
    track('study.char_word_tap', { status: row.status, current: row.current });
    explorer.push({ kind: 'word', hanzi: row.word.hanzi, pinyin: row.word.pinyin, gloss: row.word.english });
  }

  // A tappable component is a character tile (with its decal); the radical is often a
  // radical form (钅, 氵) rather than a character one learns, so it stays plain.
  const charChip = (c: string, decal = false) =>
    isHan(c) && c !== char ? (
      <button
        type="button"
        className={`xp-inline-char${decal ? decalClass(decalFor(freq, c, 'char')) : ''}`}
        lang="zh-CN"
        onClick={() => explorer.push({ kind: 'char', char: c })}
      >
        {c}
      </button>
    ) : (
      <b lang="zh-CN">{c}</b>
    );

  const readings = record?.readings.map((r) => r.pinyin).join(' · ');
  const shownRows = rows ?? record?.words.map((word) => ({ word, status: 'none' as const, note_ids: [], current: false })) ?? [];

  return (
    <div className="xp-view" data-testid="explorer-char-view">
      <div className="char-sheet-top">
        <div className={`char-sheet-glyph${decalClass(decalFor(freq, char, 'char'))}`} lang="zh-CN" data-testid="explorer-char-glyph">{char}</div>
        <div className="char-sheet-summary">
          {readings && <div className="char-sheet-pinyin">{readings}</div>}
          {record?.meaning && <div className="char-sheet-meaning">{record.meaning}</div>}
        </div>
      </div>

      {lookup === null && <div className="char-sheet-status">Looking it up…</div>}
      {lookup?.status === 'offline' && (
        <div className="char-sheet-status" data-testid="char-sheet-offline">
          You’re offline and this character isn’t on the device yet — it will be after the next sync.
        </div>
      )}
      {lookup?.status === 'missing' && <div className="char-sheet-status">This character isn’t in the dictionary.</div>}
      {lookup?.status === 'error' && <div className="char-sheet-status char-sheet-error">Couldn’t load it: {lookup.message}</div>}

      {record && (
        <>
          {record.readings.length > 1 && (
            <ul className="char-sheet-readings">
              {record.readings.map((r) => (
                <li key={r.pinyin}><span className="char-sheet-reading-pinyin">{r.pinyin}</span> {r.english}</li>
              ))}
            </ul>
          )}
          <div className="char-sheet-facts">
            {record.radical && (
              <span className="char-sheet-fact">
                Radical {charChip(record.radical)}{record.radical_meaning ? ` ${record.radical_meaning}` : ''}
              </span>
            )}
            {record.strokes && <span className="char-sheet-fact">{record.strokes} strokes</span>}
            {record.rank && record.rank <= 5000 && <span className="char-sheet-fact">#{record.rank} most common</span>}
          </div>
          {record.components.length > 0 && (
            <div className="char-sheet-components">
              Built from{' '}
              {record.components.map((c, i) => (
                <span key={c.char}>
                  {i > 0 && ' + '}
                  {charChip(c.char, true)}{c.meaning ? ` (${c.meaning})` : ''}
                </span>
              ))}
            </div>
          )}
          {record.etymology && <div className="char-sheet-etymology">{record.etymology}</div>}
        </>
      )}

      <div className="char-sheet-actions">
        {onWrite && (
          <button
            type="button"
            className="btn btn-secondary char-sheet-action"
            onClick={() => {
              track('explorer.write', {});
              onClose();
              onWrite(char);
            }}
          >
            ✍️ Write it
          </button>
        )}
        {more.state === 'idle' && (
          <button type="button" className="btn btn-secondary char-sheet-action" onClick={askMore}>
            ✨ More about {char}
          </button>
        )}
        {onDrill && record && buildDrill({ kind: 'char', char }, record.words, 1).length > 0 && (
          <button type="button" className="btn btn-secondary char-sheet-action" onClick={() => onDrill({ kind: 'char', char }, record.words)} data-testid="explorer-drill-start">
            🎯 Quick drill
          </button>
        )}
      </div>
      {more.state === 'loading' && <div className="char-sheet-more char-sheet-more--muted">Asking Claude…</div>}
      {more.state === 'done' && <div className="char-sheet-more" data-testid="char-sheet-more">{more.text}</div>}
      {more.state === 'offline' && <div className="char-sheet-more char-sheet-more--muted">Needs internet — the dictionary above works offline.</div>}
      {more.state === 'error' && (
        <div className="char-sheet-more char-sheet-more--muted">
          {more.text} <button type="button" className="char-sheet-link" onClick={askMore}>Try again</button>
        </div>
      )}

      {record && record.words.length > 0 && (
        <section className="char-sheet-words" aria-label={`Words with ${char}`}>
          <div className="char-sheet-words-head">
            <h3>
              Words with <span lang="zh-CN">{char}</span> <FrequencyKeyButton open={keyOpen} onToggle={() => setKeyOpen((o) => !o)} />
            </h3>
            {rows && <span className="char-sheet-words-count">{charWordsSummary(rows)}</span>}
          </div>
          {keyOpen && <FrequencyKey />}
          <WordRows rows={shownRows} highlight={char} onOpen={openRow} decalOf={freq ? (h) => decalFor(freq, h, 'word') : undefined} />
          <p className="char-sheet-credit">Dictionary: CC-CEDICT, Make Me a Hanzi, wordfreq — see Settings → About.</p>
        </section>
      )}
    </div>
  );
}

/** The "Words with 字" / "Related words" list: a row per word with its badge → its Word view. */
export function WordRows({
  rows,
  highlight,
  onOpen,
  decalOf,
}: {
  rows: ReadonlyArray<CharWordRow<CharWord>>;
  /** Characters to mark inside each word (the explored character / the shared ones). */
  highlight: string;
  onOpen: (row: CharWordRow<CharWord>) => void;
  /** The word's frequency decal (an outline around its hanzi tile); none while the list loads. */
  decalOf?: (hanzi: string) => FrequencyDecal | null;
}) {
  return (
    <ul className="char-sheet-word-list">
      {rows.map((row) => {
        const decal = decalOf?.(row.word.hanzi) ?? null;
        return (
          <li key={row.word.hanzi}>
            <button
              type="button"
              className={`char-word-row char-word-row--${row.status}${row.current ? ' char-word-row--current' : ''}`}
              onClick={() => onOpen(row)}
              data-testid="char-word-row"
              data-status={row.status}
            >
              <span className={`char-word-hanzi${decalClass(decal)}`} lang="zh-CN" data-freq={decal ?? undefined}>
                {[...row.word.hanzi].map((c, i) => (
                  <span key={i} className={highlight.includes(c) ? 'char-word-self' : undefined}>{c}</span>
                ))}
              </span>
              <span className="char-word-text">
                <span className="char-word-pinyin">{row.word.pinyin}</span>
                <span className="char-word-english">{row.word.english}</span>
              </span>
              {row.status !== 'none' && <span className={`char-word-badge char-word-badge--${row.status}`}>{CHAR_STATUS_LABEL[row.status]}</span>}
              <span className="xp-row-chevron" aria-hidden="true">›</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
