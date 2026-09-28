/**
 * The live calls in any of my relationships (`GET /api/calls?live=1`), shared
 * by every banner: polled every 20 s while the page is visible and online,
 * and refreshed at once when a push arrives (the service worker posts it to
 * every open tab). Offline it reports nothing, so a stale call is never shown.
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LIVE_CALL_POLL_MS } from '@shared/calls';
import { listCalls } from '../api/calls';
import { useAuth } from '../contexts/AuthContext';
import { useNetwork } from '../contexts/NetworkContext';
import type { CallListItem } from '../types/calls';

export const LIVE_CALLS_KEY = ['calls', 'live-all'] as const;

export function useLiveCalls(): CallListItem[] {
  const { isAuthenticated } = useAuth();
  const { isOnline } = useNetwork();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: LIVE_CALLS_KEY,
    queryFn: async () => (await listCalls({ live: true })).calls,
    enabled: isAuthenticated && isOnline,
    refetchInterval: LIVE_CALL_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'push') void queryClient.invalidateQueries({ queryKey: LIVE_CALLS_KEY });
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [queryClient]);

  return isOnline && isAuthenticated ? query.data ?? [] : [];
}
