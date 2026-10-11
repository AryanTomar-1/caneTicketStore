import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

// Complete auth session if in browser context
WebBrowser.maybeCompleteAuthSession();

export default function ExpoAuthSessionScreen() {
  const router = useRouter();

  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();

    // After a brief delay to let GoogleDriveService process the token from the deep link,
    // transition back to main app
    const timer = setTimeout(() => {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)');
      }
    }, 1800);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#f0a500" />
      <Text style={styles.title}>Google Account Jod Rahe Hain...</Text>
      <Text style={styles.subtitle}>Kripya prateeksha karein, backup setup complete ho raha hai.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    marginTop: 20,
    textAlign: 'center',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
});
