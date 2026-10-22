import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cardTypeLabel, filterHoldRows, holdStatusLabel, holdTag, shortDate, type HoldFilter } from '@shared/decks';
import { localDateKey, releaseCards, restoreHolds, useHeldCardRows, type HeldCardRow } from '../services/cardHolds';
import { UndoToast } from '../components/upNext/UpNextBoard';
import '../components/upNext/upNext.css';
import '../components/cardControls/cardControls.css';

const FILTERS: Array<{ id: HoldFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'suspended', label: '⏸ Suspended' },
  { id: 'snoozed', label: '💤 Snoozed' },
];

/**
 * Settings / More → "Suspended & snoozed cards" (docs/STUDY_SESSION.md "Suspend & snooze"): every
 * card held out of study, searchable, with Unsuspend / Wake now per row and for the ticked ones.
 * Built from the device's own cards and holds, so it works offline.
 */
export function HeldCardsPage() {
  const rows = useHeldCardRows();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<HoldFilter>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const today = localDateKey();

  const shown: HeldCardRow[] = useMemo(() => filterHoldRows(rows ?? [], query, filter), [rows, query, filter]);
  const counts = useMemo(() => {
    const all = rows ?? [];
    return { all: all.length, suspended: all.filter((r) => r.hold.kind === 'suspend').length, snoozed: all.filter((r) => r.hold.kind === 'snooze').length };
  }, [rows]);
  const pickedShown = shown.filter((r) => picked.has(r.card_id));

  const release = async (list: HeldCardRow[]) => {
    if (list.length === 0) return;
    const before = list.map((r) => ({ card_id: r.card_id, kind: r.hold.kind, until: r.hold.until }));
    const r = await releaseCards(list.map((x) => x.card_id), 'held_list');
    setPicked(new Set());
    setToast({ text: r.message, undo: () => void restoreHolds(before) });
  };

  const verb = (rs: HeldCardRow[]) =>
    rs.every((r) => r.hold.kind === 'snooze') ? 'Wake now' : rs.every((r) => r.hold.kind === 'suspend') ? 'Unsuspend' : 'Back to study';

  return (
    <div className="page">
      <div className="held-page" data-testid="held-cards-page">
        <h1>Suspended &amp; snoozed cards</h1>
        <p className="settings-section-desc" style={{ margin: '0.25rem 0 0.75rem' }}>
          These cards are out of study for now. Their history and schedule are kept — bring one back and it carries on where it was.
        </p>
        <input
          className="held-search"
          type="search"
          placeholder="Search hanzi, pinyin or English"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search held cards"
          data-testid="held-search"
        />
        <div className="held-chips" role="radiogroup" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={filter === f.id}
              className={`held-chip${filter === f.id ? ' is-on' : ''}`}
              onClick={() => setFilter(f.id)}
              data-testid={`held-filter-${f.id}`}
            >
              {filter === f.id ? '✓ ' : ''}{f.label} ({counts[f.id]})
            </button>
          ))}
        </div>

        {rows === undefined ? null : shown.length === 0 ? (
          <p className="held-empty" data-testid="held-empty">
            {counts.all === 0
              ? 'Nothing is suspended or snoozed. On a card’s answer side, ⋯ → Snooze… or Suspend… takes it out of study.'
              : 'No held card matches.'}
          </p>
        ) : (
          <>
            <div className="held-bulk">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: 44 }}>
                <input
                  type="checkbox"
                  checked={pickedShown.length === shown.length && shown.length > 0}
                  onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((r) => r.card_id)) : new Set())}
                  data-testid="held-select-all"
                />
                <span>{pickedShown.length ? `${pickedShown.length} selected` : `Select all ${shown.length}`}</span>
              </label>
              {pickedShown.length > 0 && (
                <button type="button" className="btn btn-primary" onClick={() => void release(pickedShown)} data-testid="held-bulk-release">
                  {verb(pickedShown)} ({pickedShown.length})
                </button>
              )}
            </div>
            <ul className="held-list">
              {shown.map((r) => {
                const tag = holdTag(r.hold, today);
                return (
                  <li key={r.card_id} className="held-row" data-testid="held-row">
                    <input
                      type="checkbox"
                      checked={picked.has(r.card_id)}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(r.card_id);
                        else next.delete(r.card_id);
                        setPicked(next);
                      }}
                      aria-label={`Select ${r.hanzi} (${cardTypeLabel(r.card_type)})`}
                    />
                    <div className="held-row-main">
                      <div className="held-row-word">
                        <Link to={`/cards/${r.note_id}`} className="held-row-hanzi" lang="zh-CN">{r.hanzi}</Link>
                        <span className="cc-tag" title={holdStatusLabel(r.hold, today)}>
                          <span aria-hidden="true">{tag.icon}</span> {tag.text}
                        </span>
                      </div>
                      <div className="held-row-meta">{r.pinyin} · {r.english}</div>
                      <div className="held-row-meta">
                        {cardTypeLabel(r.card_type)} · {r.deck_name}
                        {r.hold.kind === 'suspend' ? ` · since ${shortDate(r.hold.created_at.slice(0, 10), today)}` : ''}
                      </div>
                    </div>
                    <button type="button" className="btn btn-secondary" onClick={() => void release([r])} data-testid="held-release">
                      {r.hold.kind === 'snooze' ? 'Wake now' : 'Unsuspend'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
      {toast && <UndoToast text={toast.text} onUndo={() => { toast.undo?.(); setToast(null); }} onDone={() => setToast(null)} hideUndo={!toast.undo} />}
    </div>
  );
}
