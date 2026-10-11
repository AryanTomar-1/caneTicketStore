// ─── BackupService.ts ─────────────────────────────────────────────────────────
// High-level orchestration: backup, restore, validation, and account management.

import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DriveBackupPayload, DriveMetadata, DriveSeasonData,
  RestoreResult, SyncResult, GoogleTokens,
  BACKUP_VERSION, APP_NAME,
  MAX_RETRY_COUNT,
} from './BackupTypes';
import {
  getBackupSettings, saveBackupSettings, clearBackupSettings,
  getSyncQueue, saveSyncQueue, clearSyncQueue,
  getDeletedIds, addDeletedId,
  getTokens, clearTokens,
} from './BackupStorage';
import {
  signInWithGoogle, signOut as googleSignOut,
  findOrCreateBackupFolder, findFileInFolder,
  uploadBackupPayload, uploadMetadata,
  downloadBackupPayload, downloadMetadata,
  getValidAccessToken,
} from './GoogleDriveService';
import {
  getAllSeasons,
} from '../utils/season';
import {
  getTicketsBySeason,
  getMillPaymentSettings, setMillPaymentSettings,
  getCaneRate, setCaneRate,
  exportFullDatabase,
} from '../utils/storage';
import AsyncStorageLib from '@react-native-async-storage/async-storage';
import { Ticket, MillPaymentSettings } from '../types';

// ─── Device ID ────────────────────────────────────────────────────────────────

const getDeviceId = async (): Promise<string> => {
  const KEY = '@device_id';
  try {
    let id = await AsyncStorageLib.getItem(KEY);
    if (!id) {
      id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
      await AsyncStorageLib.setItem(KEY, id);
    }
    return id;
  } catch {
    return Constants.sessionId || 'unknown';
  }
};

const getAppVersion = (): string => {
  return Constants.expoConfig?.version || '1.0.0';
};

// ─── Build full backup payload from local data ─────────────────────────────────

const buildBackupPayload = async (): Promise<DriveBackupPayload> => {
  const seasons = getAllSeasons();
  const deviceId = await getDeviceId();
  const deletedIds = await getDeletedIds();

  const seasonsData: DriveSeasonData[] = [];
  const millPaymentSettings: Record<string, MillPaymentSettings | null> = {};
  const caneRates: Record<string, string> = {};

  for (const season of seasons) {
    const tickets = await getTicketsBySeason(season.id);
    // Filter out soft-deleted records
    const activeTickets = tickets.filter(t => !deletedIds.includes(t.id));
    seasonsData.push({ seasonId: season.id, tickets: activeTickets });
    millPaymentSettings[season.id] = await getMillPaymentSettings(season.id);
    caneRates[season.id] = await getCaneRate(season.id);
  }

  return {
    backupVersion: BACKUP_VERSION,
    appVersion: getAppVersion(),
    appName: APP_NAME,
    deviceId,
    exportedAt: new Date().toISOString(),
    seasons: seasonsData,
    millPaymentSettings,
    caneRates,
    deletedIds,
  };
};

// ─── Validate backup payload ───────────────────────────────────────────────────

export const validateBackupPayload = (payload: any): payload is DriveBackupPayload => {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.appName !== APP_NAME) return false;
  if (typeof payload.backupVersion !== 'number') return false;
  if (!Array.isArray(payload.seasons)) return false;
  for (const s of payload.seasons) {
    if (!s.seasonId || !Array.isArray(s.tickets)) return false;
    for (const t of s.tickets) {
      if (!t.id || !t.farmer_code || !t.name || !t.date) return false;
    }
  }
  return true;
};

// ─── Connect Google Account ────────────────────────────────────────────────────

export const connectGoogleAccount = async (): Promise<GoogleTokens> => {
  console.log('[BACKUP] Google account connection initiated');
  const tokens = await signInWithGoogle();
  await saveBackupSettings({ googleEmail: tokens.email, googleAccountId: tokens.sub });
  return tokens;
};

// ─── Initialize Backup (first-time setup) ────────────────────────────────────

