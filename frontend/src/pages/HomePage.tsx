import { useState, useEffect, useMemo } from 'react';
import { LiveCallBanner } from '../components/calls/CallBanner';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDecks } from '../api/client';
import { Loading } from '../components/Loading';
import { StudyStreak } from '../components/StudyStreak';
import { StudyTodayCard } from '../components/home/StudyTodayCard';
import { HomeworkHomeCard, TutorNotesHomeRow } from '../components/home/HomeworkHomeCard';
import { ConnectionRequestsBanner } from '../components/home/ConnectionRequestsBanner';
import { DeckList, HOME_DECK_LIMIT } from '../components/home/DeckList';
import { NextUpLine } from '../components/home/NextUpLine';
import { UpNextHomeLine } from '../components/home/UpNextHomeLine';
import { moveDeckInQueue } from '../services/deckOrder';
import { AddDeckModal } from '../components/home/AddDeckModal';
import { TutorHome } from '../components/home/TutorHome';
import { useHomework } from '../components/home/useHomework';
import { useDeckOverview } from '../components/home/useDeckOverview';
import { totalDue as sumDue } from '../components/home/studyEstimate';
import { FirstOpenScreen } from '../components/onboarding/FirstOpenScreen';
import { useOnboarding } from '../components/onboarding/useOnboarding';
import { QueueCounts, CardQueue } from '../types';
import { useRawQueueCounts, useOfflineDecks } from '../hooks/useOfflineData';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { useNetwork } from '../contexts/NetworkContext';
import { useAuth } from '../contexts/AuthContext';
import { allocateQueueCounts, sumQueueCounts, DeckQueueCounts, EMPTY_QUEUE_COUNTS } from '../db/database';
import { getDueReaders } from '../services/reader-study';
import { readBonus, writeBonus } from '../utils/bonusNewCards';
import { track } from '../services/analytics';
import { useSessionCounts } from '../services/sessionCounts';
import { studyToday } from '../services/studyDay';
import { bumpedAfterSession, deckCountsAfterSession, sessionCountsNewer, totalAfterSession } from '@shared/study';
import './HomePage.css';

const COUNTS_CACHE_KEY = 'lastQueueCounts';

/** The last totals Home worked out, with when (shared/study/homeCounts.ts) — painted on a cold start. */
interface CachedCounts {
  counts: QueueCounts;
  at: number;
  day: string;
}

function readCountsCache(): CachedCounts | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(COUNTS_CACHE_KEY) || 'null');
    if (!parsed) return null;
    // Before Nov 2026 the bare counts were kept (no time): older than anything worked out since.
    if (typeof parsed.at !== 'number') return { counts: parsed as QueueCounts, at: 0, day: '' };
    return parsed as CachedCounts;
  } catch {
    return null;
  }
}

function writeCountsCache(value: CachedCounts) {
  try { localStorage.setItem(COUNTS_CACHE_KEY, JSON.stringify(value)); } catch { /* ignore */ }
}

/**
 * `/`. A tutor account (users.role = 'tutor') gets the teaching home — no
 * streak, due-card button, homework card or learner onboarding; everyone else
 * the study home.
 */
export function HomePage() {
  const { user } = useAuth();
  return user?.role === 'tutor' ? <TutorHome /> : <StudyHome />;
}

