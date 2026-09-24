import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  FlatList, Modal, Alert, RefreshControl, Animated, PanResponder,
  Share, Linking, ListRenderItem, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import * as Haptics from 'expo-haptics';

import {
  getAllTickets, deleteTicket, updateTicket, formatDateTime, checkDuplicate,
  getMillPaymentSettings, setMillPaymentSettings, clearMillPaymentSettings,
} from '../../utils/storage';
import { exportBackupToFile, importBackupFromFile } from '../../utils/backup';
import { formatDateInput, isValidDate, sanitizeFilterDate, compareDDMMYYYY, todayFormatted, yesterdayFormatted } from '../../utils/dateHelpers';
import { useMicPulse } from '../../hooks/useMicPulse';
import { Ticket, MillPaymentSettings } from '../../types';
import SeasonSelector from '../../components/SeasonSelector';
import { useSeason } from '../../context/SeasonContext';

// ─── Component ───────────────────────────────────────────────────────────────

export default function DashboardScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { selectedSeason } = useSeason();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filtered, setFiltered] = useState<Ticket[]>([]);
  const [searchText, setSearchText] = useState('');
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [uniqueNames, setUniqueNames] = useState<string[]>([]);
  const [showNamesModal, setShowNamesModal] = useState(false);
  const [filterDate, setFilterDate] = useState('');
  const [showDateInput, setShowDateInput] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isSearchListening, setIsSearchListening] = useState(false);
  const [selectedOwners, setSelectedOwners] = useState<string[]>([]);
  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const [uniqueOwners, setUniqueOwners] = useState<string[]>([]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalQty = filtered.reduce((sum, t) => sum + (parseFloat(String(t.quantity)) || 0), 0);
  const hasFilters = searchText || selectedNames.length > 0 || selectedOwners.length > 0 || filterDate;
  const [pricePerQty, setPricePerQty] = useState<string>('');
  const priceNum = parseFloat(pricePerQty);

  // ── Mill Payment Settings ─────────────────────────────────────────────────
  const [millSettings, setMillSettings] = useState<MillPaymentSettings | null>(null);
  const [showMillModal, setShowMillModal] = useState(false);
  const [millDateInput, setMillDateInput] = useState('');
  const [millDateError, setMillDateError] = useState('');

  // ── Payment calculations (based on FILTERED tickets, not all) ────────────
  const paidQty = millSettings?.paidUntilDate
    ? filtered.filter(t => compareDDMMYYYY(t.date, millSettings.paidUntilDate) <= 0)
        .reduce((s, t) => s + (parseFloat(String(t.quantity)) || 0), 0)
    : 0;
  const pendingQty = totalQty - paidQty;
  const totalAmount = pricePerQty && !isNaN(priceNum) ? (totalQty * priceNum) : null;
  const paidAmount = millSettings?.paidUntilDate && pricePerQty && !isNaN(priceNum)
    ? paidQty * priceNum : null;
  const pendingAmount = totalAmount !== null && paidAmount !== null
    ? totalAmount - paidAmount : null;

  // ── Backup/Restore state ──────────────────────────────────────────────────
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupStatus, setBackupStatus] = useState('');

  // ── Edit modal ────────────────────────────────────────────────────────────
  const [editTicket, setEditTicket] = useState<Ticket | null>(null);
  const [editForm, setEditForm] = useState({
    farmer_code: '', name: '', fatherName: '', caneOwner: '', date: '', quantity: '', comment: '',
  });

  const mic = useMicPulse();

  // ── STT ────────────────────────────────────────────────────────────────────
  useSpeechRecognitionEvent('start', () => { if (!isFocused) return; setIsSearchListening(true); });
  useSpeechRecognitionEvent('end', () => { if (!isFocused) return; setIsSearchListening(false); mic.stop(); });
  useSpeechRecognitionEvent('result', (event) => {
    if (!isFocused) return;
    const result = event.results[0]?.transcript ?? '';
    if (result) handleSearch(result);
  });
  useSpeechRecognitionEvent('error', () => { if (!isFocused) return; setIsSearchListening(false); mic.stop(); });

  const startSearchListening = async (): Promise<void> => {
    try {
      const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('माइक अनुमति नहीं', 'माइक की अनुमति देने के लिए सेटिंग में जाएं।');
        return;
      }
      ExpoSpeechRecognitionModule.start({ lang: 'hi-IN', interimResults: true });
      mic.start();
    } catch (e) { console.error('Search STT error:', e); }
  };

  const stopSearchListening = (): void => {
    ExpoSpeechRecognitionModule.stop();
    setIsSearchListening(false);
    mic.stop();
  };

  const searchMicResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => startSearchListening(),
    onPanResponderRelease: () => stopSearchListening(),
    onPanResponderTerminate: () => stopSearchListening(),
  });

  // ── Data load ─────────────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      loadData();
      loadMillSettings();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedSeason])
  );

  const loadData = async (
    overrideOwners?: string[],
    overrideSearch?: string,
    overrideNames?: string[],
    overrideDate?: string,
  ) => {
    const allData = await getAllTickets();
    const ownersToUse = overrideOwners ?? selectedOwners;
    const searchToUse = overrideSearch ?? searchText;
    const namesToUse = overrideNames ?? selectedNames;
    const dateToUse = overrideDate ?? filterDate;

    setUniqueOwners([...new Set(allData.map(t => t.caneOwner).filter(Boolean))].sort());
    setTickets(allData);
    setUniqueNames([...new Set(allData.map(t => t.name))].sort());
    applyFilters(allData, searchToUse, namesToUse, dateToUse, ownersToUse);
  };

  const loadMillSettings = async () => {
    const s = await getMillPaymentSettings(selectedSeason);
    setMillSettings(s);
  };

  const applyFilters = (
    data: Ticket[],
    search: string,
    names: string[],
    date: string,
    owners: string[],
  ) => {
    let result = [...data];
    if (owners.length > 0) result = result.filter(t => owners.includes(t.caneOwner));
    if (names.length > 0) result = result.filter(t => names.includes(t.name));
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(t =>
        t.name?.toLowerCase().includes(q) ||
        t.fatherName?.toLowerCase().includes(q) ||
        t.farmer_code?.toLowerCase().includes(q)
      );
    }
    if (date.trim()) result = result.filter(t => t.date?.includes(date.trim()));
    result.sort((a, b) => {
      const parseDate = (d: string) => {
        if (!d) return 0;
        const [dd, mm, yyyy] = d.split('/');
        return new Date(`${yyyy}-${mm}-${dd}`).getTime();
      };
      return parseDate(b.date) - parseDate(a.date);
    });
    setFiltered(result);
  };

  const handleSearch = (text: string) => {
    setSearchText(text);
    applyFilters(tickets, text, selectedNames, filterDate, selectedOwners);
  };

  const handleSelectOwner = (owner: string | null) => {
    if (owner === null) {
      setSelectedOwners([]);
      setShowOwnerModal(false);
      applyFilters(tickets, searchText, selectedNames, filterDate, []);
      return;
    }
    const newOwners = selectedOwners.includes(owner)
      ? selectedOwners.filter(o => o !== owner)
      : [...selectedOwners, owner];
    setSelectedOwners(newOwners);
    applyFilters(tickets, searchText, selectedNames, filterDate, newOwners);
  };

  const handleSelectName = (name: string | null) => {
    if (name === null) {
      setSelectedNames([]);
      setShowNamesModal(false);
      applyFilters(tickets, searchText, [], filterDate, selectedOwners);
      return;
    }
    const newNames = selectedNames.includes(name)
      ? selectedNames.filter(n => n !== name)
      : [...selectedNames, name];
    setSelectedNames(newNames);
    applyFilters(tickets, searchText, newNames, filterDate, selectedOwners);
  };

  const handleDateFilter = (text: string) => {
    const sanitized = sanitizeFilterDate(text);
    setFilterDate(sanitized);
    applyFilters(tickets, searchText, selectedNames, sanitized, selectedOwners);
  };

  const clearFilters = () => {
    setSearchText('');
    setSelectedNames([]);
    setFilterDate('');
    setSelectedOwners([]);
    setShowDateInput(false);
    setFiltered(tickets);
  };

  // ── Mill Payment ──────────────────────────────────────────────────────────
  const handleSaveMillDate = async () => {
    setMillDateError('');
    if (!millDateInput.trim()) {
      setMillDateError('कृपया तारीख दर्ज करें।');
      return;
    }
    if (!isValidDate(millDateInput)) {
      setMillDateError('गलत तारीख। DD/MM/YYYY format में दर्ज करें।');
      return;
    }
    try {
      await setMillPaymentSettings(selectedSeason, { paidUntilDate: millDateInput });
      setMillSettings({ paidUntilDate: millDateInput });
      setShowMillModal(false);
      setMillDateInput('');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('त्रुटि', 'तारीख सेव नहीं हो सकी। पुनः प्रयास करें।');
    }
  };

  const handleClearMillDate = () => {
    Alert.alert(
      'भुगतान तारीख हटाएं?',
      'मिल भुगतान कट-ऑफ तारीख हटा दी जाएगी।',
      [
        { text: 'रद्द करें', style: 'cancel' },
        {
          text: 'हटाएं', style: 'destructive', onPress: async () => {
            await clearMillPaymentSettings(selectedSeason);
            setMillSettings(null);
          }
        },
      ]
    );
  };

  // ── Backup / Restore ──────────────────────────────────────────────────────
  const handleExport = async () => {
    setBackupLoading(true);
    setBackupStatus('');
    try {
      await exportBackupToFile();
      setBackupStatus('✅ बैकअप तैयार है! "डाउनलोड" या "Drive" में सेव करें।');
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : 'बैकअप निर्यात नहीं हो सका।';
      setBackupStatus('');
      Alert.alert('निर्यात त्रुटि', msg);
    } finally {
      setBackupLoading(false);
    }
  };

  const handleImport = (mode: 'merge' | 'replace') => {
    Alert.alert(
      mode === 'merge' ? 'डेटा जोड़ें (Merge)' : 'डेटा बदलें (Replace)',
      mode === 'replace'
        ? 'सावधान! मौजूदा सभी डेटा हटाकर बैकअप का डेटा लोड होगा।'
        : 'बैकअप का डेटा मौजूदा डेटा में जोड़ा जाएगा (डुप्लीकेट नहीं जुड़ेंगे)।',
      [
        { text: 'रद्द करें', style: 'cancel' },
        {
          text: mode === 'merge' ? 'जोड़ें' : 'बदलें',
          style: mode === 'replace' ? 'destructive' : 'default',
          onPress: async () => {
            setBackupLoading(true);
            setBackupStatus('');
            try {
              const result = await importBackupFromFile(mode);
              if (!result) { setBackupLoading(false); return; } // User cancelled picker
              await loadData();
              setBackupStatus(
                `✅ ${result.addedCount} पर्चियां रीस्टोर हुईं` +
                (result.skippedCount > 0 ? ` (${result.skippedCount} छोड़ी गईं)` : '')
              );
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (e: any) {
              const msg = e instanceof Error ? e.message : 'आयात नहीं हो सका।';
              Alert.alert('आयात त्रुटि', msg);
            } finally {
              setBackupLoading(false);
            }
          },
        },
      ]
    );
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = (id: string, name: string) => {
    Alert.alert(
      'रिकॉर्ड हटाएं',
      `"${name}" का टिकट हटाएं? यह कार्य पूर्ववत नहीं किया जा सकता।`,
      [
        { text: 'रद्द करें', style: 'cancel' },
        {
          text: 'हटाएं', style: 'destructive', onPress: async () => {
            try {
              await deleteTicket(id);
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              loadData();
            } catch {
              Alert.alert('त्रुटि', 'रिकॉर्ड हटाने में समस्या। पुनः प्रयास करें।');
            }
          }
        },
      ]
    );
  };

  // ── Edit ──────────────────────────────────────────────────────────────────
  const openEdit = (ticket: Ticket) => {
    setEditTicket(ticket);
    setEditForm({
      farmer_code: ticket.farmer_code,
      name: ticket.name,
      fatherName: ticket.fatherName,
      caneOwner: ticket.caneOwner,
      date: ticket.date,
      quantity: String(ticket.quantity),
      comment: ticket.comment ?? '',
    });
  };

  const handleEditSave = async () => {
    if (!editTicket) return;
    const { name, fatherName, caneOwner, date, quantity, comment } = editForm;
    // Farmer code is NEVER changeable
    const farmer_code = editTicket.farmer_code;

    if (!name.trim() || !fatherName.trim() || !caneOwner.trim() || !date.trim() || !quantity.trim()) {
      Alert.alert('आवश्यक', 'कृपया सभी आवश्यक फ़ील्ड भरें।'); return;
    }
    if (!isValidDate(date.trim())) {
      Alert.alert('गलत तारीख', 'कृपया DD/MM/YYYY फ़ॉर्मेट में सही तारीख दर्ज करें।'); return;
    }

    // Validate season year for date
    const dateParts = date.trim().split('/');
    const seasonYears = selectedSeason.split('-');
    if (seasonYears[0] !== dateParts[2] && seasonYears[1] !== dateParts[2]) {
      Alert.alert('गलत वर्ष', `"${date.trim()}" वर्तमान सीजन (${selectedSeason}) के लिए मान्य नहीं है।`);
      return;
    }

    const qtyNum = parseFloat(quantity);
    if (isNaN(qtyNum)) { Alert.alert('गलत मात्रा', 'कृपया सही संख्या दर्ज करें।'); return; }
    if (qtyNum <= 0) { Alert.alert('गलत मात्रा', 'मात्रा 0 से अधिक होनी चाहिए।'); return; }

    const dup = await checkDuplicate(name.trim(), date.trim(), editTicket.id);
    if (dup) { Alert.alert('डुप्लीकेट', `"${name.trim()}" का ${date.trim()} को रिकॉर्ड पहले से मौजूद है।`); return; }

    try {
      await updateTicket(editTicket.id, {
        farmer_code, // Always preserved original
        name: name.trim(),
        fatherName: fatherName.trim(),
        caneOwner: caneOwner.trim(),
        date: date.trim(),
        quantity: qtyNum,
        comment: comment.trim(),
      });
      setEditTicket(null);
      await loadData();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('त्रुटि', e instanceof Error ? e.message : 'अपडेट नहीं हो सका।');
    }
  };

  // ── WhatsApp share ────────────────────────────────────────────────────────
  const shareOnWhatsApp = (ticket: Ticket) => {
    const rate = !isNaN(priceNum) && pricePerQty ? `\n💰 अनुमानित राशि (@ ₹${pricePerQty}): ₹${(ticket.quantity * priceNum).toFixed(2)}` : '';
    const msg =
      `🌾 *गन्ना टिकट / Cane Ticket*\n` +
      `🆔 किसान कोड: ${ticket.farmer_code}\n` +
      `👤 नाम: ${ticket.name}\n` +
      `👨 पिता: ${ticket.fatherName}\n` +
      `🌿 गन्ना मालिक: ${ticket.caneOwner}\n` +
      `📅 तारीख: ${ticket.date}\n` +
      `⚖️ मात्रा: ${parseFloat(String(ticket.quantity)).toFixed(2)} क्विंटल` +
      rate +
      (ticket.comment ? `\n📝 टिप्पणी: ${ticket.comment}` : '') +
      `\n\n_${formatDateTime(ticket.createdAt)}_\n_SmartKissan App_`;
    const url = `whatsapp://send?text=${encodeURIComponent(msg)}`;
    Linking.canOpenURL(url).then(supported => {
      if (supported) Linking.openURL(url);
      else Share.share({ message: msg });
    }).catch(() => Share.share({ message: msg }));
  };

  // ── Payment status helper ─────────────────────────────────────────────────
  const getPaymentStatus = (ticket: Ticket): 'paid' | 'pending' | 'unknown' => {
    if (!millSettings?.paidUntilDate) return 'unknown';
    return compareDDMMYYYY(ticket.date, millSettings.paidUntilDate) <= 0 ? 'paid' : 'pending';
  };

  // ── Ticket card ───────────────────────────────────────────────────────────
  const renderTicket: ListRenderItem<Ticket> = ({ item }) => {
    const payStatus = getPaymentStatus(item);
    return (
      <View style={styles.ticketCard}>
        <View style={styles.ticketHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{item.name?.charAt(0).toUpperCase() ?? '?'}</Text>
          </View>
          <View style={styles.ticketInfo}>
            <Text style={styles.ticketName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.ticketFather} numberOfLines={1}>पिता: {item.fatherName}</Text>
            <Text style={styles.ticketCode} numberOfLines={1}>कोड: {item.farmer_code}</Text>
          </View>
          <View style={styles.ticketActions}>
            <TouchableOpacity onPress={() => shareOnWhatsApp(item)} style={styles.actionBtn}>
              <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => openEdit(item)} style={styles.actionBtn}>
              <Ionicons name="pencil-outline" size={17} color="#f0a500" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDelete(item.id, item.name)} style={styles.actionBtn}>
              <Ionicons name="trash-outline" size={17} color="#e74c3c" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.badgeRow}>
          <View style={styles.badgeDate}>
            <Ionicons name="calendar-outline" size={12} color="#f0a500" />
            <Text style={styles.badgeDateText}>{item.date}</Text>
          </View>
          <View style={styles.badgeQty}>
            <Ionicons name="layers-outline" size={12} color="#06b6d4" />
            <Text style={styles.badgeQtyText}>{parseFloat(String(item.quantity)).toFixed(2)} क्विंटल</Text>
          </View>
          {item.caneOwner !== 'मेरा गन्ना' && (
            <View style={styles.badgeOwner}>
              <Ionicons name="leaf-outline" size={10} color="#2ecc71" />
              <Text style={styles.badgeOwnerText} numberOfLines={1}>{item.caneOwner}</Text>
            </View>
          )}
          {/* Payment status badge */}
          {payStatus !== 'unknown' && (
            <View style={[styles.badgePay, payStatus === 'paid' ? styles.badgePayPaid : styles.badgePayPending]}>
              <Ionicons
                name={payStatus === 'paid' ? 'checkmark-circle' : 'time-outline'}
                size={10}
                color={payStatus === 'paid' ? '#2ecc71' : '#f0a500'}
              />
              <Text style={[styles.badgePayText, { color: payStatus === 'paid' ? '#2ecc71' : '#f0a500' }]}>
                {payStatus === 'paid' ? 'भुगतान प्राप्त' : 'बकाया'}
              </Text>
            </View>
          )}
          {item.updatedAt && (
            <View style={styles.badgeEdited}>
              <Ionicons name="pencil" size={10} color="#8b5cf6" />
              <Text style={styles.badgeEditedText}>संपादित</Text>
            </View>
          )}
        </View>

        {!!item.comment && (
          <View style={styles.commentRow}>
            <Ionicons name="chatbubble-outline" size={12} color="#888" />
            <Text style={styles.commentText} numberOfLines={2}>{item.comment}</Text>
          </View>
        )}
        <Text style={styles.ticketTime}>जोड़ा: {formatDateTime(item.createdAt)}</Text>
      </View>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.safe, { paddingTop: insets.top || 20 }]}>
      <View style={styles.container}>
        {/* ── Header ── */}
        <View style={styles.header}>
          {/* Season + Backup buttons row */}
          <View style={styles.seasonTopRow}>
            <View style={styles.seasonRow}>
              <Text style={styles.seasonRowLabel}>सीजन:</Text>
              <SeasonSelector />
            </View>
            <TouchableOpacity style={styles.backupBtn} onPress={() => setShowBackupModal(true)}>
              <Ionicons name="cloud-upload-outline" size={15} color="#8b5cf6" />
              <Text style={styles.backupBtnText}>बैकअप</Text>
            </TouchableOpacity>
          </View>

          {/* ── Stats row ── */}
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { borderColor: 'rgba(240,165,0,0.4)' }]}>
              <Text style={[styles.statNum, { color: '#f0a500' }]}>{filtered.length}</Text>
              <Text style={styles.statLabel}>टिकट</Text>
            </View>
            <View style={[styles.statCard, { borderColor: 'rgba(6,182,212,0.4)' }]}>
              <Text style={[styles.statNum, { color: '#06b6d4' }]}>{totalQty.toFixed(1)}</Text>
              <Text style={styles.statLabel}>क्विंटल</Text>
            </View>
            <View style={[styles.statCard, { borderColor: 'rgba(139,92,246,0.4)' }]}>
              <Text style={[styles.statNum, { color: '#8b5cf6' }]}>{uniqueNames.length}</Text>
              <Text style={styles.statLabel}>किसान</Text>
            </View>
          </View>

          {/* ── Rate & Amount ── */}
          <View style={styles.statsRow}>
            <View style={[styles.statCard, styles.priceCard, { borderColor: 'rgba(240,165,0,0.4)' }]}>
              <TextInput
                style={styles.priceInput}
                value={pricePerQty}
                onChangeText={(v) => { if (v === '' || /^\d*\.?\d*$/.test(v)) setPricePerQty(v); }}
                placeholder="₹/क्विं"
                placeholderTextColor="#555"
                keyboardType="numeric"
              />
              <Text style={styles.statLabel}>दर / Rate</Text>
            </View>
            {totalAmount !== null && (
              <View style={styles.totalAmountCard}>
                <View style={styles.totalAmountLeft}>
                  <Text style={styles.totalAmountLabel}>कुल राशि / Total</Text>
                  <Text style={styles.totalAmountSub}>{totalQty.toFixed(2)} क्विं × ₹{pricePerQty}</Text>
                </View>
                <Text style={styles.totalAmountValue}>₹{totalAmount.toFixed(0)}</Text>
              </View>
            )}
          </View>

          {/* ── Payment Tracker ── */}
          <View style={styles.paymentCard}>
            <View style={styles.paymentHeader}>
              <Ionicons name="cash-outline" size={14} color="#2ecc71" />
              <Text style={styles.paymentTitle}>मिल भुगतान ट्रैकर</Text>
              <View style={{ flex: 1 }} />
              {millSettings ? (
                <TouchableOpacity
                  style={styles.millEditBtn}
                  onPress={() => { setMillDateInput(millSettings.paidUntilDate); setShowMillModal(true); }}
                >
                  <Ionicons name="pencil-outline" size={13} color="#f0a500" />
                </TouchableOpacity>
              ) : null}
            </View>

            {millSettings?.paidUntilDate ? (
              <View>
                <Text style={styles.millDateLabel}>
                  भुगतान प्राप्त (Paid up to): <Text style={styles.millDateValue}>{millSettings.paidUntilDate}</Text>
                </Text>
                <View style={styles.paymentBreakdown}>
                  <View style={styles.payBreakItem}>
                    <Text style={styles.payBreakLabel}>कुल</Text>
                    <Text style={[styles.payBreakValue, { color: '#06b6d4' }]}>
                      {totalAmount !== null ? `₹${totalAmount.toFixed(0)}` : `${totalQty.toFixed(1)} क्विं`}
                    </Text>
                    {totalAmount !== null && (
                      <Text style={styles.payBreakSub}>{totalQty.toFixed(1)} क्विं</Text>
                    )}
                  </View>
                  <View style={styles.payBreakDivider} />
                  <View style={styles.payBreakItem}>
                    <Text style={styles.payBreakLabel}>प्राप्त भुगतान</Text>
                    <Text style={[styles.payBreakValue, { color: '#2ecc71' }]}>
                      {paidAmount !== null ? `₹${paidAmount.toFixed(0)}` : `${paidQty.toFixed(1)} क्विं`}
                    </Text>
                    {paidAmount !== null && (
                      <Text style={styles.payBreakSub}>{paidQty.toFixed(1)} क्विं</Text>
                    )}
                  </View>
                  <View style={styles.payBreakDivider} />
                  <View style={styles.payBreakItem}>
                    <Text style={styles.payBreakLabel}>कुल बकाया</Text>
                    <Text style={[styles.payBreakValue, { color: '#f0a500' }]}>
                      {pendingAmount !== null ? `₹${pendingAmount.toFixed(0)}` : `${pendingQty.toFixed(1)} क्विं`}
                    </Text>
                    {pendingAmount !== null && (
                      <Text style={styles.payBreakSub}>{pendingQty.toFixed(1)} क्विं</Text>
                    )}
                  </View>
                </View>
                {totalAmount === null && (
                  <Text style={styles.millHint}>ऊपर ₹/क्विंटल दर डालें — कुल व बकाया राशि दिखेगी।</Text>
                )}
                <TouchableOpacity style={styles.clearMillBtn} onPress={handleClearMillDate}>
                  <Ionicons name="close-circle-outline" size={13} color="#e74c3c" />
                  <Text style={styles.clearMillBtnText}>तारीख हटाएं</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.setMillDateBtn}
                onPress={() => { setMillDateInput(todayFormatted()); setShowMillModal(true); }}
              >
                <Ionicons name="calendar-outline" size={14} color="#2ecc71" />
                <Text style={styles.setMillDateBtnText}>भुगतान तारीख सेट करें</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Search ── */}
          <View style={[styles.searchBox, isSearchListening && styles.searchBoxListening]}>
            <Ionicons name="search" size={16} color={isSearchListening ? '#e74c3c' : '#888'} />
            <TextInput
              style={styles.searchInput}
              value={searchText}
              onChangeText={handleSearch}
              placeholder={isSearchListening ? 'सुन रहा है...' : 'नाम / किसान कोड खोजें...'}
              placeholderTextColor={isSearchListening ? '#e74c3c' : '#555'}
              autoCorrect={false}
            />
            {searchText ? (
              <TouchableOpacity onPress={() => handleSearch('')}>
                <Ionicons name="close-circle" size={16} color="#888" />
              </TouchableOpacity>
            ) : null}
            <Animated.View style={{ transform: [{ scale: mic.anim }] }}>
              <View {...searchMicResponder.panHandlers}
                style={[styles.searchMicBtn, isSearchListening && styles.searchMicBtnActive]}>
                <Ionicons name={isSearchListening ? 'mic' : 'mic-outline'} size={16}
                  color={isSearchListening ? '#fff' : '#f0a500'} />
              </View>
            </Animated.View>
          </View>
          <Text style={styles.holdHint}>📌 माइक दबाकर रखें — बोलकर खोजें</Text>

          {/* ── Filters ── */}
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterChip, selectedOwners.length > 0 && styles.filterChipOn]}
              onPress={() => setShowOwnerModal(true)}
            >
              <Ionicons name="leaf-outline" size={13} color={selectedOwners.length > 0 ? '#2ecc71' : '#888'} />
              <Text style={[styles.filterChipText, selectedOwners.length > 0 && { color: '#2ecc71' }]} numberOfLines={1}>
                {selectedOwners.length === 0 ? 'मालिक' : selectedOwners.length === 1 ? selectedOwners[0] : `${selectedOwners.length} मालिक`}
              </Text>
              <Ionicons name="chevron-down" size={12} color={selectedOwners.length > 0 ? '#2ecc71' : '#888'} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.filterChip, selectedNames.length > 0 && styles.filterChipOn]}
              onPress={() => setShowNamesModal(true)}
            >
              <Ionicons name="person-outline" size={13} color={selectedNames.length > 0 ? '#f0a500' : '#888'} />
              <Text style={[styles.filterChipText, selectedNames.length > 0 && { color: '#f0a500' }]} numberOfLines={1}>
                {selectedNames.length === 0 ? 'नाम चुनें' : selectedNames.length === 1 ? selectedNames[0] : `${selectedNames.length} नाम`}
              </Text>
              <Ionicons name="chevron-down" size={12} color={selectedNames.length > 0 ? '#f0a500' : '#888'} />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.filterChip, filterDate && styles.filterChipOn]}
              onPress={() => setShowDateInput(!showDateInput)}>
              <Ionicons name="calendar-outline" size={13} color={filterDate ? '#f0a500' : '#888'} />
              <Text style={[styles.filterChipText, filterDate && { color: '#f0a500' }]}>{filterDate || 'तारीख'}</Text>
            </TouchableOpacity>

            {hasFilters ? (
              <TouchableOpacity style={styles.clearChip} onPress={clearFilters}>
                <Ionicons name="close" size={13} color="#e74c3c" />
                <Text style={styles.clearChipText}>साफ़ करें</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {showDateInput && (
            <View style={styles.dateInputRow}>
              <Ionicons name="calendar" size={15} color="#f0a500" />
              <TextInput
                style={styles.dateInput}
                value={filterDate}
                onChangeText={handleDateFilter}
                placeholder="जैसे: 2024 या 03/2024 या 15"
                placeholderTextColor="#555"
                keyboardType="default"
                autoFocus
              />
              {filterDate ? (
                <TouchableOpacity onPress={() => { handleDateFilter(''); setShowDateInput(false); }}>
                  <Ionicons name="close-circle" size={16} color="#888" />
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          {selectedNames.length > 0 && (
            <View style={styles.activeTag}>
              <Text style={styles.activeTagText}>
                दिखा रहे:{' '}
                {selectedNames.map((name, index) => (
                  <Text key={index} style={{ color: '#f0a500', fontWeight: '700' }}>
                    {name}{index !== selectedNames.length - 1 ? ', ' : ''}
                  </Text>
                ))}
              </Text>
            </View>
          )}

          <Text style={styles.resultsLabel}>{filtered.length} रिकॉर्ड</Text>
        </View>

        {/* ── Ticket List ── */}
        <FlatList<Ticket>
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={renderTicket}
          refreshControl={<RefreshControl refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await loadData(); setRefreshing(false); }}
            tintColor="#f0a500" colors={['#f0a500']} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="document-outline" size={55} color="#2d2d4e" />
              <Text style={styles.emptyTitle}>कोई रिकॉर्ड नहीं</Text>
              <Text style={styles.emptySubtitle}>
                {hasFilters ? 'अलग फ़िल्टर आज़माएं' : 'माइक टैब से पहला टिकट जोड़ें'}
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />
      </View>

      {/* ══ Mill Payment Date Modal ══ */}
      <Modal visible={showMillModal} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.millModalCard}>
            <View style={styles.millModalHeader}>
              <Ionicons name="cash-outline" size={28} color="#2ecc71" />
              <Text style={styles.millModalTitle}>मिल भुगतान तारीख</Text>
            </View>
            <Text style={styles.millModalDesc}>
              मिल ने किस तारीख तक का भुगतान किया है? इससे पहले की सभी पर्चियां &quot;भुगतान प्राप्त&quot; मानी जाएंगी।
            </Text>
            <TextInput
              style={[styles.millDateInput, millDateError ? { borderColor: '#e74c3c' } : {}]}
              value={millDateInput}
              onChangeText={(v) => {
                setMillDateError('');
                if (v.length < millDateInput.length) {
                  setMillDateInput(v.endsWith('/') ? v.slice(0, -1) : v);
                } else {
                  setMillDateInput(formatDateInput(v));
                }
              }}
              placeholder="DD/MM/YYYY"
              placeholderTextColor="#555"
              keyboardType="numeric"
              maxLength={10}
            />
            {!!millDateError && <Text style={styles.millDateError}>{millDateError}</Text>}
            <Text style={styles.millDateHint}>उदाहरण: {todayFormatted()}</Text>
            <View style={styles.millModalBtns}>
              <TouchableOpacity
                style={[styles.millModalBtn, { backgroundColor: '#2d2d4e' }]}
                onPress={() => { setShowMillModal(false); setMillDateError(''); }}
              >
                <Text style={styles.millModalBtnText}>रद्द करें</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.millModalBtn, { backgroundColor: '#2ecc71' }]}
                onPress={handleSaveMillDate}
              >
                <Text style={[styles.millModalBtnText, { color: '#1a1a2e' }]}>✓ सेव करें</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ══ Backup/Restore Modal ══ */}
      <Modal visible={showBackupModal} transparent animationType="slide">
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => { if (!backupLoading) setShowBackupModal(false); }}>
          <View style={styles.backupSheet}>
            <View style={styles.namesHeader}>
              <Text style={styles.namesTitle}>☁️ बैकअप और रीस्टोर</Text>
              <TouchableOpacity onPress={() => { if (!backupLoading) setShowBackupModal(false); }}>
                <Ionicons name="close" size={22} color="#888" />
              </TouchableOpacity>
            </View>

            <Text style={styles.backupDesc}>
              📁 <Text style={{ fontWeight: '700', color: '#f0f0f0' }}>फ़ाइल कहाँ सेव होगी?{'\n'}</Text>
              निर्यात के बाद Share Sheet खुलेगी। &quot;Save to Downloads&quot; चुनें — फ़ाइल डिवाइस के Downloads/ फ़ोल्डर में सेव होगी और किसी भी File Manager से खोली जा सकती है।
            </Text>

            {!!backupStatus && (
              <View style={styles.backupStatusRow}>
                <Text style={styles.backupStatusText}>{backupStatus}</Text>
              </View>
            )}

            {backupLoading && (
              <View style={styles.backupLoadingRow}>
                <ActivityIndicator color="#f0a500" size="small" />
                <Text style={styles.backupLoadingText}>प्रतीक्षा करें...</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.backupActionBtn, { backgroundColor: 'rgba(139,92,246,0.15)', borderColor: 'rgba(139,92,246,0.5)' }]}
              onPress={handleExport}
              disabled={backupLoading}
              activeOpacity={0.8}
            >
              <Ionicons name="cloud-upload-outline" size={20} color="#8b5cf6" />
              <View>
                <Text style={[styles.backupActionTitle, { color: '#8b5cf6' }]}>डेटा निर्यात करें (Export)</Text>
                <Text style={styles.backupActionDesc}>सभी पर्चियां JSON फ़ाइल में सेव करें</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.backupActionBtn, { backgroundColor: 'rgba(46,204,113,0.1)', borderColor: 'rgba(46,204,113,0.4)' }]}
              onPress={() => handleImport('merge')}
              disabled={backupLoading}
              activeOpacity={0.8}
            >
              <Ionicons name="git-merge-outline" size={20} color="#2ecc71" />
              <View>
                <Text style={[styles.backupActionTitle, { color: '#2ecc71' }]}>डेटा जोड़ें (Merge Import)</Text>
                <Text style={styles.backupActionDesc}>बैकअप + मौजूदा डेटा — डुप्लीकेट नहीं</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.backupActionBtn, { backgroundColor: 'rgba(231,76,60,0.08)', borderColor: 'rgba(231,76,60,0.4)' }]}
              onPress={() => handleImport('replace')}
              disabled={backupLoading}
              activeOpacity={0.8}
            >
              <Ionicons name="refresh-circle-outline" size={20} color="#e74c3c" />
              <View>
                <Text style={[styles.backupActionTitle, { color: '#e74c3c' }]}>⚠ डेटा बदलें (Replace)</Text>
                <Text style={styles.backupActionDesc}>सावधान: मौजूदा डेटा हट जाएगा</Text>
              </View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ══ Names Modal ══ */}
      <Modal visible={showNamesModal} transparent animationType="slide">
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowNamesModal(false)}>
          <View style={styles.namesSheet}>
            <View style={styles.namesHeader}>
              <Text style={styles.namesTitle}>👤 नाम चुनें</Text>
              <TouchableOpacity onPress={() => setShowNamesModal(false)}>
                <Ionicons name="close" size={22} color="#888" />
              </TouchableOpacity>
            </View>
            <ScrollView>
              <TouchableOpacity
                style={[styles.nameItem, selectedNames.length === 0 && styles.nameItemOn]}
                onPress={() => handleSelectName(null)}
              >
                <Text style={[styles.nameItemText, selectedNames.length === 0 && { color: '#f0a500' }]}>सभी नाम</Text>
                {selectedNames.length === 0 && <Ionicons name="checkmark" size={16} color="#f0a500" />}
              </TouchableOpacity>
              {uniqueNames.map(name => {
                const count = tickets.filter(t => t.name === name).length;
                const qty = tickets.filter(t => t.name === name).reduce((s, t) => s + (parseFloat(String(t.quantity)) || 0), 0);
                return (
                  <TouchableOpacity key={name} style={[styles.nameItem, selectedNames.includes(name) && styles.nameItemOn]} onPress={() => handleSelectName(name)}>
                    <View style={styles.nameAvatar}><Text style={[styles.nameAvatarText, selectedNames.includes(name) && { color: '#f0a500' }]}>{name.charAt(0).toUpperCase()}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.nameItemText, selectedNames.includes(name) && { color: '#f0a500' }]}>{name}</Text>
                      <Text style={styles.nameItemSub}>{count} टिकट · {qty.toFixed(2)} क्विंटल</Text>
                    </View>
                    <View style={[styles.checkbox, selectedNames.includes(name) && styles.checkboxOn]}>
                      {selectedNames.includes(name) && <Ionicons name="checkmark" size={12} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ══ Owner Modal ══ */}
      <Modal visible={showOwnerModal} transparent animationType="slide">
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowOwnerModal(false)}>
          <View style={styles.namesSheet}>
            <View style={styles.namesHeader}>
              <Text style={styles.namesTitle}>🌾 मालिक चुनें</Text>
              <TouchableOpacity onPress={() => setShowOwnerModal(false)}>
                <Ionicons name="close" size={22} color="#888" />
              </TouchableOpacity>
            </View>
            <ScrollView>
              <TouchableOpacity style={[styles.nameItem, selectedOwners.length === 0 && styles.nameItemOn]} onPress={() => handleSelectOwner(null)}>
                <Text style={[styles.nameItemText, selectedOwners.length === 0 && { color: '#2ecc71' }]}>सभी मालिक</Text>
                {selectedOwners.length === 0 && <Ionicons name="checkmark" size={16} color="#2ecc71" />}
              </TouchableOpacity>
              {uniqueOwners.map(owner => {
                const count = tickets.filter(t => t.caneOwner === owner).length;
                const qty = tickets.filter(t => t.caneOwner === owner).reduce((s, t) => s + (parseFloat(String(t.quantity)) || 0), 0);
                const isSelected = selectedOwners.includes(owner);
                return (
                  <TouchableOpacity key={owner} style={[styles.nameItem, isSelected && styles.nameItemOn]} onPress={() => handleSelectOwner(owner)}>
                    <View style={[styles.nameAvatar, { backgroundColor: 'rgba(46,204,113,0.1)' }]}>
                      <Text style={[styles.nameAvatarText, isSelected && { color: '#2ecc71' }]}>{owner.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.nameItemText, isSelected && { color: '#2ecc71' }]}>{owner}</Text>
                      <Text style={styles.nameItemSub}>{count} टिकट · {qty.toFixed(2)} क्विंटल</Text>
                    </View>
                    <View style={[styles.checkbox, isSelected && { backgroundColor: '#2ecc71', borderColor: '#2ecc71' }]}>
                      {isSelected && <Ionicons name="checkmark" size={12} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={[styles.doneBtn, { backgroundColor: '#2ecc71' }]} onPress={() => setShowOwnerModal(false)}>
              <Text style={styles.doneBtnText}>{selectedOwners.length > 0 ? `✓ ${selectedOwners.length} मालिक चुने` : 'बंद करें'}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ══ Edit Modal ══ */}
      <Modal visible={!!editTicket} transparent animationType="slide">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.editOverlay}>
            <View style={styles.editSheet}>
              <View style={styles.namesHeader}>
                <Text style={styles.namesTitle}>✏️ रिकॉर्ड संपादित करें</Text>
                <TouchableOpacity onPress={() => setEditTicket(null)}>
                  <Ionicons name="close" size={22} color="#888" />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {/* Farmer Code - LOCKED / NEVER CHANGEABLE */}
                <View style={styles.editField}>
                  <View style={styles.editLabelRow}>
                    <Text style={styles.editLabel}>किसान कोड / Farmer Code</Text>
                    <View style={styles.lockedBadge}>
                      <Ionicons name="lock-closed" size={11} color="#f0a500" />
                      <Text style={styles.lockedBadgeText}>परिवर्तनीय नहीं</Text>
                    </View>
                  </View>
                  <TextInput
                    style={[styles.editInput, styles.editInputDisabled]}
                    value={editForm.farmer_code}
                    editable={false}
                    placeholderTextColor="#555"
                  />
                </View>

                {/* Farmer Name */}
                <View style={styles.editField}>
                  <Text style={styles.editLabel}>नाम / Name</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editForm.name}
                    onChangeText={val => setEditForm(prev => ({ ...prev, name: val }))}
                    placeholder="किसान का नाम"
                    placeholderTextColor="#555"
                    autoCorrect={false}
                  />
                </View>

                {/* Father Name */}
                <View style={styles.editField}>
                  <Text style={styles.editLabel}>पिता का नाम / Father Name</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editForm.fatherName}
                    onChangeText={val => setEditForm(prev => ({ ...prev, fatherName: val }))}
                    placeholder="पिता का नाम"
                    placeholderTextColor="#555"
                    autoCorrect={false}
                  />
                </View>

                {/* Cane Owner */}
                <View style={styles.editField}>
                  <View style={styles.editLabelRow}>
                    <Text style={styles.editLabel}>गन्ना मालिक / Cane Owner</Text>
                    <TouchableOpacity
                      style={[
                        styles.quickOwnerChip,
                        editForm.caneOwner === 'मेरा गन्ना' && styles.quickOwnerChipActive,
                      ]}
                      onPress={() => setEditForm(prev => ({ ...prev, caneOwner: 'मेरा गन्ना' }))}
                    >
                      <Text
                        style={[
                          styles.quickOwnerChipText,
                          editForm.caneOwner === 'मेरा गन्ना' && styles.quickOwnerChipActiveText,
                        ]}
                      >
                        🌿 मेरा गन्ना
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={styles.editInput}
                    value={editForm.caneOwner}
                    onChangeText={val => setEditForm(prev => ({ ...prev, caneOwner: val }))}
                    placeholder="मालिक का नाम या मेरा गन्ना"
                    placeholderTextColor="#555"
                    autoCorrect={false}
                  />
                </View>

                {/* Date */}
                <View style={styles.editField}>
                  <View style={styles.editLabelRow}>
                    <Text style={styles.editLabel}>तारीख / Date (DD/MM/YYYY)</Text>
                    <View style={styles.editDateShortcuts}>
                      <TouchableOpacity
                        style={styles.quickDateChip}
                        onPress={() => setEditForm(prev => ({ ...prev, date: todayFormatted() }))}
                      >
                        <Text style={styles.quickDateChipText}>आज</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.quickDateChip}
                        onPress={() => setEditForm(prev => ({ ...prev, date: yesterdayFormatted() }))}
                      >
                        <Text style={styles.quickDateChipText}>कल</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <TextInput
                    style={styles.editInput}
                    value={editForm.date}
                    onChangeText={val => {
                      if (val.length < editForm.date.length) {
                        setEditForm(prev => ({ ...prev, date: val.endsWith('/') ? val.slice(0, -1) : val }));
                      } else {
                        setEditForm(prev => ({ ...prev, date: formatDateInput(val) }));
                      }
                    }}
                    keyboardType="numeric"
                    maxLength={10}
                    placeholder="DD/MM/YYYY"
                    placeholderTextColor="#555"
                  />
                </View>

                {/* Quantity */}
                <View style={styles.editField}>
                  <Text style={styles.editLabel}>मात्रा / Quantity (क्विंटल)</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editForm.quantity}
                    onChangeText={val => setEditForm(prev => ({ ...prev, quantity: val.replace(/[^0-9.]/g, '') }))}
                    keyboardType="numeric"
                    placeholder="जैसे: 12.5"
                    placeholderTextColor="#555"
                  />
                </View>

                {/* Comment */}
                <View style={styles.editField}>
                  <Text style={styles.editLabel}>टिप्पणी / Comment (वैकल्पिक)</Text>
                  <TextInput
                    style={[styles.editInput, { height: 75, textAlignVertical: 'top' }]}
                    value={editForm.comment}
                    onChangeText={val => setEditForm(prev => ({ ...prev, comment: val }))}
                    multiline
                    placeholder="कोई नोट..."
                    placeholderTextColor="#555"
                  />
                </View>
              </ScrollView>
              <View style={styles.editBtns}>
                <TouchableOpacity style={[styles.editBtn, { backgroundColor: '#2d2d4e' }]} onPress={() => setEditTicket(null)}>
                  <Text style={styles.editBtnText}>रद्द करें</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.editBtn, { backgroundColor: '#f0a500' }]} onPress={handleEditSave}>
                  <Text style={[styles.editBtnText, { color: '#1a1a2e' }]}>सहेजें ✓</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f1e' },
  container: { flex: 1 },
  header: { padding: 14, paddingBottom: 0 },
  listContent: { padding: 14, paddingBottom: 5 },

  seasonTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  seasonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seasonRowLabel: { color: '#666', fontSize: 12, fontWeight: '600' },

  backupBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(139,92,246,0.12)', borderRadius: 18,
    paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(139,92,246,0.4)',
  },
  backupBtnText: { color: '#8b5cf6', fontSize: 12, fontWeight: '700' },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  statCard: { flex: 1, backgroundColor: '#1a1a2e', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1 },
  statNum: { fontSize: 20, fontWeight: '900' },
  statLabel: { color: '#666', fontSize: 9, fontWeight: '600', marginTop: 2 },
  priceCard: { justifyContent: 'center', alignItems: 'center' },
  priceInput: { color: '#f0a500', fontSize: 18, fontWeight: '900', textAlign: 'center', width: '100%', paddingVertical: 2 },
  totalAmountCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(240,165,0,0.08)', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: 'rgba(240,165,0,0.3)', flex: 2,
  },
  totalAmountLeft: { flex: 1 },
  totalAmountLabel: { color: '#f0a500', fontSize: 12, fontWeight: '700' },
  totalAmountSub: { color: '#666', fontSize: 10, marginTop: 2 },
  totalAmountValue: { color: '#f0a500', fontSize: 20, fontWeight: '900' },

  // Payment Tracker
  paymentCard: {
    backgroundColor: '#1a1a2e', borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: 'rgba(46,204,113,0.3)', marginBottom: 10,
  },
  paymentHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  paymentTitle: { color: '#f0f0f0', fontSize: 13, fontWeight: '700' },
  millEditBtn: { padding: 4 },
  millDateLabel: { color: '#888', fontSize: 11, marginBottom: 6 },
  millDateValue: { color: '#2ecc71', fontWeight: '800' },
  paymentBreakdown: { flexDirection: 'row', gap: 4, marginBottom: 8 },
  payBreakItem: { flex: 1, backgroundColor: '#0f0f1e', borderRadius: 8, padding: 8, alignItems: 'center' },
  payBreakDivider: { width: 1, backgroundColor: '#2d2d4e' },
  payBreakLabel: { color: '#666', fontSize: 9, fontWeight: '600', marginBottom: 3 },
  payBreakValue: { fontSize: 14, fontWeight: '900' },
  payBreakSub: { color: '#888', fontSize: 10, marginTop: 2 },
  millHint: { color: '#555', fontSize: 10, fontStyle: 'italic', marginBottom: 6 },
  clearMillBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  clearMillBtnText: { color: '#e74c3c', fontSize: 11 },
  setMillDateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  setMillDateBtnText: { color: '#2ecc71', fontSize: 13, fontWeight: '700' },

  // Search
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1a1a2e', borderRadius: 10, padding: 11, borderWidth: 1, borderColor: '#2d2d4e', marginBottom: 4 },
  searchBoxListening: { borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.05)' },
  searchInput: { flex: 1, color: '#f0f0f0', fontSize: 14 },
  searchMicBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#0f0f1e', borderWidth: 1, borderColor: 'rgba(240,165,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  searchMicBtnActive: { backgroundColor: '#e74c3c', borderColor: '#e74c3c' },
  holdHint: { color: '#444', fontSize: 10, marginBottom: 8 },

  filterRow: { flexDirection: 'row', gap: 7, marginBottom: 8, flexWrap: 'wrap' },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1a1a2e', borderRadius: 18, paddingVertical: 7, paddingHorizontal: 11, borderWidth: 1, borderColor: '#2d2d4e', maxWidth: 160 },
  filterChipOn: { borderColor: 'rgba(240,165,0,0.5)', backgroundColor: 'rgba(240,165,0,0.08)' },
  filterChipText: { color: '#888', fontSize: 11, fontWeight: '600', flexShrink: 1 },
  clearChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(231,76,60,0.1)', borderRadius: 18, paddingVertical: 7, paddingHorizontal: 11, borderWidth: 1, borderColor: 'rgba(231,76,60,0.4)' },
  clearChipText: { color: '#e74c3c', fontSize: 11, fontWeight: '600' },
  dateInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1a1a2e', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: 'rgba(240,165,0,0.4)', marginBottom: 8 },
  dateInput: { flex: 1, color: '#f0f0f0', fontSize: 13 },
  activeTag: { backgroundColor: 'rgba(240,165,0,0.08)', borderRadius: 8, padding: 8, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(240,165,0,0.2)' },
  activeTagText: { color: '#888', fontSize: 11 },
  resultsLabel: { color: '#666', fontSize: 11, fontWeight: '600', marginBottom: 10 },

  // Ticket cards
  ticketCard: { backgroundColor: '#1a1a2e', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#2d2d4e' },
  ticketHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(240,165,0,0.15)', borderWidth: 1.5, borderColor: 'rgba(240,165,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#f0a500', fontSize: 16, fontWeight: '800' },
  ticketInfo: { flex: 1 },
  ticketName: { color: '#f0f0f0', fontSize: 15, fontWeight: '700' },
  ticketFather: { color: '#888', fontSize: 11, marginTop: 2 },
  ticketCode: { color: '#555', fontSize: 10, marginTop: 1 },
  ticketActions: { flexDirection: 'row', gap: 4 },
  actionBtn: { padding: 6 },

  badgeRow: { flexDirection: 'row', gap: 7, marginBottom: 8, flexWrap: 'wrap' },
  badgeDate: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(240,165,0,0.1)', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: 'rgba(240,165,0,0.25)' },
  badgeDateText: { color: '#f0a500', fontSize: 11, fontWeight: '700' },
  badgeQty: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(6,182,212,0.1)', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: 'rgba(6,182,212,0.25)' },
  badgeQtyText: { color: '#06b6d4', fontSize: 11, fontWeight: '700' },
  badgeOwner: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(46,204,113,0.1)', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: 'rgba(46,204,113,0.25)', maxWidth: 120 },
  badgeOwnerText: { color: '#2ecc71', fontSize: 10, fontWeight: '700' },
  badgePay: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 7, borderWidth: 1 },
  badgePayPaid: { backgroundColor: 'rgba(46,204,113,0.1)', borderColor: 'rgba(46,204,113,0.3)' },
  badgePayPending: { backgroundColor: 'rgba(240,165,0,0.1)', borderColor: 'rgba(240,165,0,0.3)' },
  badgePayText: { fontSize: 10, fontWeight: '700' },
  badgeEdited: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(139,92,246,0.1)', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: 'rgba(139,92,246,0.25)' },
  badgeEditedText: { color: '#8b5cf6', fontSize: 10, fontWeight: '700' },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 6, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: 7 },
  commentText: { flex: 1, color: '#888', fontSize: 11, lineHeight: 16 },
  ticketTime: { color: '#444', fontSize: 10 },

  emptyState: { alignItems: 'center', paddingVertical: 50 },
  emptyTitle: { color: '#555', fontSize: 16, fontWeight: '700', marginTop: 14 },
  emptySubtitle: { color: '#444', fontSize: 12, textAlign: 'center', marginTop: 6 },

  // Mill payment modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  millModalCard: { backgroundColor: '#1a1a2e', borderRadius: 20, padding: 22, width: '100%', borderWidth: 1, borderColor: '#2d2d4e' },
  millModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  millModalTitle: { color: '#f0f0f0', fontSize: 17, fontWeight: '800' },
  millModalDesc: { color: '#888', fontSize: 12, lineHeight: 18, marginBottom: 14 },
  millDateInput: {
    backgroundColor: '#0f0f1e', borderRadius: 10, padding: 13,
    color: '#f0f0f0', fontSize: 18, fontWeight: '700',
    borderWidth: 1.5, borderColor: '#2d2d4e',
    textAlign: 'center', letterSpacing: 2, marginBottom: 4,
  },
  millDateError: { color: '#e74c3c', fontSize: 12, marginBottom: 4 },
  millDateHint: { color: '#555', fontSize: 10, textAlign: 'center', marginBottom: 16 },
  millModalBtns: { flexDirection: 'row', gap: 10 },
  millModalBtn: { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  millModalBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },

  // Backup modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  backupSheet: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, borderTopWidth: 1, borderColor: '#2d2d4e' },
  backupDesc: { color: '#777', fontSize: 11, lineHeight: 17, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 10 },
  backupStatusRow: { backgroundColor: 'rgba(46,204,113,0.1)', borderRadius: 8, padding: 10, marginBottom: 10 },
  backupStatusText: { color: '#2ecc71', fontSize: 12, fontWeight: '600' },
  backupLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  backupLoadingText: { color: '#f0a500', fontSize: 12 },
  backupActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1,
  },
  backupActionTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  backupActionDesc: { color: '#666', fontSize: 11 },

  // Bottom sheets
  namesSheet: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, maxHeight: '70%', borderTopWidth: 1, borderColor: '#2d2d4e' },
  namesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  namesTitle: { color: '#f0f0f0', fontSize: 16, fontWeight: '700' },
  nameItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  nameItemOn: { backgroundColor: 'rgba(240,165,0,0.05)' },
  nameAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#2d2d4e', alignItems: 'center', justifyContent: 'center' },
  nameAvatarText: { color: '#888', fontSize: 13, fontWeight: '800' },
  nameItemText: { color: '#ccc', fontSize: 14, fontWeight: '600' },
  nameItemSub: { color: '#555', fontSize: 10, marginTop: 1 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#2d2d4e', backgroundColor: '#0f0f1e', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#f0a500', borderColor: '#f0a500' },
  doneBtn: { backgroundColor: '#f0a500', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  doneBtnText: { color: '#1a1a2e', fontSize: 14, fontWeight: '800' },

  // Edit modal
  editOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  editSheet: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '92%', borderTopWidth: 1, borderColor: '#2d2d4e' },
  editField: { marginBottom: 14 },
  editLabel: { color: '#888', fontSize: 12, fontWeight: '600' },
  editLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  lockedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(240,165,0,0.1)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(240,165,0,0.3)' },
  lockedBadgeText: { color: '#f0a500', fontSize: 10, fontWeight: '700' },
  editInput: { backgroundColor: '#0f0f1e', borderRadius: 10, padding: 12, color: '#f0f0f0', fontSize: 15, borderWidth: 1.5, borderColor: '#2d2d4e' },
  editInputDisabled: { backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#777' },
  quickOwnerChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, backgroundColor: '#0f0f1e', borderWidth: 1, borderColor: '#2d2d4e' },
  quickOwnerChipActive: { borderColor: '#2ecc71', backgroundColor: 'rgba(46,204,113,0.1)' },
  quickOwnerChipText: { color: '#888', fontSize: 11, fontWeight: '600' },
  quickOwnerChipActiveText: { color: '#2ecc71' },
  editDateShortcuts: { flexDirection: 'row', gap: 6 },
  quickDateChip: { paddingHorizontal: 9, paddingVertical: 2, borderRadius: 10, backgroundColor: '#0f0f1e', borderWidth: 1, borderColor: '#2d2d4e' },
  quickDateChipText: { color: '#f0a500', fontSize: 11, fontWeight: '700' },
  editBtns: { flexDirection: 'row', gap: 10, marginTop: 16 },
  editBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  editBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
