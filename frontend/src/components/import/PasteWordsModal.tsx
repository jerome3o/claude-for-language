/**
 * "Paste a list" — add or update many words at once from text pasted out of a
 * spreadsheet, a Word table, a WeChat message or a hand-typed list.
 *
 * The flow (see docs/TUTOR_GUIDE.md § Adding many words at once):
 *   1. Paste. Separators and column roles are detected (shared/import/parse);
 *      a caption says what was detected and "Not parsed right?" exposes overrides.
 *   2. Preview. Every row is matched against the deck by hanzi and shown as
 *      New / Update (with old → new) / Same / Skipped / Needs attention.
 *      Missing pinyin is filled from pinyin-pro on the device; missing English
 *      (and better pinyin) comes from one Claude call when online. A second
 *      step, "Write explanations & example sentences", asks Claude (Sonnet, to
 *      the card standard) for the fun facts and the card sentence of every
 *      row that has none — so a pasted list of bare words becomes the same
 *      quality of card the MCP tools make. Anything filled in is marked ✨
 *      until the tutor edits it. Rows can be edited or skipped inline.
 *   3. Save. One request per row through the normal note endpoints (TTS and
 *      sentence sets are generated as usual), with progress and per-row errors.
 *   4. For a tutor whose deck is shared, "Update their copy" per student.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { pinyin as toPinyin, polyphonic } from 'pinyin-pro';
import {
  parseWordList,
  planImport,
  summarizePlan,
  normalizeHanzi,
  hasToneInfo,
  type ColumnSeparator,
  type RowSeparator,
  type ExistingPolicy,
  type ParsedRow,
  type PlannedRow,
} from '@shared/import';
import { glossWords, enrichWords, getDeckStudentShares, type DeckStudentShare } from '../../api/client';
import { updateSharedDeckCopy } from '../../api/tutorDashboard';
import { runImport, type ImportOutcome, type ImportProgress } from '../../services/wordImport';
import { useNetwork } from '../../contexts/NetworkContext';
import type { Note } from '../../types';
import './PasteWordsModal.css';

interface Props {
  deckId: string;
  deckName: string;
  existingNotes: Note[];
  onClose: () => void;
  /** Called after a successful import so the page can refresh. */
  onImported: (outcome: ImportOutcome) => void;
}

type RowEdit = Partial<Pick<ParsedRow, 'hanzi' | 'pinyin' | 'english' | 'sentence' | 'notes'>>;
type Suggestion = { pinyin?: string; english?: string; fun_facts?: string; sentence?: string; sentencePinyin?: string; sentenceTranslation?: string };

/** Words per Claude call when writing explanations (Sonnet; keeps each call short). */
const ENRICH_CHUNK = 15;
const ENRICH_MAX = 150;

const PLACEHOLDER = `苹果\tpíng guǒ\tapple
香蕉\txiāng jiāo\tbanana
葡萄

One word per line — columns from a spreadsheet, "苹果 apple", or just the characters. Pinyin and English are filled in for you.`;

const rowKey = (r: ParsedRow) => (r.problems.includes('no_chinese') ? `#${r.index}` : normalizeHanzi(r.hanzi));

const SEP_LABEL: Record<Exclude<ColumnSeparator, 'auto'>, string> = {
  tab: 'tab between columns',
  comma: 'commas between columns',
  pipe: '| between columns',
  colon: '"–" / ":" between word and meaning',
  space: 'spaces between word, pinyin and meaning',
  custom: 'your separator',
};