function StudyHome() {
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);

  const moveTop = (deckId: string) => {
    moveDeckInQueue(deckId, 'top')
      .then(() => track('deck.reorder', { how: 'home_top' }))
      .catch(err => console.error('[Home] move to top failed', err));
  };

  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: getDecks,
    // Don't show loading/error states - offline data is primary
    staleTime: 30000,
    retry: false,
  });

  // OFFLINE-FIRST: IndexedDB is the source of truth. Passing the API decks
  // lets the hook notice decks missing locally and pull them in.
  const { decks, isLoading: offlineLoading, isSyncing } = useOfflineDecks(decksQuery.data);
  const { hasSyncedOnce } = useSyncStatus();

  // ---- Bonus new cards ("Study 10 more") ----
  const [bonusAll, setBonusAll] = useState(() => readBonus(undefined));
  const bumpBonus = () => {
    const next = readBonus(undefined) + 10;
    writeBonus(undefined, next);
    setBonusAll(next);
  };

  // ---- Queue counts: ONE live query, bonus applied in-memory ----
  const { byDeck: rawByDeck, isLoading: countsLoading, reviewLoad, stamp } = useRawQueueCounts();
  // "Pause new cards on heavy days": recorded once a STUDY day while Home says so (the Lab app's
  // HomeViewModel.trackPaused keys it the same way — a calendar day counted 00:00–04:00 twice).
  useEffect(() => {
    if (!reviewLoad?.paused) return;
    const key = 'new-cards-paused-tracked';
    const today = studyToday();
    try {
      if (localStorage.getItem(key) === today) return;
      localStorage.setItem(key, today);
    } catch { /* storage unavailable: track anyway */ }
    track('study.new_cards_paused', { load: reviewLoad.load, limit: reviewLoad.threshold });
  }, [reviewLoad?.paused, reviewLoad?.load, reviewLoad?.threshold]);
  const dueReaders = useLiveQuery(() => getDueReaders(), []) ?? [];

  const { perDeck: computedPerDeck, liveTotal } = useMemo(() => {
    const perDeck: Map<string, DeckQueueCounts> = allocateQueueCounts(rawByDeck, 0);
    const liveTotal = sumQueueCounts(allocateQueueCounts(rawByDeck, bonusAll).values());
    for (const reader of dueReaders) {
      if (reader.queue === CardQueue.NEW) liveTotal.new++;
      else if (reader.queue === CardQueue.LEARNING || reader.queue === CardQueue.RELEARNING) liveTotal.learning++;
      else liveTotal.review++;
    }
    return { perDeck, liveTotal };
  }, [rawByDeck, bonusAll, dueReaders]);

  // Last-known totals from localStorage until this page load has worked any out.
  const cached = useState(readCountsCache)[0];
  useEffect(() => {
    if (!countsLoading && stamp) writeCountsCache({ counts: liveTotal, at: stamp.at, day: stamp.day });
  }, [countsLoading, liveTotal, stamp]);

  // Back from Study: the session's own numbers while they are newer than Home's (0 after "All
  // done"), never the counts from before the session; the recount replaces them when done
  // (shared/study/homeCounts.ts — docs/STUDY_SESSION.md "Back on Home").
  const session = useSessionCounts();
  const today = studyToday();
  const computedStamp = countsLoading ? (cached ? { at: cached.at, day: cached.day } : null) : stamp;
  const fromSession = !!session && sessionCountsNewer(session, computedStamp, today);
  const baseTotal: QueueCounts | null = countsLoading
    ? (cached ? { ...cached.counts, secondaryNew: cached.counts.secondaryNew ?? 0 } : null)
    : liveTotal;
  const perDeck = useMemo(() => {
    if (!fromSession || !session) return computedPerDeck;
    const out = new Map<string, DeckQueueCounts>();
    const ids = new Set([...computedPerDeck.keys(), ...Object.keys(session.byDeck)]);
    for (const id of ids) {
      const row = computedPerDeck.get(id);
      out.set(id, { hasMoreNew: row?.hasMoreNew ?? false, bumped: row?.bumped, ...deckCountsAfterSession(row ?? null, session, id) });
    }
    return out;
  }, [fromSession, session, computedPerDeck]);
  const totalCounts: QueueCounts | null = fromSession && session
    ? totalAfterSession(baseTotal, Object.fromEntries(computedPerDeck), session)
    : baseTotal;
  const totalDue = totalCounts ? sumDue(totalCounts) : 0;
  const showStudyLoading = !totalCounts;
  const bumpedNow = fromSession && session
    ? bumpedAfterSession(liveTotal.bumped ?? 0, session)
    : (countsLoading ? 0 : liveTotal.bumped ?? 0);

  const overview = useDeckOverview();
  const homework = useHomework(decks);
  const onboarding = useOnboarding();

  const handleStudyAll = () => navigate('/study?autostart=true');

  // OFFLINE-FIRST: Only show loading on the very first app launch, before
  // IndexedDB has answered; after that, cached data renders instantly.
  if (offlineLoading || onboarding.isDeciding) {
    return <Loading />;
  }

  if (onboarding.showFirstOpen && onboarding.state) {
    return (
      <div className="page">
        <div className="container">
          <LiveCallBanner variant="card" />
          <FirstOpenScreen
            state={onboarding.state}
            userName={user?.name}
            totalDue={showStudyLoading ? 0 : totalDue}
            hasSyncedOnce={hasSyncedOnce}
            isOnline={isOnline}
            onDismiss={onboarding.dismiss}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <LiveCallBanner variant="card" />
        <StudyStreak />

        <StudyTodayCard
          bumped={bumpedNow}
          counts={totalCounts ?? EMPTY_QUEUE_COUNTS}
          totalDue={totalDue}
          isLoading={showStudyLoading}
          hasSyncedOnce={hasSyncedOnce}
          isSyncing={isSyncing}
          isOnline={isOnline}
          hasDecks={decks.length > 0}
          hasMoreNew={liveTotal.hasMoreNew}
          onStudy={handleStudyAll}
          onMoreNew={bumpBonus}
          reviewLoad={countsLoading ? null : reviewLoad}
        />

        {/* Connection requests used to wait on the Tutor tab (gone, Nov 2026). */}
        <ConnectionRequestsBanner />

        <TutorNotesHomeRow />

        <HomeworkHomeCard view={homework} />

        <section className="card" aria-label="Your decks">
          <div className="home-decks-head">
            <h2>Your decks</h2>
            <div className="flex" style={{ alignItems: 'center', gap: '0.5rem' }}>
              {isSyncing && (
                <span className="home-sync-pill">
                  <span className="spinner home-spinner" />
                  Syncing
                </span>
              )}
              {decks.length > 0 && (
                <Link to="/decks" className="home-all-decks">
                  {decks.length > HOME_DECK_LIMIT ? `All ${decks.length} decks →` : 'All decks →'}
                </Link>
              )}
            </div>
          </div>

          {decks.length === 0 ? (
            <div className="home-empty">
              <div className="home-empty-icon" aria-hidden="true">📖</div>
              <h3>No decks yet</h3>
              <p>
                {hasSyncedOnce === false && isOnline
                  ? 'Your words are on their way.'
                  : 'Add a deck to start learning, or wait for your tutor to send one.'}
              </p>
            </div>
          ) : (
            <>
              <NextUpLine decks={decks} raw={rawByDeck} />
              <UpNextHomeLine />
              <DeckList
                decks={decks}
                counts={perDeck}
                overview={overview}
                onMoveTop={moveTop}
              />
            </>
          )}

          <button type="button" className="home-add-deck" onClick={() => setShowModal(true)}>
            + Add a deck
          </button>
        </section>

        {showModal && <AddDeckModal onClose={() => setShowModal(false)} />}
      </div>
    </div>
  );
}
