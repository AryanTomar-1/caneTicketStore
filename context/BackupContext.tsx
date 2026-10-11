// ─── context/BackupContext.tsx ────────────────────────────────────────────────
// React Context for backup state — wraps all backup operations for the UI.

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import {
  BackupSettings, BackupSyncState, SyncResult,
  DEFAULT_BACKUP_SETTINGS,
} from '../backup/BackupTypes';
import { getBackupSettings, saveBackupSettings, addToSyncQueue } from '../backup/BackupStorage';
import { trySyncNow, startNetworkListener, stopNetworkListener, setOnSyncStateChange, isOnline } from '../backup/SyncManager';
import { performFullBackup, skipBackupSetup, enableBackup, disconnectGoogleAccount, checkForExistingBackup } from '../backup/BackupService';

// ─── Context Type ─────────────────────────────────────────────────────────────

interface BackupContextType {
  settings: BackupSettings;
  syncState: BackupSyncState;
  isLoading: boolean;
  /** Reload settings from storage */
  refreshSettings: () => Promise<void>;
  /** Enqueue a ticket ID for backup after it was saved locally */
  enqueueSave: (ticketId: string, seasonId: string) => Promise<void>;
  /** Enqueue a ticket ID for deletion backup */
  enqueueDelete: (ticketId: string, seasonId: string) => Promise<void>;
  /** Manually trigger sync now */
  syncNow: () => Promise<SyncResult | null>;
  /** Skip backup setup */
  skipSetup: () => Promise<void>;
  /** Complete first-time setup after OAuth */
  completeSetup: (params: {
    googleEmail: string;
    googleAccountId?: string;
    driveFileId: string;
    driveMetadataFileId: string;
    driveFolderId: string;
    driveDataFolderId: string;
  }) => Promise<void>;
  /** Disconnect Google account and disable backup */
  disconnect: () => Promise<void>;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const defaultSyncState: BackupSyncState = {
  status: 'disabled',
  pendingCount: 0,
  failedCount: 0,
  syncedCount: 0,
};

const BackupContext = createContext<BackupContextType>({
  settings: DEFAULT_BACKUP_SETTINGS,
  syncState: defaultSyncState,
  isLoading: false,
  refreshSettings: async () => {},
  enqueueSave: async () => {},
  enqueueDelete: async () => {},
  syncNow: async () => null,
  skipSetup: async () => {},
  completeSetup: async () => {},
  disconnect: async () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function BackupProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<BackupSettings>(DEFAULT_BACKUP_SETTINGS);
  const [syncState, setSyncState] = useState<BackupSyncState>(defaultSyncState);
  const [isLoading, setIsLoading] = useState(false);

  // Load settings on mount
  const refreshSettings = useCallback(async () => {
    const s = await getBackupSettings();
    setSettings(s);
    if (!s.enabled) {
      setSyncState(prev => ({ ...prev, status: 'disabled' }));
    }
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  // Set up network listener and sync state callback
  useEffect(() => {
    setOnSyncStateChange((partial) => {
      setSyncState(prev => {
        const next = { ...prev, ...partial };
        if (partial.success === true) next.status = 'idle';
        else if (partial.error === 'AUTH_REQUIRED') next.status = 'auth_required';
        else if (partial.success === false && partial.failedCount) next.status = 'failed';
        else if (partial.pendingCount) next.status = 'pending';
        return next;
      });
    });

    startNetworkListener();

    return () => {
      stopNetworkListener();
    };
  }, []);

  // After settings load, try sync if backup is enabled
  useEffect(() => {
    if (settings.enabled) {
      setSyncState(prev => ({ ...prev, status: 'idle' }));
      trySyncNow(false);
    }
  }, [settings.enabled]);

  const enqueueSave = useCallback(async (ticketId: string, seasonId: string) => {
    if (!settings.enabled) return;
    await addToSyncQueue({ id: ticketId, seasonId, operation: 'upsert' });
    setSyncState(prev => ({ ...prev, pendingCount: prev.pendingCount + 1, status: 'pending' }));
    // Try to sync immediately if online
    const online = await isOnline();
    if (online) {
      trySyncNow(false);
    }
  }, [settings.enabled]);

  const enqueueDelete = useCallback(async (ticketId: string, seasonId: string) => {
    if (!settings.enabled) return;
    await addToSyncQueue({ id: ticketId, seasonId, operation: 'delete' });
    setSyncState(prev => ({ ...prev, pendingCount: prev.pendingCount + 1, status: 'pending' }));
    const online = await isOnline();
    if (online) {
      trySyncNow(false);
    }
  }, [settings.enabled]);

  const syncNow = useCallback(async (): Promise<SyncResult | null> => {
    setIsLoading(true);
    setSyncState(prev => ({ ...prev, status: 'syncing' }));
    try {
      const result = await trySyncNow(true);
      if (result?.success) {
        setSyncState({
          status: 'idle',
          pendingCount: 0,
          failedCount: 0,
          syncedCount: result.syncedCount,
          lastSyncAt: result.lastSyncAt,
        });
        await refreshSettings();
      }
      return result;
    } finally {
      setIsLoading(false);
    }
  }, [refreshSettings]);

  const skipSetup = useCallback(async () => {
    await skipBackupSetup();
    await refreshSettings();
  }, [refreshSettings]);

  const completeSetup = useCallback(async (params: {
    googleEmail: string;
    googleAccountId?: string;
    driveFileId: string;
    driveMetadataFileId: string;
    driveFolderId: string;
    driveDataFolderId: string;
  }) => {
    await enableBackup(params);
    await refreshSettings();
    setSyncState(prev => ({ ...prev, status: 'idle' }));
    // Trigger initial backup
    trySyncNow(true);
  }, [refreshSettings]);

  const disconnect = useCallback(async () => {
    await disconnectGoogleAccount();
    await refreshSettings();
    setSyncState(defaultSyncState);
  }, [refreshSettings]);

  return (
    <BackupContext.Provider value={{
      settings,
      syncState,
      isLoading,
      refreshSettings,
      enqueueSave,
      enqueueDelete,
      syncNow,
      skipSetup,
      completeSetup,
      disconnect,
    }}>
      {children}
    </BackupContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useBackup = () => useContext(BackupContext);
