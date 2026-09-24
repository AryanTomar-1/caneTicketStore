import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';
import { SeasonProvider } from '../context/SeasonContext';
import { cleanupOldSeasons } from '../utils/storage';
import { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import { useOTAUpdates } from '../hooks/useOTAUpdates';
import { useRef } from 'react';

export const unstable_settings = { anchor: '(tabs)' };

// ─── OTA Banner ───────────────────────────────────────────────────────────────

function OTABanner({ status, onApply, onCheck }: {
  status: string;
  onApply: () => void;
  onCheck: () => void;
}) {
  const slideAnim = useRef(new Animated.Value(-80)).current;
  const dotAnim = useRef(new Animated.Value(0)).current;

  // Slide in when status changes to something visible
  const visible = status === 'ready' || status === 'downloading' || status === 'checking';

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 0 : -80,
      duration: 350,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible]);

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

  if (!visible) return null;

  return (
    <Animated.View style={[bannerStyles.container, { transform: [{ translateY: slideAnim }] }]}>
      <View style={bannerStyles.inner}>
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

// ─── Root Layout ─────────────────────────────────────────────────────────────

export default function RootLayout() {
  const { otaStatus, checkAndDownload, applyUpdate } = useOTAUpdates();

  useEffect(() => {
    cleanupOldSeasons(); // runs silently in background
  }, []);

  return (
    <SafeAreaProvider>
      <SeasonProvider>
        {/* OTA update banner — slides in from top, invisible in dev mode */}
        <OTABanner
          status={otaStatus}
          onApply={applyUpdate}
          onCheck={checkAndDownload}
        />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style="light" backgroundColor="#0f0f1e" />
      </SeasonProvider>
    </SafeAreaProvider>
  );
}
