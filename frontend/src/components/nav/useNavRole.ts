import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { getMyRelationships } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useNetwork } from '../../contexts/NetworkContext';
import { db, applyNewCardBonus, sumQueueCounts, DeckQueueCounts } from '../../db/database';
import { useRawQueueCounts } from '../../hooks/useOfflineData';
import { getDueReaders } from '../../services/reader-study';
import { readBonus } from '../../utils/bonusNewCards';
import { MyRelationships } from '../../types';
import { deriveNavRole, NavRole } from './navRole';

const CACHE_KEY = 'navRelationshipsCache';

function readCache(): MyRelationships | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as MyRelationships) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(value: MyRelationships) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // storage full / private mode — the next online boot refetches anyway
  }
}

/**
 * Everything due today across all decks (same arithmetic as the home page's
 * "Study All" badge: per-deck new-card budgets with the "+10 more" bonus, plus
 * due graded readers). Purely local — reads IndexedDB.
 */
export function useDueCount(): { dueCount: number; isLoading: boolean } {
  const { byDeck, isLoading } = useRawQueueCounts();
  const dueReaders = useLiveQuery(() => getDueReaders(), []);
  return useMemo(() => {
    const perDeck: DeckQueueCounts[] = [];
    for (const [id, raw] of byDeck) perDeck.push(applyNewCardBonus(raw, readBonus(id)));
    const total = sumQueueCounts(perDeck);
    const readers = (dueReaders ?? []).length;
    const dueCount = total.new + (total.secondaryNew ?? 0) + total.learning + total.review + readers;
    return { dueCount, isLoading: isLoading || dueReaders === undefined };
  }, [byDeck, dueReaders, isLoading]);
}

/**
 * Role-aware navigation inputs. Relationships come from the API (cached in
 * localStorage so an offline boot still shows the right tabs); deck and due
 * counts come from IndexedDB.
 */
export function useNavRole(): NavRole {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: ['nav-relationships'],
    queryFn: getMyRelationships,
    enabled: isAuthenticated,
    staleTime: 30_000,
    retry: false,
    placeholderData: readCache,
  });

  useEffect(() => {
    if (query.data && !query.isPlaceholderData) writeCache(query.data);
  }, [query.data, query.isPlaceholderData]);

  const deckCount = useLiveQuery(() => db.decks.count(), []);
  const { dueCount, isLoading: dueLoading } = useDueCount();
  // Until the first sync has run, an empty IndexedDB says nothing about the account.
  const { isInitialized } = useNetwork();

  return useMemo(
    () => deriveNavRole({
      relationships: query.data,
      deckCount: deckCount ?? 0,
      dueCount,
      countsLoading: deckCount === undefined || dueLoading || !isInitialized,
    }),
    [query.data, deckCount, dueCount, dueLoading, isInitialized],
  );
}
