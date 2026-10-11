// components/PlayStoreUpdateModal.tsx
import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ScrollView,
} from 'react-native';

interface PlayStoreUpdateModalProps {
  visible: boolean;
  currentVersion?: string;
  latestVersion?: string;
  releaseNotes?: string;
  isForceUpdate?: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
}

const { width } = Dimensions.get('window');

export default function PlayStoreUpdateModal({
  visible,
  currentVersion = '1.0.0',
  latestVersion = '1.0.1',
  releaseNotes,
  isForceUpdate = false,
  onUpdate,
  onDismiss,
}: PlayStoreUpdateModalProps) {
  if (!visible) return null;

  const handleDismiss = () => {
    try {
      if (!isForceUpdate) {
        onDismiss();
      }
    } catch {}
  };

  const handleUpdate = () => {
    try {
      onUpdate();
    } catch {}
  };

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={handleDismiss}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header Icon / Badge */}
          <View style={styles.iconContainer}>
            <Text style={styles.iconText}>🚀</Text>
          </View>

          {/* Title */}
          <Text style={styles.title}>नया अपडेट उपलब्ध है!</Text>
          <Text style={styles.subtitleEnglish}>New Update on Play Store</Text>

          {/* Version Pill */}
          <View style={styles.versionPill}>
            <Text style={styles.versionOld}>v{currentVersion || '1.0.0'}</Text>
            <Text style={styles.versionArrow}> ➔ </Text>
            <Text style={styles.versionNew}>v{latestVersion || '1.0.1'}</Text>
          </View>

          {/* Description */}
          <Text style={styles.message}>
            Google Play Store पर Smart Kissan का नया वर्शन आ चुका है। नई सुविधाओं और बेहतर सुरक्षा के लिए कृपया अभी अपडेट करें।
          </Text>

          {/* Release Notes */}
          {Boolean(releaseNotes && releaseNotes.trim()) && (
            <View style={styles.notesBox}>
              <Text style={styles.notesTitle}>📌 इस वर्शन में नया क्या है:</Text>
              <ScrollView style={{ maxHeight: 90 }} showsVerticalScrollIndicator={false}>
                <Text style={styles.notesText}>{releaseNotes}</Text>
              </ScrollView>
            </View>
          )}

          {/* Buttons */}
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={styles.updateBtn}
              activeOpacity={0.8}
              onPress={handleUpdate}
            >
              <Text style={styles.updateBtnText}>अभी अपडेट करें (Update Now)</Text>
            </TouchableOpacity>

            {!isForceUpdate && (
              <TouchableOpacity
                style={styles.laterBtn}
                activeOpacity={0.7}
                onPress={handleDismiss}
              >
                <Text style={styles.laterBtnText}>बाद में (Later)</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 99999,
  },
  card: {
    width: Math.min(width - 40, 380),
    backgroundColor: '#16192e',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2d3356',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 25,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1f2947',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#22c55e',
  },
  iconText: {
    fontSize: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
  },
  subtitleEnglish: {
    fontSize: 13,
    color: '#94a3b8',
    marginBottom: 14,
    fontWeight: '500',
  },
  versionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f1121',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#262b47',
  },
  versionOld: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  versionArrow: {
    color: '#22c55e',
    fontSize: 13,
    fontWeight: '700',
  },
  versionNew: {
    color: '#22c55e',
    fontSize: 13,
    fontWeight: '800',
  },
  message: {
    fontSize: 13,
    lineHeight: 19,
    color: '#cbd5e1',
    textAlign: 'center',
    marginBottom: 16,
  },
  notesBox: {
    width: '100%',
    backgroundColor: '#0f1121',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#222944',
  },
  notesTitle: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  notesText: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 17,
  },
  btnRow: {
    width: '100%',
    gap: 10,
  },
  updateBtn: {
    backgroundColor: '#15803d',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#15803d',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  updateBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  laterBtn: {
    backgroundColor: 'transparent',
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterBtnText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
});
