import { useCallback, useState } from 'react';
import { syncService } from '../../services/sync';
import { isDebugConsoleEnabled, setDebugConsoleEnabled } from '../../utils/debugConsole';
import { copyDebugDump } from '../../utils/debugDump';
import { checkForUpdateNow, BUILD_TIME } from '../../utils/appUpdates';

/**
 * The maintenance actions that used to live in the avatar dropdown. They are
 * now under "Advanced" on the More page and in Settings — one implementation
 * for both.
 */
export function useMaintenanceActions() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDumping, setIsDumping] = useState(false);

  // The one sync button: two-way event reconciliation, server + local card
  // state recompute, recordings upload, and a full deck/note refresh.
  const fullSync = useCallback(async () => {
    if (!confirm(
      'Run a full sync?\n\n' +
      'This reconciles your complete review history with the server, refreshes all decks ' +
      'and notes, and recomputes every card. It can take a minute or two — keep the app open.'
    )) {
      return;
    }
    setIsSyncing(true);
    try {
      const result = await syncService.deepSync();
      console.log('Full sync result:', result);
      const errorNote = result.errors.length > 0 ? `\nErrors: ${result.errors.join('; ')}` : '';
      alert(
        `Full sync complete.\n` +
        `Reviews: ${result.events_local} local, ${result.events_uploaded} new on server, ` +
        `${result.events_downloaded} downloaded` +
        (result.events_orphaned > 0 ? ` (${result.events_orphaned} orphans of deleted cards stay local)` : '') + `\n` +
        `Recordings uploaded: ${result.recordings_uploaded}\n` +
        `Cards recomputed: ${result.cards_recomputed}${errorNote}`
      );
      window.location.reload();
    } catch (err) {
      console.error('Full sync failed:', err);
      alert(`Full sync failed: ${err instanceof Error ? err.message : err}`);
      setIsSyncing(false);
    }
  }, []);

  const updateApp = useCallback(async () => {
    setIsUpdating(true);
    try {
      const outcome = await checkForUpdateNow();
      if (outcome === 'updating') {
        alert('New version found — updating now...');
        // The page reloads automatically when the new service worker takes
        // over (see utils/appUpdates.ts); this is just a fallback.
        setTimeout(() => window.location.reload(), 4000);
        return;
      }
      if (outcome === 'latest') {
        alert(`You're on the latest version.\nBuilt: ${BUILD_TIME}`);
        setIsUpdating(false);
        return;
      }
      // No service worker — fall back to a hard cache clear
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      }
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
          await caches.delete(cacheName);
        }
      }
      window.location.reload();
    } catch (err) {
      console.error('Failed to update app:', err);
      alert(`Update check failed: ${err instanceof Error ? err.message : err}`);
      setIsUpdating(false);
    }
  }, []);

  const toggleDebugConsole = useCallback(() => {
    setDebugConsoleEnabled(!isDebugConsoleEnabled());
    window.location.reload();
  }, []);

  const copyDump = useCallback(async () => {
    setIsDumping(true);
    try {
      const message = await copyDebugDump();
      alert(message);
    } catch (err) {
      console.error('Failed to build debug dump:', err);
      alert(`Failed to build debug dump: ${err instanceof Error ? err.message : err}`);
    } finally {
      setIsDumping(false);
    }
  }, []);

  return {
    fullSync,
    isSyncing,
    updateApp,
    isUpdating,
    toggleDebugConsole,
    debugConsoleOn: isDebugConsoleEnabled(),
    copyDump,
    isDumping,
  };
}
