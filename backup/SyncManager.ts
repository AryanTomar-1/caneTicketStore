// ─── SyncManager.ts ───────────────────────────────────────────────────────────
// Network-aware sync manager with exponential backoff retry logic.
// Detects connectivity changes and automatically triggers pending syncs.

import NetInfo from '@react-native-community/netinfo';
import { AppState, AppStateStatus } from 'react-native';
import {
  getSyncQueue, saveSyncQueue, updateSyncQueueItem, removeFromSyncQueue,
  getBackupSettings,
} from './BackupStorage';
import { performFullBackup } from './BackupService';
import {
  SyncQueueItem, SyncResult,
  MAX_RETRY_COUNT, RETRY_DELAYS_MS,
} from './BackupTypes';

// ─── Internal state ───────────────────────────────────────────────────────────

let _isSyncing = false;
let _netInfoUnsubscribe: (() => void) | null = null;
let _appStateSubscription: { remove: () => void } | null = null;
let _retryTimeout: ReturnType<typeof setTimeout> | null = null;
let _onStateChange: ((result: Partial<SyncResult>) => void) | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a callback to receive sync state updates.
 * Used by BackupContext to update UI.
 */
export const setOnSyncStateChange = (cb: (result: Partial<SyncResult>) => void): void => {
  _onStateChange = cb;
};

/**
 * Start listening for network changes and app state changes.
 * Call once on app start (inside BackupContext).
 */
export const startNetworkListener = (): void => {
  console.log('[BACKUP] Network listener started');

  // Listen for network connectivity changes
  _netInfoUnsubscribe = NetInfo.addEventListener(state => {
    if (state.isConnected && state.isInternetReachable !== false) {
      console.log('[BACKUP] Network available — checking pending sync queue...');
      trySyncNow(false);
    }
  });

  // Listen for app returning to foreground
  _appStateSubscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
    if (nextState === 'active') {
      console.log('[BACKUP] App came to foreground — checking pending sync queue...');
      trySyncNow(false);
    }
  });
};

/**
 * Stop all listeners (call on cleanup).
 */
export const stopNetworkListener = (): void => {
  _netInfoUnsubscribe?.();
  _netInfoUnsubscribe = null;
  _appStateSubscription?.remove();
  _appStateSubscription = null;
  if (_retryTimeout) {
    clearTimeout(_retryTimeout);
    _retryTimeout = null;
  }
  console.log('[BACKUP] Network listener stopped');
};

/**
 * Check if device is currently online.
 */
export const isOnline = async (): Promise<boolean> => {
  try {
    const state = await NetInfo.fetch();
    return !!(state.isConnected && state.isInternetReachable !== false);
  } catch { return false; }
};

/**
 * Attempt to sync now. If already syncing, skip.
 * @param force — if true, sync even if queue is empty (manual "Sync Now")
 */
export const trySyncNow = async (force = false): Promise<SyncResult | null> => {
  if (_isSyncing) {
    console.log('[BACKUP] Sync already in progress, skipping');
    return null;
  }

  const settings = await getBackupSettings();
  if (!settings.enabled) {
    return null;
  }

  const queue = await getSyncQueue();
  const pendingItems = queue.filter(q => q.status === 'pending' || q.status === 'failed');

  if (!force && pendingItems.length === 0) {
    return null;
  }

  const online = await isOnline();
  if (!online) {
    console.log('[BACKUP] Device offline — sync deferred');
    _onStateChange?.({ pendingCount: pendingItems.length });
    return null;
  }

  _isSyncing = true;
  console.log('[BACKUP] Sync started');
  _onStateChange?.({ pendingCount: pendingItems.length });

  try {
    const result = await performFullBackup();

    if (result.success) {
      console.log('[BACKUP] Sync completed successfully');
      _onStateChange?.(result);
    } else if (result.error === 'AUTH_REQUIRED') {
      console.log('[BACKUP] Auth required for sync');
      _onStateChange?.({ ...result });
    } else {
      console.log('[BACKUP] Sync failed, scheduling retry');
      scheduleRetry(pendingItems);
    }

    return result;
  } catch (err: any) {
    console.warn('[BACKUP] Sync error:', err.message);
    _onStateChange?.({ success: false, failedCount: 1, pendingCount: pendingItems.length });
    scheduleRetry(pendingItems);
    return null;
  } finally {
    _isSyncing = false;
  }
};

/**
 * Schedule a retry with exponential backoff based on max retry count
 * in the pending queue items.
 */
const scheduleRetry = (items: SyncQueueItem[]): void => {
  if (_retryTimeout) {
    clearTimeout(_retryTimeout);
  }

  // Increment retry counts
  const maxRetries = Math.max(...items.map(i => i.retryCount), 0);

  if (maxRetries >= MAX_RETRY_COUNT) {
    console.log('[BACKUP] Max retries reached — marking as failed');
    markAllAsFailed(items);
    return;
  }

  const delayMs = RETRY_DELAYS_MS[Math.min(maxRetries, RETRY_DELAYS_MS.length - 1)];
  console.log(`[BACKUP] Retry scheduled in ${delayMs / 1000}s (attempt ${maxRetries + 2})`);

  _retryTimeout = setTimeout(async () => {
    // Increment retry count for all pending items
    const currentQueue = await getSyncQueue();
    const updated = currentQueue.map(item => {
      if (item.status === 'pending' || item.status === 'failed') {
        return {
          ...item,
          retryCount: item.retryCount + 1,
          lastAttemptAt: new Date().toISOString(),
        };
      }
      return item;
    });
    await saveSyncQueue(updated);
    await trySyncNow(false);
  }, delayMs);
};

/**
 * Mark all items as permanently failed.
 */
const markAllAsFailed = async (items: SyncQueueItem[]): Promise<void> => {
  const currentQueue = await getSyncQueue();
  const updated = currentQueue.map(item => {
    if (items.find(i => i.id === item.id)) {
      return { ...item, status: 'failed' as const };
    }
    return item;
  });
  await saveSyncQueue(updated);
  _onStateChange?.({ success: false, failedCount: items.length, pendingCount: 0 });
};

/**
 * Get count of pending items.
 */
export const getPendingCount = async (): Promise<number> => {
  const queue = await getSyncQueue();
  return queue.filter(q => q.status === 'pending').length;
};

/**
 * Get count of failed items.
 */
export const getFailedCount = async (): Promise<number> => {
  const queue = await getSyncQueue();
  return queue.filter(q => q.status === 'failed').length;
};
