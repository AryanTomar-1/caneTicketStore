// ─── app/backup-setup.tsx ─────────────────────────────────────────────────────
// First-time backup setup screen (also reused from sidebar "Start Backup").
// Handles: email validation, internet check, Google OAuth, Drive folder setup,
// existing backup detection, and conflict-free first sync.

import React, { useState, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, ScrollView, Alert, KeyboardAvoidingView,
  Platform, Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBackup } from "../context/BackupContext";
import {
  connectGoogleAccount,
  initializeBackup,
  restoreFromDrive,
  checkForExistingBackup,
  getFriendlyBackupErrorMessage,
} from "../backup/BackupService";
import { isOnline } from "../backup/SyncManager";
import { DriveBackupPayload, DriveMetadata } from "../backup/BackupTypes";
import { formatDateTime } from "../utils/storage";

// ─── Types ────────────────────────────────────────────────────────────────────

type SetupStep =
  | "email_entry"     // user enters email
  | "validating"      // validating email + checking internet
  | "google_auth"     // OAuth flow
  | "checking_drive"  // checking for existing backup
  | "existing_found"  // existing backup detected — ask restore or start fresh
  | "creating"        // creating folders + uploading
  | "done"            // success
  | "error";          // error state

interface ExistingBackupInfo {
  driveFileId: string;
  driveMetadataFileId: string;
  driveFolderId: string;
  driveDataFolderId: string;
  metadata?: DriveMetadata;
  payload?: DriveBackupPayload;
}

interface Props {
  onComplete: () => void;   // called after successful setup OR skip
  onDismiss?: () => void;   // called when user backs out (optional, e.g. from sidebar)
  showSkip?: boolean;       // show "Skip for Now" — only for first-time setup
}

// ─── Email Validator ──────────────────────────────────────────────────────────

