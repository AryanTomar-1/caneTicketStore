// hooks/usePlayStoreUpdate.ts
import { useEffect, useState, useCallback } from 'react';
import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';

const VERSION_ENDPOINT = 'https://aryantomar-1.github.io/caneTicketStore/version.json';
const DEFAULT_PACKAGE_NAME = 'com.aryan_tomar.SmartKissan';

export interface RemoteVersionInfo {
  latestVersion: string;
  minVersion?: string;
  forceUpdate?: boolean;
  releaseNotes?: string;
  playStoreUrl?: string;
}

export interface PlayStoreUpdateState {
  checking: boolean;
  isUpdateAvailable: boolean;
  isForceUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  playStoreUrl: string;
  dismissed: boolean;
}

/**
 * Compare two semver strings: returns -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
export function compareSemver(v1: string, v2: string): number {
  const p1 = (v1 || '0').split('.').map(n => parseInt(n, 10) || 0);
  const p2 = (v2 || '0').split('.').map(n => parseInt(n, 10) || 0);
  const maxLen = Math.max(p1.length, p2.length);

  for (let i = 0; i < maxLen; i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 < num2) return -1;
    if (num1 > num2) return 1;
  }
  return 0;
}

export const usePlayStoreUpdate = () => {
  const currentVersion = Constants.expoConfig?.version || '1.0.0';

  const [state, setState] = useState<PlayStoreUpdateState>({
    checking: false,
    isUpdateAvailable: false,
    isForceUpdate: false,
    currentVersion,
    latestVersion: currentVersion,
    releaseNotes: '',
    playStoreUrl: `https://play.google.com/store/apps/details?id=${DEFAULT_PACKAGE_NAME}`,
    dismissed: false,
  });

  const checkForUpdate = useCallback(async () => {
    // Skip checking in dev mode unless manually tested
    if (__DEV__) {
      console.log('[PlayStoreUpdate] Skipping version check in development mode. Current version:', currentVersion);
      return;
    }

    try {
      setState(prev => ({ ...prev, checking: true }));
      // Append cache buster timestamp
      const response = await fetch(`${VERSION_ENDPOINT}?t=${Date.now()}`);
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const data: RemoteVersionInfo = await response.json();
      const latestVersion = data.latestVersion || currentVersion;
      const minVersion = data.minVersion || currentVersion;

      const hasNewerVersion = compareSemver(currentVersion, latestVersion) < 0;
      const mustForceUpdate = Boolean(data.forceUpdate) || compareSemver(currentVersion, minVersion) < 0;

      setState(prev => ({
        ...prev,
        checking: false,
        isUpdateAvailable: hasNewerVersion,
        isForceUpdate: mustForceUpdate && hasNewerVersion,
        latestVersion,
        releaseNotes: data.releaseNotes || 'नए फीचर्स और बग सुधार उपलब्ध हैं।',
        playStoreUrl: data.playStoreUrl || `https://play.google.com/store/apps/details?id=${DEFAULT_PACKAGE_NAME}`,
      }));

      if (hasNewerVersion) {
        console.log(`[PlayStoreUpdate] Update available: Installed ${currentVersion} -> Latest ${latestVersion}`);
      }
    } catch (err) {
      console.warn('[PlayStoreUpdate] Check failed (safe to ignore if offline):', err);
      setState(prev => ({ ...prev, checking: false }));
    }
  }, [currentVersion]);

  const openPlayStore = useCallback(async () => {
    const packageName = Constants.expoConfig?.android?.package || DEFAULT_PACKAGE_NAME;
    const marketUri = `market://details?id=${packageName}`;
    const webUri = state.playStoreUrl || `https://play.google.com/store/apps/details?id=${packageName}`;

    try {
      if (Platform.OS === 'android') {
        const canOpenMarket = await Linking.canOpenURL(marketUri);
        if (canOpenMarket) {
          await Linking.openURL(marketUri);
          return;
        }
      }
      await Linking.openURL(webUri);
    } catch (error) {
      console.warn('[PlayStoreUpdate] Failed to open Play Store link:', error);
      await Linking.openURL(webUri);
    }
  }, [state.playStoreUrl]);

  const dismissModal = useCallback(() => {
    if (!state.isForceUpdate) {
      setState(prev => ({ ...prev, dismissed: true }));
    }
  }, [state.isForceUpdate]);

  useEffect(() => {
    // Check for updates shortly after app launch
    const timer = setTimeout(() => {
      checkForUpdate();
    }, 1200);

    return () => clearTimeout(timer);
  }, [checkForUpdate]);

  return {
    ...state,
    checkForUpdate,
    openPlayStore,
    dismissModal,
  };
};