export const initializeBackup = async (): Promise<{
  driveFileId: string;
  driveMetadataFileId: string;
  driveFolderId: string;
  driveDataFolderId: string;
  existingBackupFound: boolean;
  existingPayload?: DriveBackupPayload;
}> => {
  console.log('[BACKUP] Initializing backup...');

  const { folderId, dataFolderId } = await findOrCreateBackupFolder();

  // Check if backup already exists
  const existingMetaId = await findFileInFolder(folderId, 'metadata.json');
  const existingDataId = await findFileInFolder(dataFolderId, 'backup_full.json');

  let existingBackupFound = false;
  let existingPayload: DriveBackupPayload | undefined;

  if (existingDataId) {
    try {
      const payload = await downloadBackupPayload(existingDataId);
      if (validateBackupPayload(payload)) {
        existingBackupFound = true;
        existingPayload = payload;
        console.log(`[BACKUP] Existing backup found with ${payload.seasons.reduce((s, x) => s + x.tickets.length, 0)} records`);
      }
    } catch {
      console.log('[BACKUP] Existing backup file found but could not be parsed');
    }
  }

  return {
    driveFileId: existingDataId || '',
    driveMetadataFileId: existingMetaId || '',
    driveFolderId: folderId,
    driveDataFolderId: dataFolderId,
    existingBackupFound,
    existingPayload,
  };
};

// ─── Perform Full Backup ───────────────────────────────────────────────────────

export const performFullBackup = async (): Promise<SyncResult> => {
  console.log('[BACKUP] Sync started');

  const settings = await getBackupSettings();
  if (!settings.enabled) {
    return { success: false, syncedCount: 0, failedCount: 0, pendingCount: 0, error: 'Backup disabled' };
  }

  try {
    await getValidAccessToken(); // Throws AUTH_REQUIRED if needed
  } catch {
    return { success: false, syncedCount: 0, failedCount: 0, pendingCount: 0, error: 'AUTH_REQUIRED' };
  }

  try {
    const payload = await buildBackupPayload();
    const totalRecords = payload.seasons.reduce((s, x) => s + x.tickets.length, 0);

    let folderId = settings.driveFolderId;
    let dataFolderId = settings.driveDataFolderId;

    // If folder IDs not saved, find/create them
    if (!folderId || !dataFolderId) {
      const folders = await findOrCreateBackupFolder();
      folderId = folders.folderId;
      dataFolderId = folders.dataFolderId;
      await saveBackupSettings({ driveFolderId: folderId, driveDataFolderId: dataFolderId });
    }

    // Upload data file
    const driveFileId = await uploadBackupPayload(
      dataFolderId,
      payload,
      settings.driveFileId || undefined
    );

    // Build and upload metadata
    const tokens = await getTokens();
    const deviceId = await getDeviceId();
    const metadata: DriveMetadata = {
      schemaVersion: 1,
      appName: APP_NAME,
      deviceId,
      googleEmail: tokens?.email || settings.googleEmail || '',
      lastBackupAt: payload.exportedAt,
      backupVersion: BACKUP_VERSION,
      totalRecords,
      seasons: payload.seasons.map(s => s.seasonId),
      appVersion: getAppVersion(),
    };

    const driveMetadataFileId = await uploadMetadata(
      folderId,
      metadata,
      settings.driveMetadataFileId || undefined
    );

    const now = new Date().toISOString();
    await saveBackupSettings({
      driveFileId,
      driveMetadataFileId,
      driveFolderId: folderId,
      driveDataFolderId: dataFolderId,
      lastBackupAt: now,
      appVersion: getAppVersion(),
    });

    // Clear sync queue since we just did a full backup
    await clearSyncQueue();

    const result: SyncResult = {
      success: true,
      syncedCount: totalRecords,
      failedCount: 0,
      pendingCount: 0,
      lastSyncAt: now,
    };

    console.log(`[BACKUP] Sync completed. ${totalRecords} records backed up`);
    return result;
  } catch (err: any) {
    console.warn('[BACKUP] Sync failed:', err.message);
    return {
      success: false,
      syncedCount: 0,
      failedCount: 1,
      pendingCount: (await getSyncQueue()).length,
      error: err.message,
    };
  }
};

// ─── Restore from Drive ────────────────────────────────────────────────────────

