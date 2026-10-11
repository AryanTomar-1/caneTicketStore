// ─── BackupTypes.ts ───────────────────────────────────────────────────────────
// All TypeScript interfaces and constants for the Google Drive backup system.

import { Ticket, MillPaymentSettings } from '../types';

// ─── Backup Settings ──────────────────────────────────────────────────────────

export interface BackupSettings {
  enabled: boolean;
  setupCompleted: boolean;
  googleEmail?: string;
  googleAccountId?: string;
  lastBackupAt?: string;
  driveFileId?: string;
  driveMetadataFileId?: string;
  driveFolderId?: string;
  driveDataFolderId?: string;
  appVersion?: string;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: false,
  setupCompleted: false,
};

// ─── Sync Queue ────────────────────────────────────────────────────────────────

export type SyncOperation = 'upsert' | 'delete';
export type SyncStatus = 'pending' | 'syncing' | 'failed' | 'synced';

export interface SyncQueueItem {
  id: string;
  seasonId: string;
  operation: SyncOperation;
  enqueuedAt: string;
  retryCount: number;
  lastAttemptAt?: string;
  status: SyncStatus;
}

// ─── Backup State ─────────────────────────────────────────────────────────────

export type BackupOverallStatus =
  | 'disabled'
  | 'idle'
  | 'syncing'
  | 'pending'
  | 'failed'
  | 'auth_required';

export interface BackupSyncState {
  status: BackupOverallStatus;
  pendingCount: number;
  failedCount: number;
  syncedCount: number;
  lastSyncAt?: string;
  currentUpload?: { current: number; total: number };
}

// ─── Drive Backup Payload ──────────────────────────────────────────────────────

export interface DriveSeasonData {
  seasonId: string;
  tickets: Ticket[];
}

export interface DriveBackupPayload {
  backupVersion: number;
  appVersion: string;
  appName: 'SmartKissan';
  deviceId: string;
  exportedAt: string;
  seasons: DriveSeasonData[];
  millPaymentSettings: Record<string, MillPaymentSettings | null>;
  caneRates: Record<string, string>;
  deletedIds: string[];
}

// ─── Drive Metadata ────────────────────────────────────────────────────────────

export interface DriveMetadata {
  schemaVersion: number;
  appName: 'SmartKissan';
  deviceId: string;
  googleEmail: string;
  lastBackupAt: string;
  backupVersion: number;
  totalRecords: number;
  seasons: string[];
  appVersion: string;
}

// ─── Results ──────────────────────────────────────────────────────────────────

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  pendingCount: number;
  error?: string;
  lastSyncAt?: string;
}

export interface RestoreResult {
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
  seasonCount: number;
  conflictCount: number;
}

// ─── Google Tokens ────────────────────────────────────────────────────────────

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: string;
  scope: string;
  email?: string;
  sub?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const BACKUP_FOLDER_NAME = 'Smart Kisan Backup';
export const BACKUP_DATA_FOLDER_NAME = 'data';
export const BACKUP_METADATA_FILE = 'metadata.json';
export const BACKUP_DATA_FILE = 'backup_full.json';
export const BACKUP_VERSION = 1;
export const APP_NAME = 'SmartKissan' as const;
export const MAX_RETRY_COUNT = 10;
export const SYNC_BATCH_SIZE = 100;
export const RETRY_DELAYS_MS = [5000, 15000, 30000, 60000, 300000];