export function PasteWordsModal({ deckId, deckName, existingNotes, onClose, onImported }: Props) {
  const { isOnline } = useNetwork();
  const [text, setText] = useState('');
  const [columnSeparator, setColumnSeparator] = useState<ColumnSeparator>('auto');
  const [customSeparator, setCustomSeparator] = useState('');
  const [rowSeparator, setRowSeparator] = useState<RowSeparator>('auto');
  const [policy, setPolicy] = useState<ExistingPolicy>('update');
  const [edits, setEdits] = useState<Map<string, RowEdit>>(new Map());
  const [suggested, setSuggested] = useState<Map<string, Suggestion>>(new Map());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [gloss, setGloss] = useState<'idle' | 'loading' | 'error' | 'unavailable'>('idle');
  // The text Claude last completed — the button hides until the list changes again.
  const [glossedText, setGlossedText] = useState<string | null>(null);
  const [enrich, setEnrich] = useState<'idle' | 'loading' | 'error' | 'unavailable'>('idle');
  const [enrichProgress, setEnrichProgress] = useState({ done: 0, total: 0 });
  const [enrichedText, setEnrichedText] = useState<string | null>(null);
  // How many rows were saved without an explanation, for the reminder on the done screen.
  const [savedBare, setSavedBare] = useState(0);
  const [stage, setStage] = useState<'edit' | 'running' | 'done'>('edit');
  const [progress, setProgress] = useState<ImportProgress>({ done: 0, total: 0 });
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [shares, setShares] = useState<DeckStudentShare[]>([]);
  const [shareState, setShareState] = useState<Map<string, { busy: boolean; note?: string }>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // A tutor's copies of this deck (empty for everyone else; failures are silent).
  const loadShares = () => {
    getDeckStudentShares(deckId)
      .then(setShares)
      .catch(() => setShares([]));
  };
  useEffect(loadShares, [deckId]);

  const parsed = useMemo(
    () => parseWordList(text, { columnSeparator, customSeparator, rowSeparator }),
    [text, columnSeparator, customSeparator, rowSeparator]
  );

  // Effective rows: pasted values, then Claude's suggestion, then on-device
  // pinyin, with the tutor's own edits on top of everything.
  const rows = useMemo(() => {
    return parsed.rows.map(r => {
      const key = rowKey(r);
      const edit = edits.get(key) || {};
      const sug = suggested.get(key) || {};
      const hanzi = edit.hanzi ?? r.hanzi;
      const pastedPinyin = r.pinyin && hasToneInfo(r.pinyin) ? r.pinyin : '';
      const autoPinyin = hanzi && /\p{Script=Han}/u.test(hanzi) ? toPinyin(hanzi) : '';
      const pinyinValue = edit.pinyin ?? (pastedPinyin || sug.pinyin || r.pinyin || autoPinyin);
      const englishValue = edit.english ?? (r.english || sug.english || '');
      const notesValue = edit.notes ?? (r.notes || sug.fun_facts || '');
      const sentenceFromClaude = edit.sentence === undefined && !r.sentence && !!sug.sentence;
      const sentenceValue = edit.sentence ?? (r.sentence || sug.sentence || '');
      const filled = {
        pinyin: edit.pinyin === undefined && !pastedPinyin && !!pinyinValue,
        english: edit.english === undefined && !r.english && !!englishValue,
        notes: edit.notes === undefined && !r.notes && !!notesValue,
        sentence: sentenceFromClaude,
      };
      // A one-character word with several readings deserves a look.
      const readings = hanzi.length === 1 && filled.pinyin ? (polyphonic(hanzi)[0] || '').split(' ').filter(Boolean) : [];
      const row: ParsedRow = {
        ...r,
        hanzi,
        pinyin: pinyinValue,
        english: englishValue,
        sentence: sentenceValue,
        notes: notesValue,
        // Claude's pinyin / translation ride with Claude's sentence; a pasted or
        // edited sentence gets on-device pinyin so the card back is never bare.
        sentencePinyin: sentenceFromClaude ? sug.sentencePinyin : sentenceValue && /\p{Script=Han}/u.test(sentenceValue) ? toPinyin(sentenceValue) : undefined,
        sentenceTranslation: sentenceFromClaude ? sug.sentenceTranslation : undefined,
        problems: hanzi && /\p{Script=Han}/u.test(hanzi) ? r.problems.filter(p => p !== 'no_chinese') : r.problems,
      };
      return { key, row, filled, readings: readings.length > 1 ? readings : [] };
    });
  }, [parsed, edits, suggested]);

  const plan = useMemo(() => {
    const excludedIdx = new Set<number>();
    for (const { key, row } of rows) if (excluded.has(key)) excludedIdx.add(row.index);
    return planImport(rows.map(x => x.row), existingNotes, policy, excludedIdx);
  }, [rows, existingNotes, policy, excluded]);
  const summary = useMemo(() => summarizePlan(plan), [plan]);
  const byIndex = useMemo(() => new Map(rows.map(x => [x.row.index, x])), [rows]);

  // Rows whose card would be saved without an explanation or an example
  // sentence (and whose existing note, if any, has none either).
  const enrichable = plan.filter(p => {
    if (p.action !== 'add' && p.action !== 'update' && p.action !== 'unchanged') return false;
    if (!p.row.hanzi || !p.row.english) return false;
    const needsNotes = !p.row.notes && !p.existing?.fun_facts;
    const needsSentence = !p.row.sentence && !p.existing?.sentence_clue;
    return needsNotes || needsSentence;
  });

  const writeWithClaude = async () => {
    const targets = enrichable.slice(0, ENRICH_MAX);
    if (targets.length === 0) return;
    setEnrich('loading');
    setEnrichProgress({ done: 0, total: targets.length });
    try {
      for (let i = 0; i < targets.length; i += ENRICH_CHUNK) {
        const chunk = targets.slice(i, i + ENRICH_CHUNK);
        const result = await enrichWords(
          chunk.map(p => ({
            hanzi: p.row.hanzi,
            pinyin: p.row.pinyin || undefined,
            english: p.row.english || undefined,
            fun_facts: p.row.notes || p.existing?.fun_facts || undefined,
            sentence_clue: p.row.sentence || p.existing?.sentence_clue || undefined,
          }))
        );
        setSuggested(prev => {
          const next = new Map(prev);
          for (const w of result) {
            const target = chunk.find(p => normalizeHanzi(p.row.hanzi) === normalizeHanzi(w.hanzi));
            if (!target) continue;
            const key = rowKey(target.row);
            const cur = prev.get(key) || {};
            const needsNotes = !target.row.notes && !target.existing?.fun_facts;
            const needsSentence = !target.row.sentence && !target.existing?.sentence_clue;
            next.set(key, {
              ...cur,
              fun_facts: needsNotes && w.fun_facts ? w.fun_facts : cur.fun_facts,
              sentence: needsSentence && w.sentence_clue ? w.sentence_clue : cur.sentence,
              sentencePinyin: needsSentence && w.sentence_clue ? w.sentence_clue_pinyin || undefined : cur.sentencePinyin,
              sentenceTranslation: needsSentence && w.sentence_clue ? w.sentence_clue_translation || undefined : cur.sentenceTranslation,
            });
          }
          return next;
        });
        setEnrichProgress({ done: Math.min(i + chunk.length, targets.length), total: targets.length });
      }
      setEnrich('idle');
      setEnrichedText(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setEnrich(/not configured|503/i.test(message) ? 'unavailable' : 'error');
    }
  };

  const missingEnglish = plan.filter(p => (p.action === 'problem' && p.missing.includes('english')) || (p.action === 'add' && !p.row.english));
  const glossable = plan.filter(p => p.action !== 'problem' || p.reason === 'incomplete').filter(p => !p.row.english || byIndex.get(p.row.index)?.filled.pinyin);

  const fillWithClaude = async () => {
    const targets = glossable.slice(0, 100);
    if (targets.length === 0) return;
    setGloss('loading');
    try {
      const result = await glossWords(
        targets.map(p => ({
          hanzi: p.row.hanzi,
          pinyin: byIndex.get(p.row.index)?.filled.pinyin ? undefined : p.row.pinyin || undefined,
          english: p.row.english || undefined,
        }))
      );
      setSuggested(prev => {
        const next = new Map(prev);
        for (const w of result) {
          const target = targets.find(p => normalizeHanzi(p.row.hanzi) === normalizeHanzi(w.hanzi));
          if (!target) continue;
          const key = rowKey(target.row);
          next.set(key, { pinyin: w.pinyin || prev.get(key)?.pinyin, english: w.english || prev.get(key)?.english });
        }
        return next;
      });
      setGloss('idle');
      setGlossedText(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setGloss(/not configured|503/i.test(message) ? 'unavailable' : 'error');
    }
  };

  const setEdit = (key: string, patch: RowEdit) =>
    setEdits(prev => {
      const next = new Map(prev);
      next.set(key, { ...(prev.get(key) || {}), ...patch });
      return next;
    });
  const toggleExcluded = (key: string) =>
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const save = async () => {
    setSavedBare(plan.filter(p => (p.action === 'add' || p.action === 'update') && !p.row.notes && !p.existing?.fun_facts).length);
    setStage('running');
    const result = await runImport(deckId, plan, setProgress);
    setOutcome(result);
    setStage('done');
    onImported(result);
    loadShares();
  };

  const updateShare = async (share: DeckStudentShare) => {
    setShareState(prev => new Map(prev).set(share.shared_deck_id, { busy: true }));
    try {
      const res = await updateSharedDeckCopy(share.relationship_id, share.shared_deck_id);
      const parts = [res.added ? `added ${res.added}` : '', res.updated ? `updated ${res.updated}` : ''].filter(Boolean);
      setShareState(prev => new Map(prev).set(share.shared_deck_id, { busy: false, note: parts.length ? `${parts.join(', ')} — their progress is kept` : 'Already up to date' }));
      loadShares();
    } catch (err) {
      setShareState(prev => new Map(prev).set(share.shared_deck_id, { busy: false, note: err instanceof Error ? err.message : 'Could not update' }));
    }
  };

  const problems = plan.filter(p => p.action === 'problem');
  const updates = plan.filter(p => p.action === 'update');
  const adds = plan.filter(p => p.action === 'add');
  const skipped = plan.filter(p => p.action === 'skip');
  const unchanged = plan.filter(p => p.action === 'unchanged');
  const canSave = stage === 'edit' && (summary.add > 0 || summary.update > 0) && isOnline;

  const detectedCaption = (() => {
    if (parsed.rows.length === 0) return null;
    const bits = [SEP_LABEL[parsed.detected.columnSeparator], `${parsed.rows.length} ${parsed.rows.length === 1 ? 'row' : 'rows'}`];
    if (parsed.detected.rowSeparator === 'semicolon') bits.push('rows split at ";"');
    if (parsed.detected.headerDropped) bits.push('header row skipped');
    return bits.join(' · ');
  })();

  const renderRow = (p: PlannedRow) => {
    const x = byIndex.get(p.row.index);
    if (!x) return null;
    const { key, row, filled, readings } = x;
    const isEditing = editing === key;
    const chip =
      p.action === 'add' ? <span className="pw-chip pw-chip--new">New</span>
      : p.action === 'update' ? <span className="pw-chip pw-chip--update">Update</span>
      : p.action === 'unchanged' ? <span className="pw-chip pw-chip--same">Same</span>
      : p.action === 'skip' ? <span className="pw-chip pw-chip--skip">{p.reason === 'duplicate_in_paste' ? 'Duplicate in paste' : p.reason === 'policy' ? 'Already in deck' : 'Skipped'}</span>
      : <span className="pw-chip pw-chip--problem">{p.reason === 'no_chinese' ? 'No Chinese' : `Needs ${p.missing.join(' + ')}`}</span>;
    return (
      <li key={key} className={`pw-row pw-row--${p.action}${isEditing ? ' pw-row--editing' : ''}`}>
        <button type="button" className="pw-row-main" onClick={() => setEditing(isEditing ? null : key)} aria-expanded={isEditing}>
          <span className="pw-hanzi">{row.hanzi || <em>{row.raw}</em>}</span>
          <span className="pw-detail">
            {row.pinyin && (
              <span className={filled.pinyin ? 'pw-filled' : ''} title={filled.pinyin ? 'Filled in automatically' : undefined}>
                {filled.pinyin && '✨ '}{row.pinyin}
              </span>
            )}
            {row.pinyin && row.english && <span className="pw-dot">·</span>}
            {row.english && (
              <span className={filled.english ? 'pw-filled' : ''} title={filled.english ? 'Filled in by Claude' : undefined}>
                {filled.english && '✨ '}{row.english}
              </span>
            )}
          </span>
          {(row.sentence || row.notes) && (
            <span className="pw-extra">
              {row.sentence && (
                <span className={filled.sentence ? 'pw-filled' : ''} lang="zh" title={filled.sentence ? 'Written by Claude' : undefined}>
                  {filled.sentence && '✨ '}{row.sentence}
                </span>
              )}
              {row.notes && (
                <span className={`pw-notes-flag${filled.notes ? ' pw-filled' : ''}`} title={row.notes}>
                  {filled.notes ? '✨ explanation written' : 'has explanation'}
                </span>
              )}
            </span>
          )}
          {readings.length > 0 && <span className="pw-hint">Check the reading: {readings.join(' / ')}</span>}
          {p.action === 'update' && (
            <span className="pw-changes">
              {p.changes.map(ch => (
                <span key={ch.field} className="pw-change">
                  <span className="pw-change-field">{ch.field === 'fun_facts' ? 'notes' : ch.field === 'sentence_clue' ? 'sentence' : ch.field}</span>
                  <s>{ch.from || '—'}</s> → {ch.to}
                </span>
              ))}
            </span>
          )}
        </button>
        <span className="pw-row-side">{chip}</span>
        {isEditing && (
          <div className="pw-editor">
            <label>
              <span>Hanzi</span>
              <input className="form-input hanzi" value={row.hanzi} onChange={e => setEdit(key, { hanzi: e.target.value })} />
            </label>
            <label>
              <span>Pinyin</span>
              <input className="form-input" value={row.pinyin} onChange={e => setEdit(key, { pinyin: e.target.value })} placeholder="píng guǒ" />
            </label>
            <label>
              <span>English</span>
              <input className="form-input" value={row.english} onChange={e => setEdit(key, { english: e.target.value })} placeholder="apple" />
            </label>
            <label>
              <span>Example sentence (optional)</span>
              <input className="form-input" value={row.sentence} onChange={e => setEdit(key, { sentence: e.target.value })} placeholder="我每天吃一个苹果。" />
            </label>
            <label>
              <span>Explanation / fun facts (optional)</span>
              <textarea className="form-textarea pw-notes-input" value={row.notes} onChange={e => setEdit(key, { notes: e.target.value })} rows={4} placeholder={'苹 (píng) apple + 果 (guǒ) fruit\nUsed for the fruit only; the company is 苹果公司.'} />
            </label>
            <label className="pw-skip">
              <input type="checkbox" checked={excluded.has(key)} onChange={() => toggleExcluded(key)} /> Skip this row
            </label>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>Done</button>
          </div>
        )}
      </li>
    );
  };

  const renderGroup = (title: string, items: PlannedRow[], extra?: React.ReactNode) =>
    items.length === 0 ? null : (
      <section className="pw-group">
        <h3 className="pw-group-title">{title} <span className="pw-count">{items.length}</span>{extra}</h3>
        <ul className="pw-list">{items.map(renderRow)}</ul>
      </section>
    );

  return (
    <div className="modal-overlay" onClick={stage === 'running' ? undefined : onClose}>
      <div className="modal pw-modal" onClick={e => e.stopPropagation()} role="dialog" aria-labelledby="pw-title">
        <div className="modal-header">
          <h2 className="modal-title" id="pw-title">{stage === 'done' ? 'Words saved' : 'Paste a word list'}</h2>
          {stage !== 'running' && (
            <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
          )}
        </div>

        {stage === 'edit' && (
          <>
            <textarea
              ref={textareaRef}
              className="form-textarea pw-textarea"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={PLACEHOLDER}
              rows={9}
              aria-label="Word list"
              spellCheck={false}
            />
            <div className="pw-options">
              <div className="pw-option-row">
                <span className="pw-option-label">Separator</span>
                {(['auto', 'tab', 'comma', 'space', 'pipe', 'colon', 'custom'] as ColumnSeparator[]).map(v => (
                  <button
                    key={v}
                    type="button"
                    className={`pw-pill${columnSeparator === v ? ' pw-pill--on' : ''}`}
                    onClick={() => setColumnSeparator(v)}
                    aria-pressed={columnSeparator === v}
                  >
                    {v === 'auto' ? 'Auto' : v === 'tab' ? 'Tab' : v === 'comma' ? 'Comma' : v === 'space' ? 'Space' : v === 'pipe' ? '|' : v === 'colon' ? '– / :' : 'Custom'}
                  </button>
                ))}
                <input
                  className="form-input pw-custom"
                  value={customSeparator}
                  onChange={e => {
                    setCustomSeparator(e.target.value);
                    setColumnSeparator(e.target.value ? 'custom' : 'auto');
                  }}
                  placeholder="e.g. --"
                  aria-label="Custom separator"
                />
              </div>
              <div className="pw-option-row">
                <span className="pw-option-label">One word per</span>
                {(['auto', 'newline', 'semicolon'] as RowSeparator[]).map(v => (
                  <button key={v} type="button" className={`pw-pill${rowSeparator === v ? ' pw-pill--on' : ''}`} onClick={() => setRowSeparator(v)} aria-pressed={rowSeparator === v}>
                    {v === 'auto' ? 'Auto' : v === 'newline' ? 'Line' : 'Semicolon'}
                  </button>
                ))}
              </div>
              <div className="pw-detected">
                {detectedCaption ? <span>Reading it as: {detectedCaption}</span> : <span>Adding to <strong>{deckName}</strong> — paste a list, one word per line.</span>}
              </div>
            </div>

            {parsed.rows.length > 0 && (
              <div className="pw-controls">
                <label className="pw-policy">
                  <span>Words already in this deck</span>
                  <select className="form-input" value={policy} onChange={e => setPolicy(e.target.value as ExistingPolicy)}>
                    <option value="update">Update them</option>
                    <option value="skip">Leave them as they are</option>
                    <option value="duplicate">Add again as new cards</option>
                  </select>
                </label>
                {glossable.length > 0 && gloss !== 'unavailable' && glossedText !== text && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm pw-gloss"
                    onClick={fillWithClaude}
                    disabled={!isOnline || gloss === 'loading'}
                    title={!isOnline ? 'Needs internet' : undefined}
                  >
                    {gloss === 'loading' ? 'Asking Claude…' : missingEnglish.length > 0 ? `✨ Fill in English with Claude (${missingEnglish.length})` : '✨ Check pinyin with Claude'}
                  </button>
                )}
                {gloss === 'idle' && glossedText === text && glossable.length > 0 && <span className="pw-muted">✨ Filled in by Claude — tap a row to change anything.</span>}
                {gloss === 'error' && <span className="pw-error">Claude could not fill these in — try again or type them.</span>}
                {gloss === 'unavailable' && <span className="pw-error">Claude is not set up on this server — type the English yourself.</span>}
              </div>
            )}

            {parsed.rows.length > 0 && enrich !== 'unavailable' && (enrichable.length > 0 || enrichedText === text) && (
              <div className={`pw-enrich${enrichable.length > 0 && enrich !== 'loading' && enrichedText !== text ? ' pw-enrich--nudge' : ''}`} data-testid="enrich-step">
                {enrich === 'loading' ? (
                  <span className="pw-muted">✨ Writing explanations and example sentences… {enrichProgress.done} of {enrichProgress.total}</span>
                ) : enrichable.length === 0 ? (
                  <span className="pw-muted">✨ Every word has an explanation and an example sentence — tap a row to read or change them.</span>
                ) : (
                  <>
                    <span className="pw-enrich-text">
                      <strong>{enrichable.length} {enrichable.length === 1 ? 'word has' : 'words have'} no explanation or example sentence yet.</strong>{' '}
                      Cards study much better with both: the explanation goes on the back of the card and the sentence gets its own audio.
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm pw-enrich-btn"
                      onClick={writeWithClaude}
                      disabled={!isOnline}
                      title={!isOnline ? 'Needs internet' : undefined}
                      data-testid="enrich-button"
                    >
                      ✨ Write them with Claude ({Math.min(enrichable.length, ENRICH_MAX)})
                    </button>
                    {enrich === 'error' && <span className="pw-error">Claude could not write these just now — try again, or save and add them later.</span>}
                  </>
                )}
              </div>
            )}
            {parsed.rows.length > 0 && enrich === 'unavailable' && <div className="pw-enrich"><span className="pw-error">Claude is not set up on this server — explanations have to be typed by hand.</span></div>}

            {renderGroup('Needs attention', problems)}
            {renderGroup('Updates', updates)}
            {renderGroup('New words', adds)}
            {renderGroup('Skipped', skipped)}
            {unchanged.length > 0 && (
              <section className="pw-group">
                <h3 className="pw-group-title">
                  Already the same <span className="pw-count">{unchanged.length}</span>
                  <button type="button" className="pw-link" onClick={() => setShowUnchanged(v => !v)}>{showUnchanged ? 'Hide' : 'Show'}</button>
                </h3>
                {showUnchanged && <ul className="pw-list">{unchanged.map(renderRow)}</ul>}
              </section>
            )}

            <div className="pw-footer">
              <div className="pw-summary" aria-live="polite">
                {parsed.rows.length === 0
                  ? 'Paste or type a list to see a preview.'
                  : [
                      summary.add ? `${summary.add} new` : '',
                      summary.update ? `${summary.update} to update` : '',
                      summary.unchanged ? `${summary.unchanged} unchanged` : '',
                      summary.skipped ? `${summary.skipped} skipped` : '',
                      summary.problems ? `${summary.problems} need attention` : '',
                    ].filter(Boolean).join(' · ')}
                {!isOnline && parsed.rows.length > 0 && <div className="pw-error">You are offline — saving needs internet.</div>}
              </div>
              <div className="modal-actions pw-actions">
                <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={save} disabled={!canSave}>
                  {summary.add && summary.update ? `Add ${summary.add} · Update ${summary.update}` : summary.update ? `Update ${summary.update}` : `Add ${summary.add || ''}`.trim()}
                </button>
              </div>
            </div>
          </>
        )}

        {stage === 'running' && (
          <div className="pw-running" aria-live="polite">
            <div className="pw-progress"><div className="pw-progress-bar" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
            <p>Saving {progress.current ? <strong>{progress.current}</strong> : ''} — {progress.done} of {progress.total}</p>
          </div>
        )}

        {stage === 'done' && outcome && (
          <div className="pw-done">
            <p className="pw-done-line">
              {[outcome.added ? `Added ${outcome.added}` : '', outcome.updated ? `updated ${outcome.updated}` : ''].filter(Boolean).join(', ') || 'Nothing to save'}
              {outcome.failed.length > 0 && ` · ${outcome.failed.length} failed`}
            </p>
            {outcome.added > 0 && <p className="pw-muted">Audio and example sentences are generated in the background — give them a minute.</p>}
            {savedBare > 0 && (
              <p className="pw-reminder" data-testid="bare-reminder">
                {savedBare} {savedBare === 1 ? 'word was' : 'words were'} saved without an explanation. Paste the same list again and tap <strong>✨ Write them with Claude</strong> to add explanations and example sentences — existing progress is kept.
              </p>
            )}
            {outcome.failed.length > 0 && (
              <ul className="pw-failed">
                {outcome.failed.map(f => (
                  <li key={f.row.row.index}><strong>{f.row.row.hanzi}</strong> — {f.error}</li>
                ))}
              </ul>
            )}
            {shares.length > 0 && (
              <section className="pw-shares">
                <h3 className="pw-group-title">Send the changes to your students</h3>
                <ul className="pw-list">
                  {shares.map(s => {
                    const st = shareState.get(s.shared_deck_id);
                    const behind = [s.notes_missing ? `${s.notes_missing} new` : '', s.notes_behind ? `${s.notes_behind} changed` : ''].filter(Boolean).join(' · ');
                    return (
                      <li key={s.shared_deck_id} className="pw-share">
                        <span className="pw-share-name">
                          {s.student_name}
                          <span className="pw-muted"> {s.target_deleted ? 'no longer has this deck' : st?.note ? st.note : behind ? `${behind} waiting` : 'up to date'}</span>
                        </span>
                        {!s.target_deleted && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => updateShare(s)} disabled={st?.busy || !isOnline}>
                            {st?.busy ? 'Updating…' : 'Update their copy'}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