export const restoreFromDrive = async (
  driveFileId: string,
  mode: 'merge' | 'replace'
): Promise<RestoreResult> => {
  console.log(`[BACKUP] Restore started (mode: ${mode})`);

  const payload = await downloadBackupPayload(driveFileId);

  if (!validateBackupPayload(payload)) {
    throw new Error('Backup file sahi format me nahi hai. Data restore nahi kiya ja sakta.');
  }

  if (payload.backupVersion > BACKUP_VERSION) {
    throw new Error(`Ye backup ek newer app version ka hai (v${payload.backupVersion}). App update karein.`);
  }

  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let conflictCount = 0;
  const seasonCount = payload.seasons.length;
  const deletedIds = payload.deletedIds || [];

  const SEASON_KEY = (id: string) => `cane_tickets_${id}`;

  for (const seasonData of payload.seasons) {
    const { seasonId, tickets: cloudTickets } = seasonData;
    if (!seasonId || !Array.isArray(cloudTickets)) continue;

    if (mode === 'replace') {
      // Filter out deleted IDs
      const toWrite = cloudTickets.filter(t => !deletedIds.includes(t.id));
      await AsyncStorageLib.setItem(SEASON_KEY(seasonId), JSON.stringify(toWrite));
      addedCount += toWrite.length;
    } else {
      // Merge mode
      let localTickets: Ticket[] = [];
      try {
        const raw = await AsyncStorageLib.getItem(SEASON_KEY(seasonId));
        localTickets = raw ? JSON.parse(raw) : [];
      } catch { localTickets = []; }

      const localMap = new Map<string, Ticket>(localTickets.map(t => [t.id, t]));
      const merged = [...localTickets];

      for (const cloudTicket of cloudTickets) {
        // Skip if this ID was locally deleted
        if (deletedIds.includes(cloudTicket.id)) {
          skippedCount++;
          continue;
        }

        const local = localMap.get(cloudTicket.id);
        if (!local) {
          // New record from cloud
          merged.push(cloudTicket);
          addedCount++;
        } else {
          // Conflict — compare updatedAt / createdAt
          const localTime = new Date(local.updatedAt || local.createdAt).getTime();
          const cloudTime = new Date(cloudTicket.updatedAt || cloudTicket.createdAt).getTime();

          if (cloudTime > localTime) {
            // Cloud is newer — update local
            const idx = merged.findIndex(t => t.id === cloudTicket.id);
            if (idx >= 0) merged[idx] = cloudTicket;
            updatedCount++;
            conflictCount++;
          } else {
            // Local is newer or same — keep local
            skippedCount++;
          }
        }
      }

      await AsyncStorageLib.setItem(SEASON_KEY(seasonId), JSON.stringify(merged));
    }

    // Restore mill payment settings (only if not locally set, or merge)
    const cloudMillSettings = payload.millPaymentSettings?.[seasonId];
    if (cloudMillSettings) {
      const localMill = await getMillPaymentSettings(seasonId);
      if (!localMill || mode === 'replace') {
        await setMillPaymentSettings(seasonId, cloudMillSettings);
      }
    }

    // Restore cane rates
    const cloudRate = payload.caneRates?.[seasonId];
    if (cloudRate) {
      const localRate = await getCaneRate(seasonId);
      if (!localRate || mode === 'replace') {
        await setCaneRate(seasonId, cloudRate);
      }
    }
  }

  console.log(`[BACKUP] Restore complete: added=${addedCount}, updated=${updatedCount}, skipped=${skippedCount}`);
  return { addedCount, updatedCount, skippedCount, seasonCount, conflictCount };
};

// ─── Check for existing backup ────────────────────────────────────────────────

export const checkForExistingBackup = async (): Promise<{
  found: boolean;
  metadata?: DriveMetadata;
  driveFileId?: string;
  driveMetadataFileId?: string;
  driveFolderId?: string;
  driveDataFolderId?: string;
}> => {
  try {
    const { folderId, dataFolderId } = await findOrCreateBackupFolder();
    const metaId = await findFileInFolder(folderId, 'metadata.json');
    const dataId = await findFileInFolder(dataFolderId, 'backup_full.json');

    if (!metaId && !dataId) {
      return { found: false };
    }

    let metadata: DriveMetadata | undefined;
    if (metaId) {
      try {
        metadata = await downloadMetadata(metaId);
      } catch { /* metadata read failed */ }
    }

    return {
      found: true,
      metadata,
      driveFileId: dataId || undefined,
      driveMetadataFileId: metaId || undefined,
      driveFolderId: folderId,
      driveDataFolderId: dataFolderId,
    };
  } catch {
    return { found: false };
  }
};

