import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { getOnboarding, OnboardingState } from '../../api/onboarding';
import { db } from '../../db/database';
import { useNetwork } from '../../contexts/NetworkContext';

const CACHE_KEY = 'onboardingState';
const DISMISSED_KEY = 'onboardingDismissed';

function readCache(): OnboardingState | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as OnboardingState) : undefined;
  } catch {
    return undefined;
  }
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export interface OnboardingView {
  state: OnboardingState | undefined;
  /** Render the first-open screen instead of the normal home. */
  showFirstOpen: boolean;
  /** Still deciding (first load with nothing cached) — show nothing yet. */
  isDeciding: boolean;
  dismiss: () => void;
}

/**
 * Decides whether this is a brand-new invitee's first open: they came in
 * through a tutor's invite and have not reviewed a single card yet (neither
 * on the server nor on this device). The server answer is cached so the
 * screen renders before the first sync and offline.
 */
export function useOnboarding(): OnboardingView {
  const { isOnline } = useNetwork();
  const [dismissed, setDismissed] = useState(readDismissed);

  const query = useQuery({
    queryKey: ['onboarding'],
    queryFn: getOnboarding,
    enabled: isOnline,
    initialData: readCache,
    initialDataUpdatedAt: 0, // cached copy renders now, refetches in the background
    staleTime: 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (!query.data) return;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(query.data));
    } catch { /* storage unavailable */ }
  }, [query.data]);

  const localReviews = useLiveQuery(() => db.reviewEvents.count(), []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* ignore */ }
  }, []);

  const state = query.data;
  const isDeciding =
    state === undefined && isOnline && query.isFetching && !query.isError && (localReviews ?? 0) === 0;

  const showFirstOpen =
    !dismissed &&
    !!state &&
    state.invited &&
    state.inviter_role === 'tutor' &&
    !state.has_reviewed &&
    localReviews !== undefined &&
    localReviews === 0;

  return { state, showFirstOpen, isDeciding, dismiss };
}
