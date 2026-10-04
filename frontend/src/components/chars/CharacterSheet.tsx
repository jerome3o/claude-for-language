import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHAR_STATUS_LABEL, charWordsSummary, type CharRecord, type CharWord, type CharWordRow } from '@shared/chars';
import { AddChunkModal } from '../AddChunkModal';
import { charWordStatuses, explainChar, lookupChar, type CharLookup } from '../../services/charDict';
import { track } from '../../services/analytics';
import './CharacterSheet.css';

/**
 * The character sheet (docs/STUDY_SESSION.md "Character sheet"), opened by tapping a
 * character on the card back. Card-INDEPENDENT dictionary data (shared/chars, cached on the
 * device): readings, meaning, radical / components, strokes, and the frequent words with
 * the character — each marked ✓ Known / 📚 In your decks from this device's own cards.
 * A row opens the add-card sheet (⚡ Study it today when they already have it).
 * "More about 字" lazily asks for a short explanation shared by everyone.
 */
export function CharacterSheet(props: {
  char: string;
  /** The card on screen: its word(s) are highlighted and listed first. */
  cardHanzi?: string | null;
  onClose: () => void;
  /** "✍️ Write it" (the stroke-order practice). */
  onWrite?: (char: string) => void;
}) {
  const { char, cardHanzi, onClose, onWrite } = props;
  const navigate = useNavigate();
  const [lookup, setLookup] = useState<CharLookup | null>(null);
  const [rows, setRows] = useState<CharWordRow<CharWord>[] | null>(null);
  const [adding, setAdding] = useState<CharWord | null>(null);
  // Words added from this sheet: the new note reaches the device with the next sync, so they
  // show as "In your decks" right away.
  const [addedNow, setAddedNow] = useState<Set<string>>(() => new Set());
  const [more, setMore] = useState<{ state: 'idle' | 'loading' | 'done' | 'offline' | 'error'; text?: string }>({ state: 'idle' });

  useEffect(() => {
    let alive = true;
    setLookup(null);
    setRows(null);
    setMore({ state: 'idle' });
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

  const refreshRows = useCallback(() => {
    if (!record) return;
    charWordStatuses(record.words, cardHanzi)
      .then(setRows)
      .catch(() => setRows(record.words.map((word) => ({ word, status: 'none', note_ids: [], current: false }))));
  }, [record, cardHanzi]);

  useEffect(refreshRows, [refreshRows]);

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
    setAdding(row.word);
  }

  const readings = record?.readings.map((r) => r.pinyin).join(' · ');

  return (
    <div className="modal-overlay char-sheet-overlay" onClick={onClose}>
      <div className="modal char-sheet" role="dialog" aria-label={`The character ${char}`} onClick={(e) => e.stopPropagation()}>
        <div className="char-sheet-top">
          <div className="char-sheet-glyph" lang="zh-CN">{char}</div>
          <div className="char-sheet-summary">
            {readings && <div className="char-sheet-pinyin">{readings}</div>}
            {record?.meaning && <div className="char-sheet-meaning">{record.meaning}</div>}
          </div>
          <button type="button" className="modal-close char-sheet-close" onClick={onClose} aria-label="Close">&times;</button>
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
                  Radical <b lang="zh-CN">{record.radical}</b>{record.radical_meaning ? ` ${record.radical_meaning}` : ''}
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
                    <b lang="zh-CN">{c.char}</b>{c.meaning ? ` (${c.meaning})` : ''}
                  </span>
                ))}
              </div>
            )}
            {record.etymology && <div className="char-sheet-etymology">{record.etymology}</div>}
          </>
        )}

        <div className="char-sheet-actions">
          {onWrite && (
            <button type="button" className="btn btn-secondary char-sheet-action" onClick={() => onWrite(char)}>
              ✍️ Write it
            </button>
          )}
          {more.state === 'idle' && (
            <button type="button" className="btn btn-secondary char-sheet-action" onClick={askMore}>
              ✨ More about {char}
            </button>
          )}
        </div>
        {more.state === 'loading' && <div className="char-sheet-more char-sheet-more--muted">Asking Claude…</div>}
        {more.state === 'done' && <div className="char-sheet-more" data-testid="char-sheet-more">{more.text}</div>}
        {more.state === 'offline' && <div className="char-sheet-more char-sheet-more--muted">Needs a connection — the dictionary above works offline.</div>}
        {more.state === 'error' && (
          <div className="char-sheet-more char-sheet-more--muted">
            {more.text} <button type="button" className="char-sheet-link" onClick={askMore}>Try again</button>
          </div>
        )}

        {record && record.words.length > 0 && (
          <section className="char-sheet-words" aria-label={`Words with ${char}`}>
            <div className="char-sheet-words-head">
              <h3>Words with <span lang="zh-CN">{char}</span></h3>
              {rows && (
                <span className="char-sheet-words-count">
                  {charWordsSummary(rows.map((r) => (r.status === 'none' && addedNow.has(r.word.hanzi) ? { status: 'in_decks' as const } : r)))}
                </span>
              )}
            </div>
            <ul className="char-sheet-word-list">
              {(rows ?? record.words.map((word) => ({ word, status: 'none' as const, note_ids: [], current: false })))
                .map((row) => (row.status === 'none' && addedNow.has(row.word.hanzi) ? { ...row, status: 'in_decks' as const } : row))
                .map((row) => (
                <li key={row.word.hanzi}>
                  <button
                    type="button"
                    className={`char-word-row char-word-row--${row.status}${row.current ? ' char-word-row--current' : ''}`}
                    onClick={() => openRow(row)}
                    data-testid="char-word-row"
                    data-status={row.status}
                  >
                    <span className="char-word-hanzi" lang="zh-CN">
                      {[...row.word.hanzi].map((c, i) => (
                        <span key={i} className={c === char ? 'char-word-self' : undefined}>{c}</span>
                      ))}
                    </span>
                    <span className="char-word-text">
                      <span className="char-word-pinyin">{row.word.pinyin}</span>
                      <span className="char-word-english">{row.word.english}</span>
                    </span>
                    {row.status !== 'none' && (
                      <span className={`char-word-badge char-word-badge--${row.status}`}>{CHAR_STATUS_LABEL[row.status]}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <p className="char-sheet-credit">Dictionary: CC-CEDICT, Make Me a Hanzi, wordfreq — see Settings → About.</p>
          </section>
        )}
      </div>

      {adding && (
        <div onClick={(e) => e.stopPropagation()}>
          <AddChunkModal
            source="char_sheet"
            chunk={{ hanzi: adding.hanzi, pinyin: adding.pinyin, english: adding.english }}
            onOpenCard={(noteId) => {
              onClose();
              navigate(`/cards/${noteId}`);
            }}
            onAdded={() => {
              track('study.char_word_added', {});
              const hanzi = adding.hanzi;
              setAddedNow((prev) => new Set(prev).add(hanzi));
            }}
            onClose={() => {
              setAdding(null);
              refreshRows();
            }}
          />
        </div>
      )}
    </div>
  );
}
