import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db,
  getRawQueueCounts,
  DeckQueueRaw,
  ensureDailyStatsInitialized,
} from '../db/database';
import { syncService } from '../services/sync';

// Hook to get all decks from IndexedDB with background sync
// Pass apiDecks to detect mismatches and auto-fix via full sync
export function useOfflineDecks(apiDecks?: { id: string }[]) {
  // Use Dexie live query for reactive updates
  const decks = useLiveQuery(async () => {
    const result = await db.decks.toArray();
    return result;
  }, []);

  // Detect mismatch: API has decks that aren't in IndexedDB
  const localDeckIds = new Set((decks || []).map(d => d.id));
  const missingDecks = apiDecks?.filter(d => !localDeckIds.has(d.id)) || [];
  const hasMismatch = missingDecks.length > 0;

  // Auto-trigger sync when mismatch detected, with retry backoff
  const [isAutoSyncing, setIsAutoSyncing] = React.useState(false);
  const retryCountRef = React.useRef(0);
  const lastMismatchKeyRef = React.useRef('');

  // Reset retry count when the set of missing decks changes
  const mismatchKey = missingDecks.map(d => d.id).sort().join(',');
  if (mismatchKey !== lastMismatchKeyRef.current) {
    lastMismatchKeyRef.current = mismatchKey;
    retryCountRef.current = 0;
  }

  React.useEffect(() => {
    const MAX_RETRIES = 3;
    if (hasMismatch && navigator.onLine && !isAutoSyncing && !syncService.isSyncingNow && retryCountRef.current < MAX_RETRIES) {
      const attempt = retryCountRef.current + 1;
      // Exponential backoff: 0ms, 2s, 4s
      const delay = retryCountRef.current > 0 ? retryCountRef.current * 2000 : 0;

      console.log(`[useOfflineDecks] Mismatch detected! Missing decks: [${missingDecks.map(d => d.id).join(', ')}] (attempt ${attempt}/${MAX_RETRIES})`);

      const missingIds = missingDecks.map(d => d.id);
      const timeoutId = setTimeout(async () => {
        setIsAutoSyncing(true);
        retryCountRef.current = attempt;
        try {
          // First attempt: directly fetch the specific missing decks by ID.
          // Incremental sync won't help here because these decks' updated_at
          // predates the last incremental sync timestamp.
          // Subsequent attempts: full sync as a guaranteed fallback.
          if (attempt === 1) {
            console.log('[useOfflineDecks] Fetching missing decks by ID...');
            await syncService.syncSpecificDecks(missingIds);
          } else {
            console.log('[useOfflineDecks] Trying full sync (fallback)...');
            await syncService.fullSync();
          }
          console.log('[useOfflineDecks] Auto sync complete');
        } catch (err) {
          console.error(`[useOfflineDecks] Auto sync failed (attempt ${attempt}):`, err);
        } finally {
          setIsAutoSyncing(false);
        }
      }, delay);

      return () => clearTimeout(timeoutId);
    } else if (hasMismatch && retryCountRef.current >= 3) {
      console.log('[useOfflineDecks] Max retries reached, use manual sync to fix');
    }
  }, [hasMismatch, mismatchKey, isAutoSyncing]);

  // Trigger background sync when online
  const triggerSync = async () => {
    if (navigator.onLine) {
      const needsSync = await syncService.needsFullSync();
      if (needsSync) {
        await syncService.fullSync();
      } else {
        await syncService.syncInBackground();
      }
    }
  };

  // Force a full sync (clear and re-download)
  const forceFullSync = async () => {
    if (navigator.onLine) {
      await syncService.forceFreshSync();
    }
  };

  return {
    decks: decks || [],
    isLoading: decks === undefined,
    isSyncing: isAutoSyncing || syncService.isSyncingNow,
    triggerSync,
    forceFullSync,
  };
}

// Seed today's dailyStats once per app load so count queries never hit the slow path.
let dailyStatsInitDate: string | null = null;
function ensureDailyStatsOnce() {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyStatsInitDate === today) return;
  dailyStatsInitDate = today;
  ensureDailyStatsInitialized().catch(err =>
    console.error('[useOfflineData] ensureDailyStatsInitialized failed', err)
  );
}

/**
 * Single live query producing raw per-deck queue counts. Callers apply
 * daily-limit/bonus themselves via applyNewCardBonus(), so one DB scan can
 * serve every view on the page.
 */
export function useRawQueueCounts() {
  ensureDailyStatsOnce();
  const raw = useLiveQuery(() => getRawQueueCounts(), []);
  return {
    byDeck: raw ?? new Map<string, DeckQueueRaw>(),
    isLoading: raw === undefined,
  };
}

export function usePendingReviewsCount() {
  const count = useLiveQuery(
    () => db.reviewEvents.where('_synced').equals(0).count(),
    []
  );
  return count || 0;
}


// Initialize offline data - call this on app start
export async function initializeOfflineData(): Promise<void> {
  ensureDailyStatsOnce();

  if (!navigator.onLine) {
    console.log('Offline - using cached data');
    return;
  }

  const needsSync = await syncService.needsFullSync();
  if (needsSync) {
    console.log('Performing initial full sync...');
    await syncService.fullSync();
    ensureDailyStatsInitialized().catch(console.error);
  } else {
    syncService.syncInBackground();
  }
}
