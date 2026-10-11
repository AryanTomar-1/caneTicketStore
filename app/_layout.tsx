import * as WebBrowser from 'expo-web-browser';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import 'react-native-reanimated';

WebBrowser.maybeCompleteAuthSession();
import { SeasonProvider } from '../context/SeasonContext';
import { BackupProvider, useBackup } from '../context/BackupContext';
import { cleanupOldSeasons } from '../utils/storage';
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing, Platform, StatusBar as StatusBarRN } from 'react-native';
import { useOTAUpdates } from '../hooks/useOTAUpdates';
import { useRef } from 'react';
import BackupSetupScreen from './backup-setup';

export const unstable_settings = { anchor: '(tabs)' };

// ─── OTA Banner ───────────────────────────────────────────────────────────────

function OTABanner({ status, onApply, onCheck }: {
  status: string;
  onApply: () => void;
  onCheck: () => void;
}) {
  const insets = useSafeAreaInsets();
  const topInset = Math.max(
    insets.top,
    Platform.OS === 'android' ? (StatusBarRN.currentHeight || 0) : 0
  );

  const initialHiddenOffset = -(topInset + 120);
  const slideAnim = useRef(new Animated.Value(initialHiddenOffset)).current;
  const dotAnim = useRef(new Animated.Value(0)).current;

  // Slide in when status changes to something visible
  const visible = status === 'ready' || status === 'downloading' || status === 'checking';
  const [shouldRender, setShouldRender] = useState(visible);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 350,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: -(topInset + 120),
        duration: 350,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setShouldRender(false);
      });
    }
  }, [visible, topInset]);

  // Animated pulsing dot for downloading/checking
  useEffect(() => {
    if (status === 'downloading' || status === 'checking') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(dotAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(dotAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      dotAnim.setValue(1);
    }
  }, [status]);

  const dotOpacity = dotAnim;

  if (!shouldRender) return null;

  return (
    <Animated.View style={[bannerStyles.container, { transform: [{ translateY: slideAnim }] }]}>
      <View style={[bannerStyles.inner, { paddingTop: topInset + 6 }]}>
        <Animated.View style={[
          bannerStyles.dot,
          { opacity: dotOpacity, backgroundColor: status === 'ready' ? '#2ecc71' : '#f0a500' },
        ]} />

        <View style={bannerStyles.textBlock}>
          {status === 'checking' && (
            <Text style={bannerStyles.label}>अपडेट जाँच रहे हैं...</Text>
          )}
          {status === 'downloading' && (
            <Text style={bannerStyles.label}>नया अपडेट डाउनलोड हो रहा है...</Text>
          )}
          {status === 'ready' && (
            <Text style={bannerStyles.label}>✅ नया अपडेट तैयार है!</Text>
          )}
        </View>

        {status === 'ready' && (
          <TouchableOpacity style={bannerStyles.restartBtn} onPress={onApply} activeOpacity={0.8}>
            <Text style={bannerStyles.restartText}>अभी लागू करें</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

const bannerStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 20,
  },
  inner: {
    backgroundColor: '#1a1a2e',
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d4e',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  textBlock: { flex: 1 },
  label: { color: '#ccc', fontSize: 12, fontWeight: '600' },
  restartBtn: {
    backgroundColor: '#2ecc71',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  restartText: { color: '#0f0f1e', fontSize: 12, fontWeight: '800' },
});

// ─── First-Time Setup Gate ────────────────────────────────────────────────────

function AppWithSetupGate() {
  const { settings } = useBackup();
  const { otaStatus, checkAndDownload, applyUpdate } = useOTAUpdates();
  // null = loading, true = show setup, false = show main app
  const [showSetup, setShowSetup] = useState<boolean | null>(null);

  useEffect(() => {
    cleanupOldSeasons();
  }, []);

  useEffect(() => {
    // Once settings are loaded from AsyncStorage, decide what to show
    if (settings !== undefined) {
      setShowSetup(!settings.setupCompleted);
    }
  }, [settings?.setupCompleted]);

  return (
    <View style={{ flex: 1, backgroundColor: '#0f0f1e' }}>
      <StatusBar style="light" backgroundColor="#0f0f1e" />

      {/* Screen Content: Loading, Google Mail Sign-in / Setup, or Main App */}
      {showSetup === null ? (
        <View style={{ flex: 1, backgroundColor: '#0f0f1e' }} />
      ) : showSetup ? (
        <BackupSetupScreen
          onComplete={() => setShowSetup(false)}
          showSkip={true}
        />
      ) : (
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="backup-setup" options={{ headerShown: false }} />
          <Stack.Screen name="expo-auth-session" options={{ headerShown: false }} />
        </Stack>
      )}

      {/* OTA update banner — ALWAYS rendered on top, visible first on app launch */}
      <OTABanner
        status={otaStatus}
        onApply={applyUpdate}
        onCheck={checkAndDownload}
      />
    </View>
  );
}

// ─── Root Layout ─────────────────────────────────────────────────────────────

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SeasonProvider>
        <BackupProvider>
          <AppWithSetupGate />
        </BackupProvider>
      </SeasonProvider>
    </SafeAreaProvider>
  );
}
