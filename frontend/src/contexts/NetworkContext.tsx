import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { syncService, SyncProgress } from '../services/sync';
import { usePendingReviewsCount, initializeOfflineData } from '../hooks/useOfflineData';
import { useAuth } from './AuthContext';

interface NetworkContextType {
  isOnline: boolean;
  isSyncing: boolean;
  syncProgress: SyncProgress | null;
  pendingReviewsCount: number;
  lastSyncTime: Date | null;
  triggerSync: () => Promise<void>;
  isInitialized: boolean;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const pendingReviewsCount = usePendingReviewsCount();

  // Handle online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Auto-sync when coming back online
      triggerSync();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Listen to sync service events
  useEffect(() => {
    const unsubscribeSyncing = syncService.addSyncListener((syncing) => {
      setIsSyncing(syncing);
      if (!syncing) {
        setLastSyncTime(new Date());
        // Clear progress shortly after sync completes
        setTimeout(() => setSyncProgress(null), 1500);
      }
    });

    const unsubscribeProgress = syncService.addProgressListener((progress) => {
      setSyncProgress(progress);
    });

    return () => {
      unsubscribeSyncing();
      unsubscribeProgress();
    };
  }, []);

  // Initialize offline data once auth is complete
  // Wait for auth to finish loading to ensure session token is set before making API calls
  useEffect(() => {
    // Don't initialize until auth has completed loading
    if (authLoading) {
      return;
    }

    // Only sync if user is authenticated
    if (!isAuthenticated) {
      setIsInitialized(true); // Mark as initialized even if not authenticated
      return;
    }

    initializeOfflineData()
      .then(() => {
        setIsInitialized(true);
        setLastSyncTime(new Date());
      })
      .catch((error) => {
        console.error('Failed to initialize offline data:', error);
        setIsInitialized(true); // Still mark as initialized so app can work
      });
  }, [authLoading, isAuthenticated]);

  const triggerSync = useCallback(async () => {
    if (!navigator.onLine || isSyncing) return;

    try {
      await syncService.syncInBackground();
    } catch (error) {
      console.error('Sync failed:', error);
    }
  }, [isSyncing]);

  return (
    <NetworkContext.Provider
      value={{
        isOnline,
        isSyncing,
        syncProgress,
        pendingReviewsCount,
        lastSyncTime,
        triggerSync,
        isInitialized,
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (context === undefined) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
}
