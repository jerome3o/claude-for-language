import { useEffect, useState } from 'react';
import { syncService } from '../services/sync';
import { getSyncMeta } from '../db/database';

export interface SyncStatus {
  /** A sync is running right now. */
  isSyncing: boolean;
  /**
   * At least one full sync has ever completed on this device, so an empty
   * local database really is empty. `undefined` while still being read.
   */
  hasSyncedOnce: boolean | undefined;
}

/**
 * Whether the local data can be trusted yet. The home uses it to never say
 * "✓ Flashcards done" on a device that simply hasn't downloaded its words.
 */
export function useSyncStatus(): SyncStatus {
  const [isSyncing, setIsSyncing] = useState(syncService.isSyncingNow);
  const [hasSyncedOnce, setHasSyncedOnce] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      getSyncMeta()
        .then(meta => { if (!cancelled) setHasSyncedOnce(!!meta?.last_full_sync); })
        .catch(() => { if (!cancelled) setHasSyncedOnce(false); });
    };
    check();
    const unsubscribe = syncService.addSyncListener(syncing => {
      setIsSyncing(syncing);
      if (!syncing) check();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { isSyncing, hasSyncedOnce };
}
