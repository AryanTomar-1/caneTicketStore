// hooks/usePlayStoreUpdate.ts
import { useEffect, useState, useCallback, useRef } from 'react';
import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';

const VERSION_ENDPOINT = 'https://aryantomar-1.github.io/caneTicketStore/version.json';
const DEFAULT_PACKAGE_NAME = 'com.aryan_tomar.SmartKissan';
const FETCH_TIMEOUT_MS = 5000; // 5-second timeout so app never hangs on slow connection

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
 * Safely compare two semver strings: returns -1 if v1 < v2, 0 if equal, 1 if v1 > v2.
 * Never throws exceptions, handles prefixes like "v1.0.0" and missing parts gracefully.
 */
export function compareSemver(v1?: string | null, v2?: string | null): number {
  try {
    const clean1 = String(v1 || '0').trim().replace(/^[^\d]+/, '');
    const clean2 = String(v2 || '0').trim().replace(/^[^\d]+/, '');
    const p1 = clean1.split('.').map(n => parseInt(n, 10) || 0);
    const p2 = clean2.split('.').map(n => parseInt(n, 10) || 0);
    const maxLen = Math.max(p1.length, p2.length, 3);

    for (let i = 0; i < maxLen; i++) {
      const num1 = p1[i] || 0;
      const num2 = p2[i] || 0;
      if (num1 < num2) return -1;
      if (num1 > num2) return 1;
    }
    return 0;
  } catch {
    return 0;
  }
}

export const usePlayStoreUpdate = () => {
  // Safe retrieval of current app version
  const currentVersion = (() => {
    try {
      return Constants.expoConfig?.version || '1.0.0';
    } catch {
      return '1.0.0';
    }
  })();

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

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const checkForUpdate = useCallback(async () => {
    // In dev mode (Expo Go / local metro), don't show prompts unless tested
    if (__DEV__) {
      return;
    }

    let controller: AbortController | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      if (isMountedRef.current) {
        setState(prev => ({ ...prev, checking: true }));
      }

      controller = new AbortController();
      timeoutId = setTimeout(() => {
        try {
          controller?.abort();
        } catch {}
      }, FETCH_TIMEOUT_MS);

      // Append cache buster timestamp
      const response = await fetch(`${VERSION_ENDPOINT}?t=${Date.now()}`, {
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: RemoteVersionInfo = await response.json();
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid JSON payload');
      }

      const latestVersion = typeof data.latestVersion === 'string' ? data.latestVersion.trim() : currentVersion;
      const minVersion = typeof data.minVersion === 'string' ? data.minVersion.trim() : currentVersion;

      const hasNewerVersion = compareSemver(currentVersion, latestVersion) < 0;
      const mustForceUpdate = Boolean(data.forceUpdate) || compareSemver(currentVersion, minVersion) < 0;

      if (isMountedRef.current) {
        setState(prev => ({
          ...prev,
          checking: false,
          isUpdateAvailable: hasNewerVersion,
          isForceUpdate: Boolean(mustForceUpdate && hasNewerVersion),
          latestVersion,
          releaseNotes: typeof data.releaseNotes === 'string' ? data.releaseNotes : '',
          playStoreUrl: typeof data.playStoreUrl === 'string' ? data.playStoreUrl : `https://play.google.com/store/apps/details?id=${DEFAULT_PACKAGE_NAME}`,
        }));
      }
    } catch (err) {
      // Safe failover: network error, timeout, offline, or invalid json
      // App continues functioning normally with ZERO UI block!
      if (isMountedRef.current) {
        setState(prev => ({ ...prev, checking: false }));
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }, [currentVersion]);

  const openPlayStore = useCallback(async () => {
    const packageName = (() => {
      try {
        return Constants.expoConfig?.android?.package || DEFAULT_PACKAGE_NAME;
      } catch {
        return DEFAULT_PACKAGE_NAME;
      }
    })();

    const marketUri = `market://details?id=${packageName}`;
    const webUri = state.playStoreUrl || `https://play.google.com/store/apps/details?id=${packageName}`;

    try {
      if (Platform.OS === 'android') {
        let canOpen = false;
        try {
          canOpen = await Linking.canOpenURL(marketUri);
        } catch {
          canOpen = false;
        }

        if (canOpen) {
          await Linking.openURL(marketUri);
          return;
        }
      }
      // Fallback to web browser URL
      await Linking.openURL(webUri);
    } catch (error) {
      // Final fallback attempt
      try {
        await Linking.openURL(webUri);
      } catch {
        // Silently catch to prevent crash
      }
    }
  }, [state.playStoreUrl]);

  const dismissModal = useCallback(() => {
    try {
      if (!state.isForceUpdate) {
        setState(prev => ({ ...prev, dismissed: true }));
      }
    } catch {}
  }, [state.isForceUpdate]);

  useEffect(() => {
    // Non-blocking background check 1.5 seconds after app launch
    const timer = setTimeout(() => {
      checkForUpdate();
    }, 1500);

    return () => clearTimeout(timer);
  }, [checkForUpdate]);

  return {
    ...state,
    checkForUpdate,
    openPlayStore,
    dismissModal,
  };
};