// ─── Enable Backup ────────────────────────────────────────────────────────────

export const enableBackup = async (params: {
  googleEmail: string;
  googleAccountId?: string;
  driveFileId: string;
  driveMetadataFileId: string;
  driveFolderId: string;
  driveDataFolderId: string;
}): Promise<void> => {
  await saveBackupSettings({
    enabled: true,
    setupCompleted: true,
    ...params,
  });
  console.log('[BACKUP] Backup enabled');
};

// ─── Disable Backup (Skip) ────────────────────────────────────────────────────

export const skipBackupSetup = async (): Promise<void> => {
  await saveBackupSettings({ enabled: false, setupCompleted: true });
  console.log('[BACKUP] Backup setup skipped by user');
};

// ─── Disconnect Google Account ────────────────────────────────────────────────

export const disconnectGoogleAccount = async (): Promise<void> => {
  await googleSignOut();
  await saveBackupSettings({
    enabled: false,
    googleEmail: undefined,
    googleAccountId: undefined,
    driveFileId: undefined,
    driveMetadataFileId: undefined,
    driveFolderId: undefined,
    driveDataFolderId: undefined,
    lastBackupAt: undefined,
  });
  await clearSyncQueue();
  console.log('[BACKUP] Google account disconnected and backup disabled');
};

// ─── User-Friendly Error Messages ─────────────────────────────────────────────

/**
 * Converts technical Google Drive / OAuth / Network errors into
 * clean, simple, understandable messages in Hindi/Hinglish for the user.
 */
export const getFriendlyBackupErrorMessage = (err: any): string => {
  if (!err) {
    return 'Google Drive से कनेक्ट करने में समस्या आई। कृपया दोबारा कोशिश करें।';
  }

  const rawMsg = typeof err === 'string'
    ? err
    : (err?.message || err?.error_description || err?.error || JSON.stringify(err));
  const lower = String(rawMsg).toLowerCase();

  // 1. Quota / Storage full
  if (
    lower.includes('quota') ||
    lower.includes('storage') ||
    lower.includes('quotaexceeded') ||
    lower.includes('storagequota') ||
    lower.includes('userratelimitexceeded') ||
    lower.includes('insufficientfilepermissions') ||
    (lower.includes('403') && (lower.includes('drive') || lower.includes('limit') || lower.includes('quota')))
  ) {
    return 'Google Drive का स्टोरेज भर चुका है (Storage Full)। कृपया Google Drive में कुछ जगह खाली करें या कोई दूसरा Google अकाउंट चुनें।';
  }

  // 2. Internet / Network connection error
  if (
    lower.includes('network request failed') ||
    lower.includes('networkerror') ||
    lower.includes('timeout') ||
    lower.includes('offline') ||
    lower.includes('failed to fetch') ||
    lower.includes('fetch failed') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('internet')
  ) {
    return 'इंटरनेट कनेक्शन कमजोर या बंद है। कृपया अपना इंटरनेट कनेक्शन चेक करके दोबारा कोशिश करें।';
  }

  // 3. Login Cancelled / Dismissed
  if (lower.includes('user_cancelled') || lower.includes('cancelled') || lower.includes('dismissed')) {
    return 'लॉगिन रद्द कर दिया गया। बैकअप सुरक्षित रखने के लिए Google अकाउंट से लॉगिन आवश्यक है।';
  }

  // 4. Permission / Auth required / Expired
  if (
    lower.includes('auth_required') ||
    lower.includes('access_denied') ||
    lower.includes('permission') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid_grant') ||
    lower.includes('401')
  ) {
    return 'Google अकाउंट की अनुमति (Permission) नहीं मिली या समाप्त हो गई है। कृपया लॉगिन करते समय सभी Permissions Allow करें।';
  }

  // 5. Corrupt or unreadable file
  if (lower.includes('corrupt') || lower.includes('parse') || (lower.includes('invalid') && lower.includes('backup'))) {
    return 'बैकअप फ़ाइल पढ़ने में समस्या आई। कृपया दोबारा प्रयास करें।';
  }

  // 6. Generic Fallback
  return 'Google Drive से कनेक्ट करने में समस्या आई। कृपया थोड़ी देर बाद दोबारा कोशिश करें।';
};
