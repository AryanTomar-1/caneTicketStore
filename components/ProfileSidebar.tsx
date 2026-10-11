// ─── components/ProfileSidebar.tsx ───────────────────────────────────────────
// Slide-in sidebar from the right showing:
//  - Backup status (enabled/disabled/syncing/failed/auth_required)
//  - Last backup time
//  - Start Backup / Backup Settings
//  - Sync Now
//  - Restore Backup
//  - Disconnect Google Account
//  - Settings (placeholder)

import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Animated,
  ScrollView, ActivityIndicator, Alert, Share,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBackup } from "../context/BackupContext";
import BackupSetupScreen from "../app/backup-setup";
import { restoreFromDrive, getFriendlyBackupErrorMessage } from "../backup/BackupService";
import { formatDateTime } from "../utils/storage";
import { RestoreResult } from "../backup/BackupTypes";

interface Props {
  visible: boolean;
  onClose: () => void;
  onDataRestored?: () => void;  // callback to refresh data in parent
}

export default function ProfileSidebar({ visible, onClose, onDataRestored }: Props) {
  const insets = useSafeAreaInsets();
  const { settings, syncState, isLoading, syncNow, disconnect, refreshSettings } = useBackup();
  const slideAnim = useRef(new Animated.Value(350)).current;
  const [showSetupScreen, setShowSetupScreen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [isRestoring, setIsRestoring] = useState(false);

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 350,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  // ── Sync Now ──────────────────────────────────────────────────────────────
  const handleSyncNow = async () => {
    setIsSyncing(true);
    setSyncMsg("Sync ho raha hai...");
    try {
      const result = await syncNow();
      if (result?.success) {
        setSyncMsg(`✅ Backup complete. ${result.syncedCount} records synced.`);
      } else if (result?.error === "AUTH_REQUIRED") {
        setSyncMsg("Google account ko dobara connect karein.");
      } else if (result === null) {
        setSyncMsg("✅ Aapka data already up to date hai.");
      } else {
        setSyncMsg("Backup abhi nahi ho paya. Baad me dobara try hoga.");
      }
    } catch (err: any) {
      console.error("[BACKUP] SyncNow error:", err);
      setSyncMsg(getFriendlyBackupErrorMessage(err));
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncMsg(""), 4000);
    }
  };

  // ── Restore ────────────────────────────────────────────────────────────────
  const handleRestore = () => {
    if (!settings.driveFileId) {
      Alert.alert("Backup Nahi Mila", "Koi backup available nahi hai restore karne ke liye.");
      return;
    }
    Alert.alert(
      "Restore Backup",
      "Restore karne par backup ka data aapke app me add/restore kiya jayega. Duplicate records nahi judenge. Kya aap continue karna chahte hain?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore Karein",
          onPress: async () => {
            setIsRestoring(true);
            try {
              const result: RestoreResult = await restoreFromDrive(settings.driveFileId!, "merge");
              Alert.alert(
                "Restore Complete",
                `✅ ${result.addedCount} nayi parichiyaan add hui.\n${result.updatedCount} update hui.\n${result.skippedCount} skip ki gain (already exist thi).`
              );
              onDataRestored?.();
            } catch (err: any) {
              console.error("[BACKUP] Restore error:", err);
              Alert.alert("Restore Nahi Hua", getFriendlyBackupErrorMessage(err));
            } finally {
              setIsRestoring(false);
            }
          },
        },
      ]
    );
  };

  // ── Disconnect ─────────────────────────────────────────────────────────────
  const handleDisconnect = () => {
    Alert.alert(
      "Google Account Disconnect Karein?",
      "Backup disable ho jayega. Aapka local data safe rahega. Kya aap sure hain?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            await disconnect();
            await refreshSettings();
          },
        },
      ]
    );
  };

  // ── Status Display ─────────────────────────────────────────────────────────
  const getStatusConfig = () => {
    if (!settings.enabled) return { icon: "cloud-offline-outline", color: "#64748b", label: "Backup: Off", sublabel: "Aapka data local phone me hai sirf." };
    switch (syncState.status) {
      case "syncing": return { icon: "cloud-upload-outline", color: "#f0a500", label: "Backup: Syncing...", sublabel: `${syncState.pendingCount} records upload ho rahe hain` };
      case "pending": return { icon: "cloud-outline", color: "#06b6d4", label: "Backup: Pending", sublabel: `${syncState.pendingCount} records backup ke liye pending hain` };
      case "failed": return { icon: "cloud-offline-outline", color: "#ef4444", label: "Backup: Failed", sublabel: "Backup abhi nahi ho paya. Retry karein." };
      case "auth_required": return { icon: "key-outline", color: "#f0a500", label: "Re-connect Zaroori", sublabel: "Google account ko dobara connect karein" };
      case "idle": return { icon: "cloud-done-outline", color: "#22c55e", label: "Backup: On ✅", sublabel: settings.lastBackupAt ? `Last: ${formatDateTime(settings.lastBackupAt)}` : "Active" };
      default: return { icon: "cloud-outline", color: "#94a3b8", label: "Backup: Checking...", sublabel: "" };
    }
  };

  // ── Share App ─────────────────────────────────────────────────────────────
  const handleShareApp = async () => {
    const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.aryan_tomar.SmartKissan';
    try {
      await Share.share({
        message:
          `🌾 *Smart Kissan - गन्ना पर्ची और वजन रिकॉर्ड ऐप*\n\n` +
          `गन्ना किसानों के लिए पर्ची और वजन का सटीक हिसाब रखने का सबसे आसान ऐप।\n\n` +
          `✅ पर्ची रिकॉर्ड करें\n` +
          `✅ बोलकर (Voice) तुरंत एंट्री करें\n` +
          `✅ Google Drive पर सुरक्षित बैकअप रखें\n\n` +
          `📲 किसान भाई अभी डाउनलोड करें:\n` +
          `👉 ${PLAY_STORE_URL}`,
      });
    } catch (e) {
      console.warn('Share error:', e);
    }
  };

  const statusConfig = getStatusConfig();

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      {showSetupScreen ? (
        <View style={styles.setupOverlay}>
          <View style={[styles.setupHeader, { paddingTop: Math.max(insets.top, 16) }]}>
            <TouchableOpacity onPress={() => setShowSetupScreen(false)} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={22} color="#f8fafc" />
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
          </View>
          <BackupSetupScreen
            onComplete={() => { setShowSetupScreen(false); refreshSettings(); }}
            onDismiss={() => setShowSetupScreen(false)}
            showSkip={false}
          />
        </View>
      ) : (
        <>
          {/* Backdrop */}
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

          {/* Sidebar */}
          <Animated.View
            style={[
              styles.sidebar,
              { paddingTop: Math.max(insets.top, 24), transform: [{ translateX: slideAnim }] },
            ]}
          >
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sidebarContent}>
              {/* Close + Title */}
              <View style={styles.sidebarHeader}>
                <View style={styles.sidebarTitleRow}>
                  <Ionicons name="person-circle-outline" size={28} color="#f0a500" />
                  <Text style={styles.sidebarTitle}>Profile</Text>
                </View>
                <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={22} color="#94a3b8" />
                </TouchableOpacity>
              </View>

              {/* Google Account Info */}
              {settings.enabled && settings.googleEmail && (
                <View style={styles.accountCard}>
                  <View style={styles.accountAvatarCircle}>
                    <Text style={styles.accountAvatarText}>
                      {settings.googleEmail.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.accountEmail} numberOfLines={1}>{settings.googleEmail}</Text>
                    <Text style={styles.accountSubtext}>Google Account</Text>
                  </View>
                </View>
              )}

              {/* Divider */}
              <View style={styles.divider} />

              {/* Backup Section */}
              <Text style={styles.sectionLabel}>☁ Backup & Restore</Text>

              {/* Status Card */}
              <View style={styles.statusCard}>
                <View style={styles.statusRow}>
                  <Ionicons name={statusConfig.icon as any} size={22} color={statusConfig.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.statusLabel, { color: statusConfig.color }]}>{statusConfig.label}</Text>
                    {statusConfig.sublabel ? (
                      <Text style={styles.statusSublabel}>{statusConfig.sublabel}</Text>
                    ) : null}
                  </View>
                </View>
                {syncState.failedCount > 0 && (
                  <Text style={styles.failedHint}>⚠️ {syncState.failedCount} records backup nahi ho sakey</Text>
                )}
                {syncMsg ? <Text style={styles.syncMsgText}>{syncMsg}</Text> : null}
              </View>

              {/* Action Buttons */}
              {!settings.enabled ? (
                <TouchableOpacity style={styles.actionBtn} onPress={() => setShowSetupScreen(true)} activeOpacity={0.8}>
                  <Ionicons name="cloud-upload-outline" size={18} color="#f0a500" />
                  <Text style={styles.actionBtnText}>Start Backup</Text>
                  <Ionicons name="chevron-forward" size={16} color="#64748b" />
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => setShowSetupScreen(true)} activeOpacity={0.8}>
                    <Ionicons name="settings-outline" size={18} color="#a855f7" />
                    <Text style={styles.actionBtnText}>Backup Settings</Text>
                    <Ionicons name="chevron-forward" size={16} color="#64748b" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionBtn, isSyncing && styles.actionBtnDisabled]}
                    onPress={handleSyncNow}
                    activeOpacity={0.8}
                    disabled={isSyncing}
                  >
                    {isSyncing ? (
                      <ActivityIndicator size="small" color="#06b6d4" />
                    ) : (
                      <Ionicons name="sync-outline" size={18} color="#06b6d4" />
                    )}
                    <Text style={styles.actionBtnText}>Sync Now</Text>
                    <Ionicons name="chevron-forward" size={16} color="#64748b" />
                  </TouchableOpacity>
                </>
              )}

              {/* Restore */}
              <TouchableOpacity
                style={[styles.actionBtn, isRestoring && styles.actionBtnDisabled]}
                onPress={handleRestore}
                activeOpacity={0.8}
                disabled={isRestoring}
              >
                {isRestoring ? (
                  <ActivityIndicator size="small" color="#22c55e" />
                ) : (
                  <Ionicons name="download-outline" size={18} color="#22c55e" />
                )}
                <Text style={styles.actionBtnText}>Restore Backup</Text>
                <Ionicons name="chevron-forward" size={16} color="#64748b" />
              </TouchableOpacity>

              {/* Disconnect */}
              {settings.enabled && (
                <>
                  <View style={styles.divider} />
                  <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect} activeOpacity={0.7}>
                    <Ionicons name="log-out-outline" size={18} color="#ef4444" />
                    <Text style={styles.disconnectText}>Google Account Disconnect Karein</Text>
                  </TouchableOpacity>
                </>
              )}

              {/* Share App with other farmers */}
              <View style={styles.divider} />
              <TouchableOpacity style={styles.actionBtn} onPress={handleShareApp} activeOpacity={0.8}>
                <Ionicons name="share-social-outline" size={18} color="#22c55e" />
                <Text style={styles.actionBtnText}>किसान भाइयों को शेयर करें</Text>
                <Ionicons name="chevron-forward" size={16} color="#64748b" />
              </TouchableOpacity>

              {/* Divider */}
              <View style={styles.divider} />

              {/* Settings (placeholder) */}
              <Text style={styles.sectionLabel}>⚙ Settings</Text>
              <View style={styles.placeholderCard}>
                <Ionicons name="settings-outline" size={18} color="#475569" />
                <Text style={styles.placeholderText}>App settings coming soon</Text>
              </View>
            </ScrollView>
          </Animated.View>
        </>
      )}
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sidebar: {
    position: "absolute", right: 0, top: 0, bottom: 0,
    width: 310, backgroundColor: "#10102a",
    borderLeftWidth: 1, borderLeftColor: "#1e1e40",
    shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 20, elevation: 20,
  },
  sidebarContent: { paddingHorizontal: 20, paddingBottom: 40 },
  sidebarHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  sidebarTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  sidebarTitle: { color: "#f8fafc", fontSize: 20, fontWeight: "800" },
  accountCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#1a1a2e", borderRadius: 12, padding: 12, marginBottom: 4,
  },
  accountAvatarCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(240,165,0,0.18)",
    alignItems: "center", justifyContent: "center",
  },
  accountAvatarText: { color: "#f0a500", fontSize: 18, fontWeight: "800" },
  accountEmail: { color: "#f8fafc", fontSize: 13, fontWeight: "700" },
  accountSubtext: { color: "#64748b", fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: "#1e1e40", marginVertical: 16 },
  sectionLabel: { color: "#475569", fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 },
  statusCard: {
    backgroundColor: "#1a1a2e", borderRadius: 14,
    borderWidth: 1, borderColor: "#2d2d4e",
    padding: 14, marginBottom: 12,
  },
  statusRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  statusLabel: { fontSize: 14, fontWeight: "700" },
  statusSublabel: { color: "#64748b", fontSize: 12, marginTop: 2 },
  failedHint: { color: "#ef4444", fontSize: 12, marginTop: 8 },
  syncMsgText: { color: "#22c55e", fontSize: 12, marginTop: 8, fontWeight: "600" },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#1a1a2e", borderRadius: 12,
    borderWidth: 1, borderColor: "#2d2d4e",
    paddingVertical: 14, paddingHorizontal: 14,
    marginBottom: 8,
  },
  actionBtnDisabled: { opacity: 0.6 },
  actionBtnText: { flex: 1, color: "#cbd5e1", fontSize: 14, fontWeight: "600" },
  disconnectBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 12,
  },
  disconnectText: { color: "#ef4444", fontSize: 14, fontWeight: "600" },
  placeholderCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#1a1a2e", borderRadius: 12,
    borderWidth: 1, borderColor: "#2d2d4e",
    paddingVertical: 14, paddingHorizontal: 14,
  },
  placeholderText: { color: "#475569", fontSize: 14 },
  // Setup overlay
  setupOverlay: { flex: 1, backgroundColor: "#0f0f1e" },
  setupHeader: {
    backgroundColor: "#0f0f1e", paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: "#1e1e40",
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  backBtnText: { color: "#f8fafc", fontSize: 16, fontWeight: "600" },
});
