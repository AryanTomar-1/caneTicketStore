// ─── BackupStorage.ts ─────────────────────────────────────────────────────────
// AsyncStorage and SecureStore helpers for all backup-related persistence.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  BackupSettings,
  DEFAULT_BACKUP_SETTINGS,
  SyncQueueItem,
  GoogleTokens,
} from './BackupTypes';

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const BACKUP_SETTINGS_KEY = '@backup_settings';
const SYNC_QUEUE_KEY = '@backup_sync_queue';
const DELETED_IDS_KEY = '@backup_deleted_ids';
const SECURE_TOKENS_KEY = 'backup_google_tokens';

// ─── Backup Settings ──────────────────────────────────────────────────────────

export const getBackupSettings = async (): Promise<BackupSettings> => {
  try {
    const raw = await AsyncStorage.getItem(BACKUP_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_BACKUP_SETTINGS };
    return { ...DEFAULT_BACKUP_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_BACKUP_SETTINGS };
  }
};

export const saveBackupSettings = async (settings: Partial<BackupSettings>): Promise<void> => {
  try {
    const current = await getBackupSettings();
    const updated = { ...current, ...settings };
    await AsyncStorage.setItem(BACKUP_SETTINGS_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('[BACKUP] Failed to save backup settings:', err);
  }
};

export const clearBackupSettings = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(BACKUP_SETTINGS_KEY);
  } catch { /* silent */ }
};

// ─── Sync Queue ────────────────────────────────────────────────────────────────

export const getSyncQueue = async (): Promise<SyncQueueItem[]> => {
  try {
    const raw = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};

export const saveSyncQueue = async (queue: SyncQueueItem[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.warn('[BACKUP] Failed to save sync queue:', err);
  }
};

export const addToSyncQueue = async (item: Omit<SyncQueueItem, 'enqueuedAt' | 'retryCount' | 'status'>): Promise<void> => {
  try {
    const queue = await getSyncQueue();
    // Deduplicate: if same ID already pending/failed, update it
    const existing = queue.findIndex(q => q.id === item.id);
    const newItem: SyncQueueItem = {
      ...item,
      enqueuedAt: new Date().toISOString(),
      retryCount: 0,
      status: 'pending',
    };
    if (existing >= 0) {
      queue[existing] = newItem;
    } else {
      queue.push(newItem);
    }
    await saveSyncQueue(queue);
    console.log(`[BACKUP] Parchi ${item.id} added to sync queue (op: ${item.operation})`);
  } catch (err) {
    console.warn('[BACKUP] Failed to add to sync queue:', err);
  }
};

export const removeFromSyncQueue = async (ids: string[]): Promise<void> => {
  try {
    const queue = await getSyncQueue();
    const filtered = queue.filter(q => !ids.includes(q.id));
    await saveSyncQueue(filtered);
  } catch { /* silent */ }
};

export const updateSyncQueueItem = async (
  id: string,
  updates: Partial<SyncQueueItem>
): Promise<void> => {
  try {
    const queue = await getSyncQueue();
    const idx = queue.findIndex(q => q.id === id);
    if (idx >= 0) {
      queue[idx] = { ...queue[idx], ...updates };
      await saveSyncQueue(queue);
    }
  } catch { /* silent */ }
};

export const clearSyncQueue = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(SYNC_QUEUE_KEY);
  } catch { /* silent */ }
};

// ─── Deleted IDs (Tombstones) ─────────────────────────────────────────────────

export const getDeletedIds = async (): Promise<string[]> => {
  try {
    const raw = await AsyncStorage.getItem(DELETED_IDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};

export const addDeletedId = async (id: string): Promise<void> => {
  try {
    const ids = await getDeletedIds();
    if (!ids.includes(id)) {
      ids.push(id);
      await AsyncStorage.setItem(DELETED_IDS_KEY, JSON.stringify(ids));
    }
  } catch { /* silent */ }
};

export const clearDeletedIds = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(DELETED_IDS_KEY);
  } catch { /* silent */ }
};

// ─── Secure Token Storage ─────────────────────────────────────────────────────

export const saveTokens = async (tokens: GoogleTokens): Promise<void> => {
  try {
    await SecureStore.setItemAsync(SECURE_TOKENS_KEY, JSON.stringify(tokens));
    console.log('[BACKUP] Google tokens saved securely');
  } catch (err) {
    console.warn('[BACKUP] Failed to save tokens securely:', err);
  }
};

export const getTokens = async (): Promise<GoogleTokens | null> => {
  try {
    const raw = await SecureStore.getItemAsync(SECURE_TOKENS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

export const clearTokens = async (): Promise<void> => {
  try {
    await SecureStore.deleteItemAsync(SECURE_TOKENS_KEY);
    console.log('[BACKUP] Google tokens cleared');
  } catch { /* silent */ }
};

export const isTokenExpired = (tokens: GoogleTokens): boolean => {
  // Consider expired if within 5 minutes of expiry
  return Date.now() >= tokens.expiresAt - 5 * 60 * 1000;
};
