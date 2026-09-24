import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDecks } from '../api/client';
import { Loading } from '../components/Loading';
import { StudyStreak } from '../components/StudyStreak';
import { StudyTodayCard } from '../components/home/StudyTodayCard';
import { HomeworkCard } from '../components/home/HomeworkCard';
import { DeckList, HOME_DECK_LIMIT } from '../components/home/DeckList';
import { NextUpLine } from '../components/home/NextUpLine';
import { moveDeckInQueue } from '../services/deckOrder';
import { AddDeckModal } from '../components/home/AddDeckModal';
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
import { allocateQueueCounts, sumQueueCounts, DeckQueueCounts } from '../db/database';
import { getDueReaders } from '../services/reader-study';
import { readBonus, writeBonus } from '../utils/bonusNewCards';
import './HomePage.css';

const COUNTS_CACHE_KEY = 'lastQueueCounts';

export function HomePage() {
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);

  const moveTop = (deckId: string) => {
    moveDeckInQueue(deckId, 'top').catch(err => console.error('[Home] move to top failed', err));
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
  const { byDeck: rawByDeck, isLoading: countsLoading } = useRawQueueCounts();
  const dueReaders = useLiveQuery(() => getDueReaders(), []) ?? [];

  const { perDeck, liveTotal } = useMemo(() => {
    const perDeck: Map<string, DeckQueueCounts> = allocateQueueCounts(rawByDeck, 0);
    const liveTotal = sumQueueCounts(allocateQueueCounts(rawByDeck, bonusAll).values());
    for (const reader of dueReaders) {
      if (reader.queue === CardQueue.NEW) liveTotal.new++;
      else if (reader.queue === CardQueue.LEARNING || reader.queue === CardQueue.RELEARNING) liveTotal.learning++;
      else liveTotal.review++;
    }
    return { perDeck, liveTotal };
  }, [rawByDeck, bonusAll, dueReaders]);

  // Last-known totals from localStorage while the live query loads.
  const cachedCounts = useState<QueueCounts | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(COUNTS_CACHE_KEY) || 'null');
    } catch {
      return null;
    }
  })[0];
  useEffect(() => {
    if (!countsLoading) {
      try { localStorage.setItem(COUNTS_CACHE_KEY, JSON.stringify(liveTotal)); } catch { /* ignore */ }
    }
  }, [countsLoading, liveTotal]);

  const totalCounts: QueueCounts = countsLoading && cachedCounts
    ? { ...cachedCounts, secondaryNew: cachedCounts.secondaryNew ?? 0 }
    : liveTotal;
  const totalDue = sumDue(totalCounts);
  const showStudyLoading = countsLoading && !cachedCounts;

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
        <StudyStreak />

        <StudyTodayCard
          counts={totalCounts}
          totalDue={totalDue}
          isLoading={showStudyLoading}
          hasSyncedOnce={hasSyncedOnce}
          isSyncing={isSyncing}
          isOnline={isOnline}
          hasDecks={decks.length > 0}
          hasMoreNew={liveTotal.hasMoreNew}
          onStudy={handleStudyAll}
          onMoreNew={bumpBonus}
        />

        <HomeworkCard view={homework} />

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