const isValidEmail = (email: string): boolean => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email.trim());
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function BackupSetupScreen({ onComplete, onDismiss, showSkip = true }: Props) {
  const insets = useSafeAreaInsets();
  const { skipSetup, completeSetup } = useBackup();

  const [step, setStep] = useState<SetupStep>("email_entry");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [existingInfo, setExistingInfo] = useState<ExistingBackupInfo | null>(null);
  const [showSkipWarning, setShowSkipWarning] = useState(false);

  // ── Email validation ────────────────────────────────────────────────────────
  const validateEmail = (val: string): boolean => {
    const trimmed = val.trim();
    if (!trimmed) {
      setEmailError("Kripya email address enter karein.");
      return false;
    }
    if (!isValidEmail(trimmed)) {
      setEmailError("Kripya sahi email address enter karein.");
      return false;
    }
    setEmailError("");
    return true;
  };

  // ── Main Continue handler ───────────────────────────────────────────────────
  const handleContinue = useCallback(async () => {
    if (!validateEmail(email)) return;

    setStep("validating");
    setStatusMessage("Internet connection check ho raha hai...");

    // Step 1: Check internet
    const online = await isOnline();
    if (!online) {
      Alert.alert(
        "Internet Nahi Mila",
        "Internet connection available nahi hai. Backup setup ke liye internet connection zaroori hai.",
        [
          { text: "Retry", onPress: () => { setStep("email_entry"); handleContinue(); } },
          { text: "Cancel", onPress: () => setStep("email_entry"), style: "cancel" },
        ]
      );
      setStep("email_entry");
      return;
    }

    // Step 2: Google OAuth
    setStep("google_auth");
    setStatusMessage("Google account se login ho raha hai...");
    let tokens;
    try {
      tokens = await connectGoogleAccount();
    } catch (err: any) {
      if (err.message === "USER_CANCELLED") {
        Alert.alert(
          "Backup Setup Adhura",
          "Backup setup complete nahi hua.",
          [
            { text: "Try Again", onPress: () => setStep("email_entry") },
            { text: "Cancel", onPress: () => setStep("email_entry"), style: "cancel" },
          ]
        );
        setStep("email_entry");
        return;
      }
      console.error("[BACKUP] Google login error:", err);
      setStep("error");
      setErrorMessage(getFriendlyBackupErrorMessage(err));
      return;
    }

    // Verify authenticated account matches entered email
    if (tokens.email && email.trim().toLowerCase() !== tokens.email.toLowerCase()) {
      Alert.alert(
        "Account Mismatch",
        `Aapne ${email.trim()} enter kiya tha lekin aapne ${tokens.email} se login kiya. Kya aap ${tokens.email} use karna chahte hain?`,
        [
          {
            text: `Haan, ${tokens.email} use karein`,
            onPress: async () => {
              setEmail(tokens.email || email);
              try {
                await continueWithTokens(tokens);
              } catch (err: any) {
                console.error("[BACKUP] continueWithTokens error:", err);
                setStep("error");
                setErrorMessage(getFriendlyBackupErrorMessage(err));
              }
            },
          },
          { text: "Nahi, wapas jayein", onPress: () => setStep("email_entry"), style: "cancel" },
        ]
      );
      return;
    }

    try {
      await continueWithTokens(tokens);
    } catch (err: any) {
      console.error("[BACKUP] continueWithTokens error:", err);
      setStep("error");
      setErrorMessage(getFriendlyBackupErrorMessage(err));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const continueWithTokens = async (tokens: any) => {
    // Step 3: Check for existing backup
    setStep("checking_drive");
    setStatusMessage("Google Drive me backup dhundha ja raha hai...");

    try {
      const driveInfo = await initializeBackup();

      if (driveInfo.existingBackupFound && driveInfo.existingPayload) {
        // Existing backup found
        setExistingInfo({
          driveFileId: driveInfo.driveFileId,
          driveMetadataFileId: driveInfo.driveMetadataFileId,
          driveFolderId: driveInfo.driveFolderId,
          driveDataFolderId: driveInfo.driveDataFolderId,
          payload: driveInfo.existingPayload,
        });
        setStep("existing_found");
      } else {
        // No existing backup — create fresh
        await createFreshBackup(tokens, driveInfo);
      }
    } catch (err: any) {
      console.error("[BACKUP] initializeBackup error:", err);
      setStep("error");
      setErrorMessage(getFriendlyBackupErrorMessage(err));
    }
  };

  const createFreshBackup = async (tokens: any, driveInfo: any) => {
    setStep("creating");
    setStatusMessage("Backup folder create ho raha hai...");

    try {
      await completeSetup({
        googleEmail: tokens.email || email.trim(),
        googleAccountId: tokens.sub,
        driveFileId: driveInfo.driveFileId,
        driveMetadataFileId: driveInfo.driveMetadataFileId,
        driveFolderId: driveInfo.driveFolderId,
        driveDataFolderId: driveInfo.driveDataFolderId,
      });

      setStep("done");
      setStatusMessage("Backup successfully enable ho gaya!");
      setTimeout(() => onComplete(), 1500);
    } catch (err: any) {
      console.error("[BACKUP] createFreshBackup error:", err);
      setStep("error");
      setErrorMessage(getFriendlyBackupErrorMessage(err));
    }
  };

  const handleRestoreExisting = async () => {
    if (!existingInfo) return;
    setStep("creating");
    setStatusMessage("Data restore ho raha hai...");
    try {
      await restoreFromDrive(existingInfo.driveFileId, "merge");
      await completeSetup({
        googleEmail: existingInfo.payload?.seasons[0] ? email.trim() : email.trim(),
        driveFileId: existingInfo.driveFileId,
        driveMetadataFileId: existingInfo.driveMetadataFileId,
        driveFolderId: existingInfo.driveFolderId,
        driveDataFolderId: existingInfo.driveDataFolderId,
      });
      setStep("done");
      setStatusMessage("Data restore ho gaya! Backup enable ho gaya.");
      setTimeout(() => onComplete(), 2000);
    } catch (err: any) {
      console.error("[BACKUP] handleRestoreExisting error:", err);
      setStep("error");
      setErrorMessage(getFriendlyBackupErrorMessage(err));
    }
  };

  const handleSkipRestore = async () => {
    if (!existingInfo) return;
    setStep("creating");
    setStatusMessage("Backup enable ho raha hai...");
    try {
      await completeSetup({
        googleEmail: email.trim(),
        driveFileId: existingInfo.driveFileId,
        driveMetadataFileId: existingInfo.driveMetadataFileId,
        driveFolderId: existingInfo.driveFolderId,
        driveDataFolderId: existingInfo.driveDataFolderId,
      });
      setStep("done");
      setStatusMessage("Backup enable ho gaya!");
      setTimeout(() => onComplete(), 1500);
    } catch (err: any) {
      console.error("[BACKUP] handleSkipRestore error:", err);
      setStep("error");
      setErrorMessage(getFriendlyBackupErrorMessage(err));
    }
  };

  // ── Skip Flow ───────────────────────────────────────────────────────────────
  const handleSkipPress = () => {
    setShowSkipWarning(true);
  };

  const handleSkipConfirm = async () => {
    setShowSkipWarning(false);
    await skipSetup();
    onComplete();
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const isProcessing = ["validating", "google_auth", "checking_drive", "creating"].includes(step);

  const totalRecords = existingInfo?.payload?.seasons.reduce((s, x) => s + x.tickets.length, 0) ?? 0;
  const lastBackup = existingInfo?.payload?.exportedAt
    ? formatDateTime(existingInfo.payload.exportedAt)
    : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        style={[styles.container, { paddingTop: Math.max(insets.top, 24) }]}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header Icon */}
        <View style={styles.iconCircle}>
          <Ionicons name="cloud-upload-outline" size={40} color="#f0a500" />
        </View>

        {/* Title */}
        <Text style={styles.title}>Apne data ka backup{"\n"}surakshit rakhein</Text>
        <Text style={styles.subtitle}>
          Google Drive par apne app data ka backup rakhein, taaki phone badalne, app delete hone ya
          reinstall karne ke baad aapka data wapas mil sake.
        </Text>

        {/* Email Entry */}
        {step === "email_entry" && (
          <View style={styles.formSection}>
            <Text style={styles.fieldLabel}>Google Account Email</Text>
            <View style={[styles.inputWrapper, emailError ? styles.inputWrapperError : null]}>
              <Ionicons name="mail-outline" size={18} color="#64748b" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={v => { setEmail(v); if (emailError) setEmailError(""); }}
                placeholder="aapka@gmail.com"
                placeholderTextColor="#4a5568"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
              />
            </View>
            {emailError ? (
              <Text style={styles.errorText}>
                <Ionicons name="warning-outline" size={13} /> {emailError}
              </Text>
            ) : null}

            <TouchableOpacity style={styles.primaryBtn} onPress={handleContinue} activeOpacity={0.85}>
              <Ionicons name="cloud-upload-outline" size={18} color="#0f0f1e" />
              <Text style={styles.primaryBtnText}>Continue</Text>
            </TouchableOpacity>

            {showSkip && (
              <TouchableOpacity style={styles.skipBtn} onPress={handleSkipPress} activeOpacity={0.7}>
                <Text style={styles.skipBtnText}>Skip for Now</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Processing State */}
        {isProcessing && (
          <View style={styles.processingSection}>
            <ActivityIndicator size="large" color="#f0a500" />
            <Text style={styles.processingText}>{statusMessage}</Text>
            {step === "google_auth" && (
              <Text style={styles.processingSubtext}>
                Google login window band mat karein...
              </Text>
            )}
          </View>
        )}

        {/* Existing Backup Found */}
        {step === "existing_found" && existingInfo && (
          <View style={styles.existingSection}>
            <View style={styles.backupFoundBadge}>
              <Ionicons name="checkmark-circle" size={22} color="#22c55e" />
              <Text style={styles.backupFoundText}>Backup Mil Gaya! ✅</Text>
            </View>

            <View style={styles.backupInfoCard}>
              {lastBackup && <Text style={styles.backupInfoRow}>📅 Last Backup: {lastBackup}</Text>}
              <Text style={styles.backupInfoRow}>📋 Records: {totalRecords} parichiyaan</Text>
              {existingInfo.payload?.appVersion && (
                <Text style={styles.backupInfoRow}>📱 App Version: v{existingInfo.payload.appVersion}</Text>
              )}
            </View>

            <Text style={styles.restoreWarning}>
              ⚠️ Restore karne par backup ka data aapke app me add/restore kiya jayega. Aapka local data safe rahega.
            </Text>

            <TouchableOpacity style={styles.primaryBtn} onPress={handleRestoreExisting} activeOpacity={0.85}>
              <Ionicons name="download-outline" size={18} color="#0f0f1e" />
              <Text style={styles.primaryBtnText}>Restore Backup</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryBtn} onPress={handleSkipRestore} activeOpacity={0.7}>
              <Text style={styles.secondaryBtnText}>Fresh Start Karen (Restore Nahi)</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Success */}
        {step === "done" && (
          <View style={styles.successSection}>
            <Ionicons name="checkmark-circle" size={64} color="#22c55e" />
            <Text style={styles.successTitle}>Backup Enable Ho Gaya!</Text>
            <Text style={styles.successSubtitle}>{statusMessage}</Text>
          </View>
        )}

        {/* Error */}
        {step === "error" && (
          <View style={styles.errorSection}>
            <Ionicons name="cloud-offline-outline" size={52} color="#ef4444" />
            <Text style={styles.errorTitle}>Backup Setup Nahi Hua</Text>
            <Text style={styles.errorMsg}>{errorMessage}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep("email_entry")} activeOpacity={0.85}>
              <Ionicons name="refresh-outline" size={18} color="#0f0f1e" />
              <Text style={styles.primaryBtnText}>Dobara Try Karein</Text>
            </TouchableOpacity>
            {showSkip && (
              <TouchableOpacity style={styles.skipBtn} onPress={handleSkipPress} activeOpacity={0.7}>
                <Text style={styles.skipBtnText}>Skip for Now</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {/* Skip Warning Dialog */}
      <Modal visible={showSkipWarning} transparent animationType="fade" onRequestClose={() => setShowSkipWarning(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.warningCard}>
            <View style={styles.warningIconRow}>
              <Ionicons name="warning" size={28} color="#f0a500" />
              <Text style={styles.warningTitle}>Warning</Text>
            </View>
            <Text style={styles.warningText}>
              Aapka data backup band hai. Agar aapka phone/app delete ho jata hai, to app ka sara parchi data bhi
              delete ho sakta hai aur reinstall karne par wapas nahi milega.
            </Text>
            <Text style={styles.warningHint}>
              Backup shuru karne ke liye Cancel par click karein aur apna Google account enter karke Continue karein.
            </Text>
            <View style={styles.warningBtnRow}>
              <TouchableOpacity
                style={styles.warningCancelBtn}
                onPress={() => setShowSkipWarning(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.warningCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.warningOkBtn}
                onPress={handleSkipConfirm}
                activeOpacity={0.8}
              >
                <Text style={styles.warningOkText}>OK, Samajh Gaya</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1e" },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 60, alignItems: "center" },
  iconCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: "rgba(240,165,0,0.12)",
    borderWidth: 2, borderColor: "rgba(240,165,0,0.3)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 24, marginTop: 16,
  },
  title: {
    fontSize: 24, fontWeight: "800", color: "#f8fafc", textAlign: "center",
    lineHeight: 32, marginBottom: 12,
  },
  subtitle: {
    fontSize: 14, color: "#94a3b8", textAlign: "center",
    lineHeight: 22, marginBottom: 32,
  },
  formSection: { width: "100%" },
  fieldLabel: { color: "#94a3b8", fontSize: 13, fontWeight: "600", marginBottom: 8, marginLeft: 2 },
  inputWrapper: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#1a1a2e", borderWidth: 1, borderColor: "#2d2d4e",
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 14,
    marginBottom: 6,
  },
  inputWrapperError: { borderColor: "#ef4444" },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: "#f8fafc", fontSize: 15 },
  errorText: { color: "#ef4444", fontSize: 12, marginBottom: 12, marginLeft: 2 },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#f0a500", borderRadius: 14,
    paddingVertical: 16, paddingHorizontal: 24,
    marginTop: 16, gap: 8,
  },
  primaryBtnText: { color: "#0f0f1e", fontSize: 16, fontWeight: "800" },
  skipBtn: { alignItems: "center", paddingVertical: 16, marginTop: 8 },
  skipBtnText: { color: "#64748b", fontSize: 14, fontWeight: "600", textDecorationLine: "underline" },
  processingSection: { alignItems: "center", paddingVertical: 40, gap: 16 },
  processingText: { color: "#cbd5e1", fontSize: 16, fontWeight: "600", textAlign: "center" },
  processingSubtext: { color: "#64748b", fontSize: 13, textAlign: "center" },
  existingSection: { width: "100%", alignItems: "center" },
  backupFoundBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(34,197,94,0.12)", borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10, marginBottom: 16,
  },
  backupFoundText: { color: "#22c55e", fontSize: 16, fontWeight: "700" },
  backupInfoCard: {
    backgroundColor: "#1a1a2e", borderWidth: 1, borderColor: "#2d2d4e",
    borderRadius: 14, padding: 16, width: "100%", marginBottom: 16, gap: 8,
  },
  backupInfoRow: { color: "#cbd5e1", fontSize: 14 },
  restoreWarning: {
    color: "#f0a500", fontSize: 13, textAlign: "center",
    lineHeight: 20, marginBottom: 20, opacity: 0.85,
  },
  secondaryBtn: {
    alignItems: "center", paddingVertical: 14, width: "100%",
    borderWidth: 1, borderColor: "#2d2d4e", borderRadius: 14, marginTop: 10,
  },
  secondaryBtnText: { color: "#94a3b8", fontSize: 14, fontWeight: "600" },
  successSection: { alignItems: "center", paddingVertical: 40, gap: 16 },
  successTitle: { color: "#22c55e", fontSize: 22, fontWeight: "800", textAlign: "center" },
  successSubtitle: { color: "#94a3b8", fontSize: 14, textAlign: "center" },
  errorSection: { alignItems: "center", paddingVertical: 20, width: "100%", gap: 12 },
  errorTitle: { color: "#ef4444", fontSize: 20, fontWeight: "800", textAlign: "center" },
  errorMsg: { color: "#94a3b8", fontSize: 13, textAlign: "center", lineHeight: 20 },
  // Modal
  modalBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  warningCard: {
    backgroundColor: "#1a1a2e", borderRadius: 20,
    borderWidth: 1, borderColor: "#f0a500",
    padding: 24, width: "100%",
  },
  warningIconRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  warningTitle: { color: "#f0a500", fontSize: 18, fontWeight: "800" },
  warningText: { color: "#cbd5e1", fontSize: 14, lineHeight: 22, marginBottom: 12 },
  warningHint: { color: "#64748b", fontSize: 13, lineHeight: 20, marginBottom: 20 },
  warningBtnRow: { flexDirection: "row", gap: 12 },
  warningCancelBtn: {
    flex: 1, backgroundColor: "rgba(240,165,0,0.15)",
    borderWidth: 1, borderColor: "#f0a500",
    borderRadius: 12, paddingVertical: 14, alignItems: "center",
  },
  warningCancelText: { color: "#f0a500", fontSize: 14, fontWeight: "700" },
  warningOkBtn: {
    flex: 1, backgroundColor: "#f0a500",
    borderRadius: 12, paddingVertical: 14, alignItems: "center",
  },
  warningOkText: { color: "#0f0f1e", fontSize: 14, fontWeight: "800" },
});
