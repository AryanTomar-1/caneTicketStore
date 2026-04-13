import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';
import { SeasonProvider } from '../context/SeasonContext';
import { cleanupOldSeasons } from '../utils/storage';
import { useEffect } from 'react';

export const unstable_settings = { anchor: '(tabs)' };


export default function RootLayout() {

  useEffect(() => {
    cleanupOldSeasons(); // runs silently in background
  }, []);

  return (
    <SafeAreaProvider>
      <SeasonProvider>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style="light" backgroundColor="#0f0f1e" />
      </SeasonProvider>
    </SafeAreaProvider>
  );
}
