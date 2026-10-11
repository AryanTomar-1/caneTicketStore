import { useEffect, useState, useCallback, useRef } from 'react';
import * as Updates from 'expo-updates';

// ─── Types ────────────────────────────────────────────────────────────────────

export type OTAStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'       // update downloaded, waiting for reload
  | 'error'
  | 'up-to-date';

export interface OTAState {
  status: OTAStatus;
  lastChecked: Date | null;
  errorMessage: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useOTAUpdates
 *
 * Handles the full Over-The-Air update lifecycle:
 *  1. On mount  → silently checks for updates
 *  2. If found  → silently downloads in background
 *  3. When done → sets status to 'ready'
 *  4. Caller    → calls applyUpdate() to reload app
 *
 * Skips entirely in DEV mode (Expo Go / metro bundler).
 */
export const useOTAUpdates = () => {
  const [state, setState] = useState<OTAState>({
    status: 'idle',
    lastChecked: null,
    errorMessage: null,
  });

  const setStatus = (status: OTAStatus, errorMessage: string | null = null) =>
    setState({ status, lastChecked: new Date(), errorMessage });

  const isBusyRef = useRef(false);

  // ── Check & download silently ─────────────────────────────────────────────

  const checkAndDownload = useCallback(async () => {
    // Never run in dev – Updates API not available in dev client / Expo Go
    if (__DEV__) return;

    // Skip if already checking or downloading
    if (isBusyRef.current) return;
    isBusyRef.current = true;

    try {
      setStatus('checking');

      const result = await Updates.checkForUpdateAsync();

      if (!result.isAvailable) {
        setStatus('up-to-date');
        return;
      }

      // Update found → download in background
      setStatus('downloading');
      await Updates.fetchUpdateAsync();
      setStatus('ready');  // caller will show "Restart to update" UI

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OTA check failed';
      setStatus('error', msg);
      console.warn('[OTA] Update check/download failed:', msg);
    } finally {
      isBusyRef.current = false;
    }
  }, []);

  // ── Apply / reload ────────────────────────────────────────────────────────

  const applyUpdate = useCallback(async () => {
    if (__DEV__) return;
    try {
      await Updates.reloadAsync();
    } catch (err) {
      console.warn('[OTA] Reload failed:', err);
    }
  }, []);

  // ── Auto-check on mount ───────────────────────────────────────────────────

  useEffect(() => {
    // Quick delay on mount so OTA banner appears first on app launch
    const t = setTimeout(checkAndDownload, 400);
    return () => clearTimeout(t);
  }, [checkAndDownload]);

  return {
    otaStatus: state.status,
    otaLastChecked: state.lastChecked,
    otaError: state.errorMessage,
    checkAndDownload,
    applyUpdate,
  };
};
