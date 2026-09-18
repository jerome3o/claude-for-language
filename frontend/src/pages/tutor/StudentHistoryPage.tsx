/**
 * Full history explorer — every attempt the student made, newest first, with
 * a sticky filter bar, infinite scroll, and a "by word" grouping of whatever
 * has been loaded so far.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getStudentHistory } from '../../api/insights';
import type { HistoryEvent } from '../../types/insights';
import type { CardType } from '../../types';
import { Loading } from '../../components/Loading';
import {
  TutorPageFrame,
  TutorPageNav,
  RatingDot,
  CardTypeChip,
  RecordingButton,
  AnswerDiff,
  formatDateTime,
  formatSeconds,
  toDateInputValue,
  answersMatch,
  RATING_LABELS,
  CARD_TYPE_LONG,
} from './tutor-shared';

type RangeKey = 'lesson' | '7d' | '30d' | '90d' | '365d';

interface Filters {
  q: string;
  deck_id: string;
  card_type: CardType | '';
  rating: number | '';
  range: RangeKey;
}

function rangeToQuery(range: RangeKey): { from?: string } {
  if (range === 'lesson') return {};
  const days = Number(range.replace('d', ''));
  return { from: toDateInputValue(new Date(Date.now() - days * 86_400_000)) };
}

export function StudentHistoryPage() {
  const { relId } = useParams<{ relId: string }>();
  return (
    <TutorPageFrame relId={relId!} title="History">
      {() => <HistoryBody relId={relId!} />}
    </TutorPageFrame>
  );
}

function HistoryBody({ relId }: { relId: string }) {
  const [filters, setFilters] = useState<Filters>({ q: '', deck_id: '', card_type: '', rating: '', range: '30d' });
  const [debouncedQ, setDebouncedQ] = useState('');
  const [view, setView] = useState<'attempt' | 'word'>('attempt');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q.trim()), 300);
    return () => clearTimeout(t);
  }, [filters.q]);

  const queryParams = useMemo(
    () => ({
      ...rangeToQuery(filters.range),
      deck_id: filters.deck_id || undefined,
      card_type: filters.card_type,
      rating: filters.rating,
      q: debouncedQ || undefined,
      limit: 100,
    }),
    [filters.range, filters.deck_id, filters.card_type, filters.rating, debouncedQ]
  );

  const historyQuery = useInfiniteQuery({
    queryKey: ['studentHistory', relId, queryParams],
    queryFn: ({ pageParam }) => getStudentHistory(relId, { ...queryParams, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });

  const events = useMemo(() => historyQuery.data?.pages.flatMap((p) => p.events) ?? [], [historyQuery.data]);
  const decks = historyQuery.data?.pages[0]?.decks ?? [];
  const range = historyQuery.data?.pages[0]?.range;

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && historyQuery.hasNextPage && !historyQuery.isFetchingNextPage) {
        historyQuery.fetchNextPage();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [historyQuery.hasNextPage, historyQuery.isFetchingNextPage, historyQuery.fetchNextPage, historyQuery]);

  return (
    <>
      <TutorPageNav relId={relId} current="history" />

      <div className="tutor-filter-bar">
        <div className="tutor-filter-row">
          <input
            type="search"
            placeholder="Search hanzi, pinyin or English"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            aria-label="Search"
          />
        </div>
        <div className="tutor-filter-row">
          <select value={filters.deck_id} onChange={(e) => setFilters({ ...filters, deck_id: e.target.value })} aria-label="Deck">
            <option value="">All decks</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select value={filters.card_type} onChange={(e) => setFilters({ ...filters, card_type: e.target.value as CardType | '' })} aria-label="Card type">
            <option value="">All card types</option>
            {(Object.keys(CARD_TYPE_LONG) as CardType[]).map((ct) => (
              <option key={ct} value={ct}>{CARD_TYPE_LONG[ct]}</option>
            ))}
          </select>
          <select
            value={filters.rating === '' ? '' : String(filters.rating)}
            onChange={(e) => setFilters({ ...filters, rating: e.target.value === '' ? '' : Number(e.target.value) })}
            aria-label="Rating"
          >
            <option value="">Any rating</option>
            {RATING_LABELS.map((label, i) => (
              <option key={label} value={i}>{label}</option>
            ))}
          </select>
          <select value={filters.range} onChange={(e) => setFilters({ ...filters, range: e.target.value as RangeKey })} aria-label="Range">
            <option value="lesson">Since last lesson</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="365d">Last year</option>
          </select>
        </div>
        <div className="tutor-filter-row" style={{ alignItems: 'center' }}>
          <span className="tutor-range-note" style={{ width: 'auto' }}>
            {range ? `${formatDateTime(range.from)} → ${formatDateTime(range.to)} · ${events.length} loaded` : ''}
          </span>
          <div className="tutor-view-toggle" role="group" aria-label="View">
            <button type="button" className={view === 'attempt' ? 'active' : ''} onClick={() => setView('attempt')}>By attempt</button>
            <button type="button" className={view === 'word' ? 'active' : ''} onClick={() => setView('word')}>By word</button>
          </div>
        </div>
      </div>

      {historyQuery.isLoading && <Loading message="Loading history..." />}
      {historyQuery.error && (
        <div className="tutor-error">{historyQuery.error instanceof Error ? historyQuery.error.message : 'Failed to load history'}</div>
      )}

      {historyQuery.data && events.length === 0 && (
        <div className="tutor-card tutor-empty">No attempts match these filters.</div>
      )}

      {view === 'attempt' ? <AttemptList events={events} /> : <WordList events={events} />}

      <div ref={sentinelRef} className="tutor-load-more">
        {historyQuery.isFetchingNextPage
          ? 'Loading more…'
          : historyQuery.hasNextPage
            ? 'Scroll for more'
            : events.length > 0
              ? 'That is everything in this range.'
              : ''}
      </div>
    </>
  );
}

function AttemptRow({ ev, showWord = true }: { ev: HistoryEvent; showWord?: boolean }) {
  return (
    <div className="tutor-history-row">
      <div className="tutor-history-top">
        <span className="tutor-attempt-time">{formatDateTime(ev.reviewed_at)}</span>
        <CardTypeChip cardType={ev.card_type} />
        <RatingDot rating={ev.rating} withLabel />
        {showWord && (
          <>
            <span className="tutor-word-hanzi">{ev.hanzi}</span>
            <span className="tutor-word-pinyin">{ev.pinyin}</span>
            <span className="tutor-word-english">{ev.english}</span>
          </>
        )}
        <span className="tutor-attempt-right">
          <span className="tutor-attempt-secs">{formatSeconds(ev.time_spent_ms)}</span>
          {ev.recording_url && <RecordingButton url={ev.recording_url} compact />}
        </span>
      </div>
      {ev.user_answer && (
        <div className="tutor-history-answer">
          <AnswerDiff userAnswer={ev.user_answer} correctAnswer={ev.hanzi} />
        </div>
      )}
    </div>
  );
}

function AttemptList({ events }: { events: HistoryEvent[] }) {
  return (
    <div className="tutor-history-list">
      {events.map((ev) => (
        <AttemptRow key={ev.event_id} ev={ev} />
      ))}
    </div>
  );
}

function WordList({ events }: { events: HistoryEvent[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => {
    const map = new Map<string, { note: HistoryEvent; events: HistoryEvent[] }>();
    for (const ev of events) {
      const g = map.get(ev.note_id);
      if (g) g.events.push(ev);
      else map.set(ev.note_id, { note: ev, events: [ev] });
    }
    return [...map.values()].sort((a, b) => {
      const aBad = a.events.filter((e) => e.rating === 0).length;
      const bBad = b.events.filter((e) => e.rating === 0).length;
      return bBad - aBad || b.events.length - a.events.length;
    });
  }, [events]);

  return (
    <div className="tutor-word-list">
      {groups.map((g) => {
        const isOpen = open === g.note.note_id;
        const forgot = g.events.filter((e) => e.rating === 0).length;
        const wrong = [...new Set(g.events.filter((e) => e.user_answer && !answersMatch(e.user_answer, g.note.hanzi)).map((e) => e.user_answer!.trim()))];
        return (
          <div
            key={g.note.note_id}
            className="tutor-word-row clickable"
            onClick={() => setOpen(isOpen ? null : g.note.note_id)}
            role="button"
            aria-expanded={isOpen}
          >
            <div className="tutor-word-main">
              <span className="tutor-word-hanzi">{g.note.hanzi}</span>
              <div className="tutor-word-meta">
                <span className="tutor-word-pinyin">{g.note.pinyin}</span>
                <span className="tutor-word-english">{g.note.english}</span>
              </div>
              <div className="tutor-word-right">
                <span className={`tutor-pill ${forgot ? 'tutor-pill-again' : 'tutor-pill-good'}`}>
                  {forgot ? `forgot ${forgot}/${g.events.length}` : `${g.events.length}/${g.events.length} right`}
                </span>
              </div>
            </div>
            {wrong.length > 0 && (
              <div className="tutor-word-details">
                {wrong.slice(0, 5).map((a) => (
                  <span key={a} className="tutor-chip tutor-chip-wrong">{a}</span>
                ))}
              </div>
            )}
            {isOpen && (
              <div className="tutor-attempts" onClick={(e) => e.stopPropagation()}>
                <div className="tutor-word-deck">{g.note.deck_name}</div>
                {g.events.map((ev) => (
                  <div key={ev.event_id} className="tutor-attempt">
                    <span className="tutor-attempt-time">{formatDateTime(ev.reviewed_at)}</span>
                    <CardTypeChip cardType={ev.card_type} />
                    <RatingDot rating={ev.rating} withLabel />
                    {ev.user_answer && <AnswerDiff userAnswer={ev.user_answer} correctAnswer={ev.hanzi} />}
                    <span className="tutor-attempt-right">
                      <span className="tutor-attempt-secs">{formatSeconds(ev.time_spent_ms)}</span>
                      {ev.recording_url && <RecordingButton url={ev.recording_url} compact />}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
