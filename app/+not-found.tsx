import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export default function NotFoundScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Yeh page uplabdh nahi hai.</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => router.replace('/(tabs)')}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>Wapas Home Par Jayein</Text>
      </TouchableOpacity>
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
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 20,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#f0a500',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
});
