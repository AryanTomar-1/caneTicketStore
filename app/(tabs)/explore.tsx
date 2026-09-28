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
  getCaneRate, setCaneRate,
} from '../../utils/storage';
import { exportBackupToFile, importBackupFromFile } from '../../utils/backup';
import { formatDateInput, isValidDate, sanitizeFilterDate, compareDDMMYYYY, todayFormatted, yesterdayFormatted } from '../../utils/dateHelpers';
import { useMicPulse } from '../../hooks/useMicPulse';
import { Ticket, MillPaymentSettings } from '../../types';
import SeasonSelector from '../../components/SeasonSelector';
import { useSeason } from '../../context/SeasonContext';

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
  const [showDateModal, setShowDateModal] = useState(false);
  const [tempDateFilter, setTempDateFilter] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [isSearchListening, setIsSearchListening] = useState(false);
  const [selectedOwners, setSelectedOwners] = useState<string[]>([]);
  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const [uniqueOwners, setUniqueOwners] = useState<string[]>([]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalQty = filtered.reduce((sum, t) => sum + (parseFloat(String(t.quantity)) || 0), 0);
  const hasFilters = searchText || selectedNames.length > 0 || selectedOwners.length > 0 || filterDate;

  // ── Rate Management ───────────────────────────────────────────────────────
  const [pricePerQty, setPricePerQty] = useState<string>('');
  const [rateInput, setRateInput] = useState<string>('');
  const [showRateModal, setShowRateModal] = useState(false);
  const priceNum = parseFloat(pricePerQty);

  // ── Mill Payment Settings ─────────────────────────────────────────────────
  const [millSettings, setMillSettings] = useState<MillPaymentSettings | null>(null);
  const [showMillActionsSheet, setShowMillActionsSheet] = useState(false);
  const [showMillViewModal, setShowMillViewModal] = useState(false);
  const [showMillDateModal, setShowMillDateModal] = useState(false);
  const [millDateInput, setMillDateInput] = useState('');
  const [millDateError, setMillDateError] = useState('');

  // ── Payment calculations (based on filtered tickets) ──────────────────────
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
      loadRate();
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

    // Always derive unique owners from ALL tickets
    setUniqueOwners([...new Set(allData.map(t => t.caneOwner).filter(Boolean))].sort());
    setTickets(allData);

    // uniqueNames = names filtered by the currently active owner selection
    const ownerBase = ownersToUse.length > 0
      ? allData.filter(t => ownersToUse.includes(t.caneOwner))
      : allData;
    setUniqueNames([...new Set(ownerBase.map(t => t.name))].sort());

    applyFilters(allData, searchToUse, namesToUse, dateToUse, ownersToUse);
  };

  const loadMillSettings = async () => {
    const s = await getMillPaymentSettings(selectedSeason);
    setMillSettings(s);
  };

  const loadRate = async () => {
    const r = await getCaneRate(selectedSeason);
    setPricePerQty(r);
  };

  const handleSaveRate = async (rateVal: string) => {
    const cleaned = rateVal.trim();
    await setCaneRate(selectedSeason, cleaned);
    setPricePerQty(cleaned);
    setShowRateModal(false);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleClearRate = async () => {
    await setCaneRate(selectedSeason, '');
    setPricePerQty('');
    setRateInput('');
    setShowRateModal(false);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
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
    // Restore full name list when owner filter is cleared
    setUniqueNames([...new Set(tickets.map(t => t.name))].sort());
    applyFilters(tickets, searchText, selectedNames, filterDate, []);
    return;
    }
    const newOwners = selectedOwners.includes(owner)
      ? selectedOwners.filter(o => o !== owner)
      : [...selectedOwners, owner];
    setSelectedOwners(newOwners);

    // Recompute uniqueNames scoped to the new owner selection
    // and clear any name selections that are no longer valid
    const ownerBase = newOwners.length > 0
      ? tickets.filter(t => newOwners.includes(t.caneOwner))
      : tickets;
    const newUniqueNames = [...new Set(ownerBase.map(t => t.name))].sort();
    setUniqueNames(newUniqueNames);
    // Drop any previously-selected names that don't exist under the new owner filter
    const validNames = selectedNames.filter(n => newUniqueNames.includes(n));
    if (validNames.length !== selectedNames.length) setSelectedNames(validNames);

    applyFilters(tickets, searchText, validNames, filterDate, newOwners);
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
    setTempDateFilter('');
    setSelectedOwners([]);
    setShowDateModal(false);
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
      setMillDateError('गलत तारीख। DD/MM/YYYY फ़ॉर्मेट में दर्ज करें।');
      return;
    }
    try {
      await setMillPaymentSettings(selectedSeason, { paidUntilDate: millDateInput });
      setMillSettings({ paidUntilDate: millDateInput });
      setShowMillDateModal(false);
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
            setShowMillActionsSheet(false);
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
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
              if (!result) { setBackupLoading(false); return; }
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
    const farmer_code = editTicket.farmer_code;

    if (!name.trim() || !fatherName.trim() || !caneOwner.trim() || !date.trim() || !quantity.trim()) {
      Alert.alert('आवश्यक', 'कृपया सभी आवश्यक फ़ील्ड भरें।'); return;
    }
    if (!isValidDate(date.trim())) {
      Alert.alert('गलत तारीख', 'कृपया DD/MM/YYYY फ़ॉर्मेट में सही तारीख दर्ज करें।'); return;
    }

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
        farmer_code,
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

  // ── Farmer/Ticket Card Render ─────────────────────────────────────────────
  const renderTicket: ListRenderItem<Ticket> = ({ item }) => {
    const payStatus = getPaymentStatus(item);
    return (
      <View style={styles.ticketCard}>
        {/* Header row: Farmer identity on left, action icons on right */}
        <View style={styles.ticketHeader}>
          <View style={styles.ticketAvatar}>
            <Text style={styles.ticketAvatarText}>
              {item.name ? item.name.charAt(0).toUpperCase() : '?'}
            </Text>
          </View>

          <View style={styles.ticketInfo}>
            <Text style={styles.farmerName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.farmerFather} numberOfLines={1}>पिता: {item.fatherName}</Text>
            <Text style={styles.farmerCode} numberOfLines={1}>कोड: {item.farmer_code}</Text>
          </View>

          <View style={styles.ticketActions}>
            <TouchableOpacity
              onPress={() => shareOnWhatsApp(item)}
              style={[styles.actionBtn, styles.actionBtnWhatsApp]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="logo-whatsapp" size={17} color="#22c55e" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => openEdit(item)}
              style={[styles.actionBtn, styles.actionBtnEdit]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="pencil-outline" size={17} color="#f0a500" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDelete(item.id, item.name)}
              style={[styles.actionBtn, styles.actionBtnDelete]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={17} color="#ef4444" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Details & Badges */}
        <View style={styles.ticketMetricsRow}>
          <View style={styles.metricBadgeDate}>
            <Ionicons name="calendar-outline" size={12} color="#f0a500" />
            <Text style={styles.metricDateText}>{item.date}</Text>
          </View>

          <View style={styles.metricBadgeQty}>
            <Ionicons name="layers-outline" size={12} color="#06b6d4" />
            <Text style={styles.metricQtyText}>
              {parseFloat(String(item.quantity)).toFixed(2)} क्विंटल
            </Text>
          </View>

          {item.caneOwner !== 'मेरा गन्ना' && (
            <View style={styles.ownerBadge}>
              <Ionicons name="leaf-outline" size={11} color="#22c55e" />
              <Text style={styles.ownerBadgeText} numberOfLines={1}>{item.caneOwner}</Text>
            </View>
          )}

          {payStatus !== 'unknown' && (
            <View style={[styles.payBadge, payStatus === 'paid' ? styles.payBadgePaid : styles.payBadgePending]}>
              <Ionicons
                name={payStatus === 'paid' ? 'checkmark-circle' : 'time-outline'}
                size={11}
                color={payStatus === 'paid' ? '#22c55e' : '#f0a500'}
              />
              <Text style={[styles.payBadgeText, { color: payStatus === 'paid' ? '#22c55e' : '#f0a500' }]}>
                {payStatus === 'paid' ? 'भुगतान प्राप्त' : 'बकाया'}
              </Text>
            </View>
          )}

          {item.updatedAt && (
            <View style={styles.editedBadge}>
              <Ionicons name="pencil" size={10} color="#a855f7" />
              <Text style={styles.editedBadgeText}>संपादित</Text>
            </View>
          )}
        </View>

        {/* Comment if any */}
        {!!item.comment && (
          <View style={styles.commentRow}>
            <Ionicons name="chatbubble-outline" size={12} color="#64748b" />
            <Text style={styles.commentText} numberOfLines={2}>{item.comment}</Text>
          </View>
        )}

        <Text style={styles.ticketTime}>जोड़ा: {formatDateTime(item.createdAt)}</Text>
      </View>
    );
  };

  // ── Header Component for FlatList (Ensures full page scrolls smoothly) ─────
  const renderDashboardHeader = () => (
    <View style={styles.headerContainer}>
      {/* ── 1. HEADER: Title, Season Selector & Backup ── */}
      <View style={styles.headerTopRow}>
        <View style={styles.titleWithSeason}>
          <Text style={styles.appTitle}>खर्च प्रबंधन</Text>
          <View style={styles.seasonInlineWrapper}>
            <SeasonSelector prefix="सीजन: " />
          </View>
        </View>
        <TouchableOpacity
          style={styles.backupBtn}
          onPress={() => setShowBackupModal(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="cloud-upload-outline" size={15} color="#a855f7" />
          <Text style={styles.backupBtnText}>बैकअप</Text>
        </TouchableOpacity>
      </View>

      {/* ── 2. SUMMARY CARDS: 3 horizontal cards ── */}
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, styles.summaryCardAmber]}>
          <View style={styles.summaryValueRow}>
            <View style={[styles.summaryIconBox, { backgroundColor: 'rgba(240,165,0,0.12)' }]}>
              <Ionicons name="receipt-outline" size={14} color="#f0a500" />
            </View>
            <Text style={[styles.summaryNum, { color: '#f0a500' }]} numberOfLines={1}>
              {filtered.length}
            </Text>
          </View>
          <Text style={styles.summaryLabel}>टिकट</Text>
        </View>

        <View style={[styles.summaryCard, styles.summaryCardCyan]}>
          <View style={styles.summaryValueRow}>
            <View style={[styles.summaryIconBox, { backgroundColor: 'rgba(6,182,212,0.12)' }]}>
              <Ionicons name="layers-outline" size={14} color="#06b6d4" />
            </View>
            <Text style={[styles.summaryNum, { color: '#06b6d4' }]} numberOfLines={1} adjustsFontSizeToFit>
              {totalQty.toFixed(1)}
            </Text>
          </View>
          <Text style={styles.summaryLabel}>क्विंटल</Text>
        </View>

        <View style={[styles.summaryCard, styles.summaryCardPurple]}>
          <View style={styles.summaryValueRow}>
            <View style={[styles.summaryIconBox, { backgroundColor: 'rgba(168,85,247,0.12)' }]}>
              <Ionicons name="people-outline" size={14} color="#a855f7" />
            </View>
            <Text style={[styles.summaryNum, { color: '#a855f7' }]} numberOfLines={1}>
              {uniqueNames.length}
            </Text>
          </View>
          <Text style={styles.summaryLabel}>किसान</Text>
        </View>
      </View>

      {/* ── 3. RATE SECTION: Compact clickable row ── */}
      <TouchableOpacity
        style={styles.rateCard}
        onPress={() => {
          setRateInput(pricePerQty);
          setShowRateModal(true);
        }}
        activeOpacity={0.7}
      >
        <View style={styles.rateLeft}>
          <View style={styles.rateIconCircle}>
            <Text style={styles.rateCurrencySymbol}>₹</Text>
          </View>
          <View>
            <Text style={styles.rateTitle}>₹ / क्विंटल</Text>
            <Text style={styles.rateSubTitle}>दर / Rate</Text>
          </View>
        </View>

        <View style={styles.rateRight}>
          {pricePerQty ? (
            <View style={styles.rateValueBadge}>
              <Text style={styles.rateValueText}>₹{pricePerQty} / क्विं</Text>
              {totalAmount !== null && (
                <Text style={styles.rateTotalAmountSub}>
                  (कुल: ₹{Math.round(totalAmount).toLocaleString('en-IN')})
                </Text>
              )}
            </View>
          ) : (
            <View style={styles.rateSetBadge}>
              <Text style={styles.rateSetText}>सेट करें</Text>
            </View>
          )}
          <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
        </View>
      </TouchableOpacity>

      {/* ── 4. MILL PAYMENT TRACKER: Compact clickable card ── */}
      <TouchableOpacity
        style={styles.millCompactCard}
        onPress={() => setShowMillActionsSheet(true)}
        activeOpacity={0.7}
      >
        <View style={styles.millLeft}>
          <View style={styles.millIconCircle}>
            <Ionicons name="cash-outline" size={18} color="#22c55e" />
          </View>
          <View>
            <Text style={styles.millTitle}>💵 मिल भुगतान ट्रैकर</Text>
            <Text style={styles.millSubTitle}>भुगतान और तारीख प्रबंधित करें</Text>
          </View>
        </View>

        <View style={styles.millRight}>
          {millSettings?.paidUntilDate ? (
            <View style={styles.millActivePill}>
              <Ionicons name="calendar-outline" size={11} color="#22c55e" />
              <Text style={styles.millActiveDateText}>{millSettings.paidUntilDate}</Text>
            </View>
          ) : null}
          <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
        </View>
      </TouchableOpacity>

      {/* ── 5. SEARCH FIELD WITH MICROPHONE ── */}
      <View style={[styles.searchBox, isSearchListening && styles.searchBoxListening]}>
        <Ionicons name="search" size={18} color={isSearchListening ? '#ef4444' : '#64748b'} />
        <TextInput
          style={styles.searchInput}
          value={searchText}
          onChangeText={handleSearch}
          placeholder={isSearchListening ? 'सुन रहा है...' : 'नाम / किसान कोड खोजें...'}
          placeholderTextColor={isSearchListening ? '#ef4444' : '#64748b'}
          autoCorrect={false}
        />
        {searchText ? (
          <TouchableOpacity onPress={() => handleSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color="#94a3b8" />
          </TouchableOpacity>
        ) : null}
        <Animated.View style={{ transform: [{ scale: mic.anim }] }}>
          <View
            {...searchMicResponder.panHandlers}
            style={[styles.searchMicBtn, isSearchListening && styles.searchMicBtnActive]}
          >
            <Ionicons
              name={isSearchListening ? 'mic' : 'mic-outline'}
              size={17}
              color={isSearchListening ? '#fff' : '#f0a500'}
            />
          </View>
        </Animated.View>
      </View>
      <Text style={styles.searchHelperText}>⚡ साइड दबाकर बोलें या तारीख/नाम से खोजें</Text>

      {/* ── 6. FILTERS: मालिक, नाम चुनें, तारीख चुनें ── */}
      <View style={styles.filtersRow}>
        <TouchableOpacity
          style={[styles.filterChip, selectedOwners.length > 0 && styles.filterChipActiveGreen]}
          onPress={() => setShowOwnerModal(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="leaf-outline" size={13} color={selectedOwners.length > 0 ? '#22c55e' : '#94a3b8'} />
          <Text style={[styles.filterChipText, selectedOwners.length > 0 && { color: '#22c55e' }]} numberOfLines={1}>
            {selectedOwners.length === 0 ? 'मालिक' : selectedOwners.length === 1 ? selectedOwners[0] : `${selectedOwners.length} मालिक`}
          </Text>
          <Ionicons name="chevron-down" size={12} color={selectedOwners.length > 0 ? '#22c55e' : '#94a3b8'} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, selectedNames.length > 0 && styles.filterChipActiveAmber]}
          onPress={() => setShowNamesModal(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="person-outline" size={13} color={selectedNames.length > 0 ? '#f0a500' : '#94a3b8'} />
          <Text style={[styles.filterChipText, selectedNames.length > 0 && { color: '#f0a500' }]} numberOfLines={1}>
            {selectedNames.length === 0 ? 'नाम चुनें' : selectedNames.length === 1 ? selectedNames[0] : `${selectedNames.length} नाम`}
          </Text>
          <Ionicons name="chevron-down" size={12} color={selectedNames.length > 0 ? '#f0a500' : '#94a3b8'} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, filterDate && styles.filterChipActiveAmber]}
          onPress={() => {
            setTempDateFilter(filterDate);
            setShowDateModal(true);
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="calendar-outline" size={13} color={filterDate ? '#f0a500' : '#94a3b8'} />
          <Text style={[styles.filterChipText, filterDate && { color: '#f0a500' }]} numberOfLines={1}>
            {filterDate ? `तारीख: ${filterDate}` : 'तारीख चुनें'}
          </Text>
          {filterDate ? (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                handleDateFilter('');
                setTempDateFilter('');
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={13} color="#f0a500" />
            </TouchableOpacity>
          ) : (
            <Ionicons name="chevron-down" size={12} color="#94a3b8" />
          )}
        </TouchableOpacity>

        {hasFilters ? (
          <TouchableOpacity style={styles.clearFilterChip} onPress={clearFilters} activeOpacity={0.7}>
            <Ionicons name="close" size={13} color="#ef4444" />
            <Text style={styles.clearFilterText}>साफ़ करें</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Active filter name tags */}
      {selectedNames.length > 0 && (
        <View style={styles.activeTagRow}>
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

      {/* ── 7. RECORD COUNT ── */}
      <Text style={styles.recordCountText}>📋 कुल {filtered.length} पर्चियां मिलीं</Text>
    </View>
  );

  return (
    <View style={[styles.safe, { paddingTop: Math.max(insets.top, 12) }]}>
      <FlatList<Ticket>
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderTicket}
        ListHeaderComponent={renderDashboardHeader}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await loadData();
              await loadMillSettings();
              await loadRate();
              setRefreshing(false);
            }}
            tintColor="#f0a500"
            colors={['#f0a500']}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={54} color="#334155" />
            <Text style={styles.emptyTitle}>कोई रिकॉर्ड नहीं मिला</Text>
            <Text style={styles.emptySubtitle}>
              {hasFilters ? 'फ़िल्टर साफ़ करें या अलग खोजें' : 'नीचे "रिकॉर्ड जोड़ें" टैब से नया टिकट जोड़ें'}
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />

      {/* ══ 1. RATE BOTTOM SHEET ("दर सेट करें") ══ */}
      <Modal visible={showRateModal} transparent animationType="slide" onRequestClose={() => setShowRateModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowRateModal(false)}
          >
            <TouchableOpacity
              style={styles.bottomSheetCard}
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.dragHandle} />

              <View style={styles.sheetHeaderRow}>
                <View style={styles.sheetTitleGroup}>
                  <View style={[styles.sheetIconCircle, { backgroundColor: 'rgba(240,165,0,0.15)' }]}>
                    <Text style={{ color: '#f0a500', fontSize: 16, fontWeight: '800' }}>₹</Text>
                  </View>
                  <Text style={styles.sheetTitle}>दर सेट करें</Text>
                </View>
                <TouchableOpacity onPress={() => setShowRateModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={22} color="#94a3b8" />
                </TouchableOpacity>
              </View>

              {pricePerQty ? (
                <View style={styles.currentRateNotice}>
                  <Text style={styles.currentRateText}>
                    वर्तमान दर: <Text style={{ color: '#f0a500', fontWeight: '800' }}>₹{pricePerQty}</Text> / क्विंटल
                  </Text>
                  <TouchableOpacity onPress={handleClearRate} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.clearRateText}>हटाएं</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={styles.sheetSubtitle}>गन्ना भुगतान के लिए प्रति क्विंटल दर दर्ज करें</Text>
              )}

              {/* Rate input field */}
              <View style={styles.rateInputRow}>
                <Text style={styles.rateInputPrefix}>₹</Text>
                <TextInput
                  style={styles.rateNumericInput}
                  value={rateInput}
                  onChangeText={(v) => { if (v === '' || /^\d*\.?\d*$/.test(v)) setRateInput(v); }}
                  placeholder="0.00"
                  placeholderTextColor="#475569"
                  keyboardType="numeric"
                  autoFocus
                />
                <Text style={styles.rateInputSuffix}>/ क्विंटल</Text>
              </View>

              {/* Quick rate preset chips */}
              <View style={styles.presetRow}>
                <Text style={styles.presetLabel}>त्वरित दर:</Text>
                {['350', '360', '375', '385'].map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.presetChip, rateInput === r && styles.presetChipActive]}
                    onPress={() => setRateInput(r)}
                  >
                    <Text style={[styles.presetChipText, rateInput === r && styles.presetChipActiveText]}>₹{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Action buttons */}
              <View style={styles.sheetButtonRow}>
                <TouchableOpacity
                  style={[styles.sheetBtn, styles.sheetBtnCancel]}
                  onPress={() => setShowRateModal(false)}
                >
                  <Text style={styles.sheetBtnCancelText}>रद्द करें</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sheetBtn, styles.sheetBtnSave]}
                  onPress={() => handleSaveRate(rateInput)}
                >
                  <Text style={styles.sheetBtnSaveText}>सेव करें</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══ 2. MILL PAYMENT ACTIONS BOTTOM SHEET ("मिल भुगतान ट्रैकर") ══ */}
      <Modal visible={showMillActionsSheet} transparent animationType="slide" onRequestClose={() => setShowMillActionsSheet(false)}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setShowMillActionsSheet(false)}
        >
          <TouchableOpacity
            style={styles.bottomSheetCard}
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.dragHandle} />

            <View style={styles.sheetHeaderRow}>
              <View style={styles.sheetTitleGroup}>
                <View style={[styles.sheetIconCircle, { backgroundColor: 'rgba(34,197,94,0.15)' }]}>
                  <Ionicons name="cash-outline" size={18} color="#22c55e" />
                </View>
                <Text style={styles.sheetTitle}>मिल भुगतान ट्रैकर</Text>
              </View>
              <TouchableOpacity onPress={() => setShowMillActionsSheet(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <Text style={styles.sheetSubtitle}>भुगतान और तारीख प्रबंधित करें</Text>

            {/* Action Option A: "मिल भुगतान देखें" */}
            <TouchableOpacity
              style={styles.millActionCard}
              onPress={() => {
                setShowMillActionsSheet(false);
                setTimeout(() => setShowMillViewModal(true), 250);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.millActionIconCircle, { backgroundColor: 'rgba(34,197,94,0.15)' }]}>
                <Ionicons name="wallet-outline" size={24} color="#22c55e" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.millActionTitle}>मिल भुगतान देखें</Text>
                <Text style={styles.millActionSub}>किसानों के भुगतान की स्थिति देखें</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
            </TouchableOpacity>

            {/* Action Option B: "भुगतान तारीख सेट करें" */}
            <TouchableOpacity
              style={styles.millActionCard}
              onPress={() => {
                setMillDateInput(millSettings?.paidUntilDate || todayFormatted());
                setShowMillActionsSheet(false);
                setTimeout(() => setShowMillDateModal(true), 250);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.millActionIconCircle, { backgroundColor: 'rgba(240,165,0,0.15)' }]}>
                <Ionicons name="calendar-outline" size={24} color="#f0a500" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.millActionTitle}>
                  {millSettings?.paidUntilDate ? 'भुगतान तारीख बदलें' : 'भुगतान तारीख सेट करें'}
                </Text>
                <Text style={styles.millActionSub}>किसान के लिए भुगतान तारीख तय करें</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
            </TouchableOpacity>

            {/* Current status & clear option */}
            {millSettings?.paidUntilDate && (
              <View style={styles.millStatusFooter}>
                <View style={styles.millStatusPill}>
                  <Ionicons name="checkmark-circle" size={13} color="#22c55e" />
                  <Text style={styles.millStatusPillText}>
                    तारीख तय: <Text style={{ fontWeight: '800', color: '#22c55e' }}>{millSettings.paidUntilDate}</Text>
                  </Text>
                </View>
                <TouchableOpacity onPress={handleClearMillDate} style={styles.clearDateBtn}>
                  <Ionicons name="trash-outline" size={13} color="#ef4444" />
                  <Text style={styles.clearDateBtnText}>तारीख हटाएं</Text>
                </TouchableOpacity>
              </View>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ══ 3. MILL PAYMENT STATUS VIEW MODAL (Option A) ══ */}
      <Modal visible={showMillViewModal} transparent animationType="slide" onRequestClose={() => setShowMillViewModal(false)}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setShowMillViewModal(false)}
        >
          <TouchableOpacity
            style={styles.bottomSheetCard}
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.dragHandle} />

            <View style={styles.sheetHeaderRow}>
              <View style={styles.sheetTitleGroup}>
                <View style={[styles.sheetIconCircle, { backgroundColor: 'rgba(34,197,94,0.15)' }]}>
                  <Ionicons name="cash" size={18} color="#22c55e" />
                </View>
                <Text style={styles.sheetTitle}>मिल भुगतान विवरण</Text>
              </View>
              <TouchableOpacity onPress={() => setShowMillViewModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <Text style={styles.sheetSubtitle}>
              {millSettings?.paidUntilDate
                ? `कट-ऑफ तारीख: ${millSettings.paidUntilDate} तक भुगतान प्राप्त`
                : 'तारीख सेट नहीं है (सभी पर्चियां बकाया)'}
            </Text>

            {/* 3 Metric Breakdown Cards */}
            <View style={styles.millBreakdownGrid}>
              <View style={[styles.millGridCard, { borderColor: 'rgba(6,182,212,0.3)' }]}>
                <Text style={styles.millGridLabel}>कुल गन्ना / राशि</Text>
                <Text style={[styles.millGridValue, { color: '#06b6d4' }]}>
                  {totalAmount !== null ? `₹${Math.round(totalAmount).toLocaleString('en-IN')}` : `${totalQty.toFixed(1)} क्विं`}
                </Text>
                <Text style={styles.millGridSub}>{totalQty.toFixed(1)} क्विंटल</Text>
              </View>

              <View style={[styles.millGridCard, { borderColor: 'rgba(34,197,94,0.3)' }]}>
                <Text style={styles.millGridLabel}>प्राप्त भुगतान</Text>
                <Text style={[styles.millGridValue, { color: '#22c55e' }]}>
                  {paidAmount !== null ? `₹${Math.round(paidAmount).toLocaleString('en-IN')}` : `${paidQty.toFixed(1)} क्विं`}
                </Text>
                <Text style={styles.millGridSub}>{paidQty.toFixed(1)} क्विंटल</Text>
              </View>

              <View style={[styles.millGridCard, { borderColor: 'rgba(240,165,0,0.3)' }]}>
                <Text style={styles.millGridLabel}>कुल बकाया</Text>
                <Text style={[styles.millGridValue, { color: '#f0a500' }]}>
                  {pendingAmount !== null ? `₹${Math.round(pendingAmount).toLocaleString('en-IN')}` : `${pendingQty.toFixed(1)} क्विं`}
                </Text>
                <Text style={styles.millGridSub}>{pendingQty.toFixed(1)} क्विंटल</Text>
              </View>
            </View>

            {totalAmount === null && (
              <View style={styles.hintNotice}>
                <Ionicons name="information-circle-outline" size={14} color="#f0a500" />
                <Text style={styles.hintNoticeText}>
                  दर (₹/क्विंटल) सेट करने पर कुल व बकाया राशि रुपए में दिखेगी।
                </Text>
              </View>
            )}

            <View style={styles.sheetButtonRow}>
              <TouchableOpacity
                style={[styles.sheetBtn, styles.sheetBtnOutline]}
                onPress={() => {
                  setShowMillViewModal(false);
                  setMillDateInput(millSettings?.paidUntilDate || todayFormatted());
                  setTimeout(() => setShowMillDateModal(true), 250);
                }}
              >
                <Ionicons name="calendar-outline" size={16} color="#f0a500" />
                <Text style={styles.sheetBtnOutlineText}>
                  {millSettings?.paidUntilDate ? 'तारीख बदलें' : 'तारीख सेट करें'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sheetBtn, styles.sheetBtnSave]}
                onPress={() => setShowMillViewModal(false)}
              >
                <Text style={styles.sheetBtnSaveText}>बंद करें</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ══ 4. MILL PAYMENT DATE SET MODAL (Option B) ══ */}
      <Modal visible={showMillDateModal} transparent animationType="slide" onRequestClose={() => setShowMillDateModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowMillDateModal(false)}
          >
            <TouchableOpacity
              style={styles.bottomSheetCard}
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.dragHandle} />

              <View style={styles.sheetHeaderRow}>
                <View style={styles.sheetTitleGroup}>
                  <View style={[styles.sheetIconCircle, { backgroundColor: 'rgba(34,197,94,0.15)' }]}>
                    <Ionicons name="calendar" size={18} color="#22c55e" />
                  </View>
                  <Text style={styles.sheetTitle}>भुगतान तारीख सेट करें</Text>
                </View>
                <TouchableOpacity onPress={() => setShowMillDateModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={22} color="#94a3b8" />
                </TouchableOpacity>
              </View>

              <Text style={styles.sheetSubtitle}>
                मिल ने किस तारीख तक का भुगतान किया है? इससे पहले की सभी पर्चियां &quot;भुगतान प्राप्त&quot; मानी जाएंगी।
              </Text>

              {/* Quick shortcut chips */}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                <TouchableOpacity
                  style={[styles.presetChip, millDateInput === todayFormatted() && styles.presetChipActive]}
                  onPress={() => setMillDateInput(todayFormatted())}
                >
                  <Text style={[styles.presetChipText, millDateInput === todayFormatted() && styles.presetChipActiveText]}>
                    📅 आज ({todayFormatted()})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.presetChip, millDateInput === yesterdayFormatted() && styles.presetChipActive]}
                  onPress={() => setMillDateInput(yesterdayFormatted())}
                >
                  <Text style={[styles.presetChipText, millDateInput === yesterdayFormatted() && styles.presetChipActiveText]}>
                    कल ({yesterdayFormatted()})
                  </Text>
                </TouchableOpacity>
              </View>

              <TextInput
                style={[styles.dateInputField, millDateError ? { borderColor: '#ef4444' } : {}]}
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
                placeholderTextColor="#475569"
                keyboardType="numeric"
                maxLength={10}
                autoFocus
              />

              {!!millDateError && <Text style={styles.errorText}>{millDateError}</Text>}
              <Text style={styles.inputHelperText}>उदाहरण: {todayFormatted()}</Text>

              <View style={styles.sheetButtonRow}>
                <TouchableOpacity
                  style={[styles.sheetBtn, styles.sheetBtnCancel]}
                  onPress={() => { setShowMillDateModal(false); setMillDateError(''); }}
                >
                  <Text style={styles.sheetBtnCancelText}>रद्द करें</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sheetBtn, styles.sheetBtnSave]}
                  onPress={handleSaveMillDate}
                >
                  <Text style={styles.sheetBtnSaveText}>✓ सेव करें</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══ 5. DATE FILTER MODAL ══ */}
      <Modal visible={showDateModal} transparent animationType="slide" onRequestClose={() => setShowDateModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowDateModal(false)}>
            <TouchableOpacity style={styles.bottomSheetCard} activeOpacity={1} onPress={(e) => e.stopPropagation()}>
              <View style={styles.dragHandle} />

              <View style={styles.sheetHeaderRow}>
                <View style={styles.sheetTitleGroup}>
                  <View style={[styles.sheetIconCircle, { backgroundColor: 'rgba(240,165,0,0.15)' }]}>
                    <Ionicons name="calendar" size={18} color="#f0a500" />
                  </View>
                  <Text style={styles.sheetTitle}>तारीख से खोजें</Text>
                </View>
                <TouchableOpacity onPress={() => setShowDateModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={22} color="#94a3b8" />
                </TouchableOpacity>
              </View>

              <Text style={styles.sheetSubtitle}>
                तारीख, महीना या साल डालकर पर्चियां फ़िल्टर करें (जैसे: 15, 03/2025, या 2025)।
              </Text>

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                <TouchableOpacity
                  style={[styles.presetChip, tempDateFilter === todayFormatted() && styles.presetChipActive]}
                  onPress={() => setTempDateFilter(todayFormatted())}
                >
                  <Text style={[styles.presetChipText, tempDateFilter === todayFormatted() && styles.presetChipActiveText]}>
                    📅 आज ({todayFormatted()})
                  </Text>
                </TouchableOpacity>

                {tempDateFilter ? (
                  <TouchableOpacity
                    style={[styles.presetChip, { borderColor: 'rgba(239,68,68,0.4)', backgroundColor: 'rgba(239,68,68,0.1)' }]}
                    onPress={() => setTempDateFilter('')}
                  >
                    <Text style={[styles.presetChipText, { color: '#ef4444' }]}>✕ साफ़ करें</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <TextInput
                style={[styles.dateInputField, { borderColor: '#f0a500' }]}
                value={tempDateFilter}
                onChangeText={setTempDateFilter}
                placeholder="जैसे: 2025 या 03/2025 या 15"
                placeholderTextColor="#475569"
                keyboardType="default"
                autoFocus
              />

              <Text style={styles.inputHelperText}>
                {tempDateFilter ? `चयनित: ${tempDateFilter}` : 'उदाहरण: 2025 या 03/2025 या 15'}
              </Text>

              <View style={styles.sheetButtonRow}>
                <TouchableOpacity
                  style={[styles.sheetBtn, styles.sheetBtnCancel]}
                  onPress={() => setShowDateModal(false)}
                >
                  <Text style={styles.sheetBtnCancelText}>रद्द करें</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sheetBtn, styles.sheetBtnSave]}
                  onPress={() => {
                    handleDateFilter(tempDateFilter);
                    setShowDateModal(false);
                  }}
                >
                  <Text style={styles.sheetBtnSaveText}>✓ फ़िल्टर लगाएं</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══ 6. NAMES FILTER MODAL ══ */}
      <Modal visible={showNamesModal} transparent animationType="slide" onRequestClose={() => setShowNamesModal(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowNamesModal(false)}>
          <View style={styles.bottomSheetCard}>
            <View style={styles.dragHandle} />
            <View style={styles.sheetHeaderRow}>
              <View style={styles.sheetTitleGroup}>
                <View style={[styles.sheetIconCircle, { backgroundColor: 'rgba(240,165,0,0.15)' }]}>
                  <Ionicons name="people-outline" size={18} color="#f0a500" />
                </View>
                <Text style={styles.sheetTitle}>किसान नाम चुनें</Text>
              </View>
              <TouchableOpacity onPress={() => setShowNamesModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 350 }}>
              <TouchableOpacity
                style={[styles.pickerItem, selectedNames.length === 0 && styles.pickerItemActive]}
                onPress={() => handleSelectName(null)}
              >
                <Text style={[styles.pickerItemText, selectedNames.length === 0 && { color: '#f0a500', fontWeight: '800' }]}>
                  सभी नाम (सभी किसान)
                </Text>
                {selectedNames.length === 0 && <Ionicons name="checkmark" size={18} color="#f0a500" />}
              </TouchableOpacity>

              {uniqueNames.map(name => {
                const count = tickets.filter(t => t.name === name).length;
                const qty = tickets.filter(t => t.name === name).reduce((s, t) => s + (parseFloat(String(t.quantity)) || 0), 0);
                const isSelected = selectedNames.includes(name);
                return (
                  <TouchableOpacity
                    key={name}
                    style={[styles.pickerItem, isSelected && styles.pickerItemActive]}
                    onPress={() => handleSelectName(name)}
                  >
                    <View style={styles.pickerAvatar}>
                      <Text style={[styles.pickerAvatarText, isSelected && { color: '#f0a500' }]}>
                        {name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pickerItemText, isSelected && { color: '#f0a500' }]}>{name}</Text>
                      <Text style={styles.pickerItemSub}>{count} टिकट · {qty.toFixed(2)} क्विंटल</Text>
                    </View>
                    <View style={[styles.pickerCheckbox, isSelected && styles.pickerCheckboxActiveAmber]}>
                      {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity style={styles.sheetConfirmBtn} onPress={() => setShowNamesModal(false)}>
              <Text style={styles.sheetConfirmBtnText}>
                {selectedNames.length > 0 ? `✓ ${selectedNames.length} नाम चुने गए` : 'बंद करें'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ══ 7. OWNER FILTER MODAL ══ */}
      <Modal visible={showOwnerModal} transparent animationType="slide" onRequestClose={() => setShowOwnerModal(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowOwnerModal(false)}>
          <View style={styles.bottomSheetCard}>
            <View style={styles.dragHandle} />
            <View style={styles.sheetHeaderRow}>
              <View style={styles.sheetTitleGroup}>
                <View style={[styles.sheetIconCircle, { backgroundColor: 'rgba(34,197,94,0.15)' }]}>
                  <Ionicons name="leaf-outline" size={18} color="#22c55e" />
                </View>
                <Text style={styles.sheetTitle}>गन्ना मालिक चुनें</Text>
              </View>
              <TouchableOpacity onPress={() => setShowOwnerModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 350 }}>
              <TouchableOpacity
                style={[styles.pickerItem, selectedOwners.length === 0 && styles.pickerItemActive]}
                onPress={() => handleSelectOwner(null)}
              >
                <Text style={[styles.pickerItemText, selectedOwners.length === 0 && { color: '#22c55e', fontWeight: '800' }]}>
                  सभी मालिक
                </Text>
                {selectedOwners.length === 0 && <Ionicons name="checkmark" size={18} color="#22c55e" />}
              </TouchableOpacity>

              {uniqueOwners.map(owner => {
                const count = tickets.filter(t => t.caneOwner === owner).length;
                const qty = tickets.filter(t => t.caneOwner === owner).reduce((s, t) => s + (parseFloat(String(t.quantity)) || 0), 0);
                const isSelected = selectedOwners.includes(owner);
                return (
                  <TouchableOpacity
                    key={owner}
                    style={[styles.pickerItem, isSelected && styles.pickerItemActive]}
                    onPress={() => handleSelectOwner(owner)}
                  >
                    <View style={[styles.pickerAvatar, { backgroundColor: 'rgba(34,197,94,0.1)' }]}>
                      <Text style={[styles.pickerAvatarText, isSelected && { color: '#22c55e' }]}>
                        {owner.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pickerItemText, isSelected && { color: '#22c55e' }]}>{owner}</Text>
                      <Text style={styles.pickerItemSub}>{count} टिकट · {qty.toFixed(2)} क्विंटल</Text>
                    </View>
                    <View style={[styles.pickerCheckbox, isSelected && styles.pickerCheckboxActiveGreen]}>
                      {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity style={[styles.sheetConfirmBtn, { backgroundColor: '#22c55e' }]} onPress={() => setShowOwnerModal(false)}>
              <Text style={[styles.sheetConfirmBtnText, { color: '#0f172a' }]}>
                {selectedOwners.length > 0 ? `✓ ${selectedOwners.length} मालिक चुने गए` : 'बंद करें'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ══ 8. BACKUP & RESTORE MODAL ══ */}
      <Modal visible={showBackupModal} transparent animationType="slide" onRequestClose={() => { if (!backupLoading) setShowBackupModal(false); }}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => { if (!backupLoading) setShowBackupModal(false); }}
        >
          <View style={styles.bottomSheetCard}>
            <View style={styles.dragHandle} />
            <View style={styles.sheetHeaderRow}>
              <View style={styles.sheetTitleGroup}>
                <View style={[styles.sheetIconCircle, { backgroundColor: 'rgba(168,85,247,0.15)' }]}>
                  <Ionicons name="cloud-upload-outline" size={18} color="#a855f7" />
                </View>
                <Text style={styles.sheetTitle}>बैकअप और रीस्टोर</Text>
              </View>
              <TouchableOpacity onPress={() => { if (!backupLoading) setShowBackupModal(false); }}>
                <Ionicons name="close" size={22} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <Text style={styles.backupGuideText}>
              📁 <Text style={{ fontWeight: '700', color: '#f8fafc' }}>फ़ाइल कहाँ सेव होगी?{'\n'}</Text>
              निर्यात के बाद Share Sheet खुलेगी। &quot;Save to Downloads&quot; या &quot;Drive&quot; चुनें — सुरक्षित बैकअप तैयार रहेगा।
            </Text>

            {!!backupStatus && (
              <View style={styles.backupStatusBox}>
                <Text style={styles.backupStatusBoxText}>{backupStatus}</Text>
              </View>
            )}

            {backupLoading && (
              <View style={styles.backupLoadingRow}>
                <ActivityIndicator color="#f0a500" size="small" />
                <Text style={styles.backupLoadingRowText}>प्रतीक्षा करें...</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.backupActionTile, { backgroundColor: 'rgba(168,85,247,0.12)', borderColor: 'rgba(168,85,247,0.4)' }]}
              onPress={handleExport}
              disabled={backupLoading}
              activeOpacity={0.8}
            >
              <Ionicons name="cloud-upload-outline" size={22} color="#a855f7" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.backupActionTileTitle, { color: '#a855f7' }]}>डेटा निर्यात करें (Export)</Text>
                <Text style={styles.backupActionTileSub}>सभी पर्चियां JSON फ़ाइल में सेव करें</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.backupActionTile, { backgroundColor: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.35)' }]}
              onPress={() => handleImport('merge')}
              disabled={backupLoading}
              activeOpacity={0.8}
            >
              <Ionicons name="git-merge-outline" size={22} color="#22c55e" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.backupActionTileTitle, { color: '#22c55e' }]}>डेटा जोड़ें (Merge Import)</Text>
                <Text style={styles.backupActionTileSub}>बैकअप + मौजूदा डेटा — बिना डुप्लीकेट</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.backupActionTile, { backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.35)' }]}
              onPress={() => handleImport('replace')}
              disabled={backupLoading}
              activeOpacity={0.8}
            >
              <Ionicons name="refresh-circle-outline" size={22} color="#ef4444" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.backupActionTileTitle, { color: '#ef4444' }]}>⚠ डेटा बदलें (Replace)</Text>
                <Text style={styles.backupActionTileSub}>सावधान: मौजूदा डेटा हटाकर नया लोड होगा</Text>
              </View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ══ 9. EDIT TICKET MODAL ══ */}
      <Modal visible={!!editTicket} transparent animationType="slide" onRequestClose={() => setEditTicket(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.bottomSheetCard, { maxHeight: '92%' }]}>
              <View style={styles.dragHandle} />
              <View style={styles.sheetHeaderRow}>
                <View style={styles.sheetTitleGroup}>
                  <View style={[styles.sheetIconCircle, { backgroundColor: 'rgba(240,165,0,0.15)' }]}>
                    <Ionicons name="pencil" size={18} color="#f0a500" />
                  </View>
                  <Text style={styles.sheetTitle}>रिकॉर्ड संपादित करें</Text>
                </View>
                <TouchableOpacity onPress={() => setEditTicket(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={22} color="#94a3b8" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {/* Farmer Code - Locked */}
                <View style={styles.editField}>
                  <View style={styles.editFieldHeader}>
                    <Text style={styles.editFieldLabel}>किसान कोड / Farmer Code</Text>
                    <View style={styles.lockedPill}>
                      <Ionicons name="lock-closed" size={10} color="#f0a500" />
                      <Text style={styles.lockedPillText}>स्थिर कोड</Text>
                    </View>
                  </View>
                  <TextInput
                    style={[styles.editTextInput, styles.editTextInputDisabled]}
                    value={editForm.farmer_code}
                    editable={false}
                  />
                </View>

                {/* Name */}
                <View style={styles.editField}>
                  <Text style={styles.editFieldLabel}>नाम / Name</Text>
                  <TextInput
                    style={styles.editTextInput}
                    value={editForm.name}
                    onChangeText={val => setEditForm(prev => ({ ...prev, name: val }))}
                    placeholder="किसान का नाम"
                    placeholderTextColor="#475569"
                    autoCorrect={false}
                  />
                </View>

                {/* Father Name */}
                <View style={styles.editField}>
                  <Text style={styles.editFieldLabel}>पिता का नाम / Father Name</Text>
                  <TextInput
                    style={styles.editTextInput}
                    value={editForm.fatherName}
                    onChangeText={val => setEditForm(prev => ({ ...prev, fatherName: val }))}
                    placeholder="पिता का नाम"
                    placeholderTextColor="#475569"
                    autoCorrect={false}
                  />
                </View>

                {/* Cane Owner */}
                <View style={styles.editField}>
                  <View style={styles.editFieldHeader}>
                    <Text style={styles.editFieldLabel}>गन्ना मालिक / Cane Owner</Text>
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
                    style={styles.editTextInput}
                    value={editForm.caneOwner}
                    onChangeText={val => setEditForm(prev => ({ ...prev, caneOwner: val }))}
                    placeholder="मालिक का नाम या मेरा गन्ना"
                    placeholderTextColor="#475569"
                    autoCorrect={false}
                  />
                </View>

                {/* Date */}
                <View style={styles.editField}>
                  <View style={styles.editFieldHeader}>
                    <Text style={styles.editFieldLabel}>तारीख / Date (DD/MM/YYYY)</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TouchableOpacity
                        style={styles.dateShortcutChip}
                        onPress={() => setEditForm(prev => ({ ...prev, date: todayFormatted() }))}
                      >
                        <Text style={styles.dateShortcutChipText}>आज</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.dateShortcutChip}
                        onPress={() => setEditForm(prev => ({ ...prev, date: yesterdayFormatted() }))}
                      >
                        <Text style={styles.dateShortcutChipText}>कल</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <TextInput
                    style={styles.editTextInput}
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
                    placeholderTextColor="#475569"
                  />
                </View>

                {/* Quantity */}
                <View style={styles.editField}>
                  <Text style={styles.editFieldLabel}>मात्रा / Quantity (क्विंटल)</Text>
                  <TextInput
                    style={styles.editTextInput}
                    value={editForm.quantity}
                    onChangeText={val => setEditForm(prev => ({ ...prev, quantity: val.replace(/[^0-9.]/g, '') }))}
                    keyboardType="numeric"
                    placeholder="जैसे: 75.00"
                    placeholderTextColor="#475569"
                  />
                </View>

                {/* Comment */}
                <View style={styles.editField}>
                  <Text style={styles.editFieldLabel}>टिप्पणी / Comment (वैकल्पिक)</Text>
                  <TextInput
                    style={[styles.editTextInput, { height: 75, textAlignVertical: 'top' }]}
                    value={editForm.comment}
                    onChangeText={val => setEditForm(prev => ({ ...prev, comment: val }))}
                    multiline
                    placeholder="कोई टिप्पणी या नोट..."
                    placeholderTextColor="#475569"
                  />
                </View>
              </ScrollView>

              <View style={styles.sheetButtonRow}>
                <TouchableOpacity
                  style={[styles.sheetBtn, styles.sheetBtnCancel]}
                  onPress={() => setEditTicket(null)}
                >
                  <Text style={styles.sheetBtnCancelText}>रद्द करें</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sheetBtn, styles.sheetBtnSave]}
                  onPress={handleEditSave}
                >
                  <Text style={styles.sheetBtnSaveText}>सहेजें ✓</Text>
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
  safe: {
    flex: 1,
    backgroundColor: '#0d0d1a',
  },
  listContent: {
    paddingHorizontal: 14,
    paddingBottom: 95,
  },
  headerContainer: {
    paddingBottom: 8,
  },

  // ── Header Row ──
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginBottom: 8,
  },
  titleWithSeason: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    flex: 1,
  },
  appTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#f8fafc',
    letterSpacing: 0.3,
  },
  seasonInlineWrapper: {
    flexShrink: 1,
  },
  backupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(168,85,247,0.12)',
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.35)',
  },
  backupBtnText: {
    color: '#a855f7',
    fontSize: 12,
    fontWeight: '700',
  },

  // ── Summary Cards (3 horizontal) ──
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#16162a',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  summaryCardAmber: {
    borderColor: 'rgba(240,165,0,0.25)',
  },
  summaryCardCyan: {
    borderColor: 'rgba(6,182,212,0.25)',
  },
  summaryCardPurple: {
    borderColor: 'rgba(168,85,247,0.25)',
  },
  summaryValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginBottom: 2,
  },
  summaryIconBox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryNum: {
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  summaryLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
    textAlign: 'center',
  },

  // ── Rate Section: Compact clickable card ──
  rateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#16162a',
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.25)',
    marginBottom: 10,
  },
  rateLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rateIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(240,165,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateCurrencySymbol: {
    color: '#f0a500',
    fontSize: 16,
    fontWeight: '900',
  },
  rateTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
  },
  rateSubTitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '500',
  },
  rateRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rateValueBadge: {
    alignItems: 'flex-end',
  },
  rateValueText: {
    color: '#f0a500',
    fontSize: 14,
    fontWeight: '800',
  },
  rateTotalAmountSub: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '500',
    marginTop: 1,
  },
  rateSetBadge: {
    backgroundColor: 'rgba(240,165,0,0.1)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.3)',
  },
  rateSetText: {
    color: '#f0a500',
    fontSize: 12,
    fontWeight: '700',
  },

  // ── Mill Payment Tracker: Compact clickable card ──
  millCompactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#16162a',
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.25)',
    marginBottom: 12,
  },
  millLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  millIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(34,197,94,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  millTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
  },
  millSubTitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '500',
  },
  millRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  millActivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
  },
  millActiveDateText: {
    color: '#22c55e',
    fontSize: 11,
    fontWeight: '700',
  },

  // ── Search Section ──
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#16162a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#23233c',
    marginBottom: 4,
  },
  searchBoxListening: {
    borderColor: '#ef4444',
    backgroundColor: 'rgba(239,68,68,0.06)',
  },
  searchInput: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 14,
    paddingVertical: 2,
  },
  searchMicBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#0d0d1a',
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchMicBtnActive: {
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
  },
  searchHelperText: {
    color: '#64748b',
    fontSize: 11,
    marginBottom: 10,
    marginTop: 2,
    paddingLeft: 2,
  },

  // ── Filters Row ──
  filtersRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#16162a',
    borderRadius: 18,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#23233c',
    maxWidth: 160,
  },
  filterChipActiveGreen: {
    borderColor: 'rgba(34,197,94,0.5)',
    backgroundColor: 'rgba(34,197,94,0.08)',
  },
  filterChipActiveAmber: {
    borderColor: 'rgba(240,165,0,0.5)',
    backgroundColor: 'rgba(240,165,0,0.08)',
  },
  filterChipText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  clearFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 18,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
  },
  clearFilterText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '700',
  },
  activeTagRow: {
    backgroundColor: 'rgba(240,165,0,0.08)',
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.2)',
  },
  activeTagText: {
    color: '#94a3b8',
    fontSize: 11,
  },
  recordCountText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
    marginVertical: 4,
  },

  // ── Ticket / Farmer Cards ──
  ticketCard: {
    backgroundColor: '#16162a',
    borderRadius: 14,
    padding: 13,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#23233c',
  },
  ticketHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  ticketAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(240,165,0,0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(240,165,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ticketAvatarText: {
    color: '#f0a500',
    fontSize: 16,
    fontWeight: '900',
  },
  ticketInfo: {
    flex: 1,
  },
  farmerName: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  farmerFather: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 1,
  },
  farmerCode: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  ticketActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnWhatsApp: {
    backgroundColor: 'rgba(34,197,94,0.1)',
  },
  actionBtnEdit: {
    backgroundColor: 'rgba(240,165,0,0.1)',
  },
  actionBtnDelete: {
    backgroundColor: 'rgba(239,68,68,0.1)',
  },

  // Card Badges Row
  ticketMetricsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  metricBadgeDate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(240,165,0,0.1)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.25)',
  },
  metricDateText: {
    color: '#f0a500',
    fontSize: 12,
    fontWeight: '700',
  },
  metricBadgeQty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(6,182,212,0.1)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(6,182,212,0.25)',
  },
  metricQtyText: {
    color: '#06b6d4',
    fontSize: 12,
    fontWeight: '800',
  },
  ownerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.25)',
    maxWidth: 130,
  },
  ownerBadgeText: {
    color: '#22c55e',
    fontSize: 11,
    fontWeight: '700',
  },
  payBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
  },
  payBadgePaid: {
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderColor: 'rgba(34,197,94,0.3)',
  },
  payBadgePending: {
    backgroundColor: 'rgba(240,165,0,0.1)',
    borderColor: 'rgba(240,165,0,0.3)',
  },
  payBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  editedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(168,85,247,0.1)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 7,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.25)',
  },
  editedBadgeText: {
    color: '#a855f7',
    fontSize: 10,
    fontWeight: '700',
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 6,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 8,
    padding: 8,
  },
  commentText: {
    flex: 1,
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 16,
  },
  ticketTime: {
    color: '#475569',
    fontSize: 10,
    marginTop: 2,
  },

  // ── Empty State ──
  emptyState: {
    alignItems: 'center',
    paddingVertical: 50,
  },
  emptyTitle: {
    color: '#64748b',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 12,
  },
  emptySubtitle: {
    color: '#475569',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 240,
  },

  // ── Bottom Sheet & Modal Shared Styles ──
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  bottomSheetCard: {
    backgroundColor: '#16162a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderColor: '#23233c',
  },
  dragHandle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#334155',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sheetTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sheetIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
  },
  sheetSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 16,
  },

  // Rate Sheet Specifics
  currentRateNotice: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(240,165,0,0.1)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.25)',
    marginBottom: 16,
  },
  currentRateText: {
    color: '#f8fafc',
    fontSize: 13,
  },
  clearRateText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '700',
  },
  rateInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d0d1a',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(240,165,0,0.4)',
    marginBottom: 14,
  },
  rateInputPrefix: {
    color: '#f0a500',
    fontSize: 22,
    fontWeight: '900',
    marginRight: 6,
  },
  rateNumericInput: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '900',
  },
  rateInputSuffix: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
  },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  presetLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
  },
  presetChip: {
    backgroundColor: '#0d0d1a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#23233c',
  },
  presetChipActive: {
    borderColor: '#f0a500',
    backgroundColor: 'rgba(240,165,0,0.12)',
  },
  presetChipText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  presetChipActiveText: {
    color: '#f0a500',
  },
  sheetButtonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  sheetBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBtnCancel: {
    backgroundColor: '#23233c',
  },
  sheetBtnCancelText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '700',
  },
  sheetBtnSave: {
    backgroundColor: '#f0a500',
  },
  sheetBtnSaveText: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '800',
  },
  sheetBtnOutline: {
    backgroundColor: 'rgba(240,165,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.4)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sheetBtnOutlineText: {
    color: '#f0a500',
    fontSize: 14,
    fontWeight: '700',
  },

  // Mill Actions Sheet (2 large buttons)
  millActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#0d0d1a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#23233c',
    marginBottom: 12,
  },
  millActionIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  millActionTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 2,
  },
  millActionSub: {
    color: '#94a3b8',
    fontSize: 12,
  },
  millStatusFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#23233c',
  },
  millStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  millStatusPillText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  clearDateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearDateBtnText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },

  // Mill Breakdown Grid (Option A)
  millBreakdownGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  millGridCard: {
    flex: 1,
    backgroundColor: '#0d0d1a',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
  },
  millGridLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 4,
    textAlign: 'center',
  },
  millGridValue: {
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
  },
  millGridSub: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
  },
  hintNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(240,165,0,0.08)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.2)',
  },
  hintNoticeText: {
    flex: 1,
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 16,
  },

  // Date Setting Input (Option B & Date Filter)
  dateInputField: {
    backgroundColor: '#0d0d1a',
    borderRadius: 12,
    padding: 14,
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
    borderWidth: 1.5,
    borderColor: '#23233c',
    textAlign: 'center',
    letterSpacing: 2,
    marginBottom: 4,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    marginBottom: 4,
  },
  inputHelperText: {
    color: '#64748b',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 16,
  },

  // Pickers (Names & Owners list)
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#23233c',
  },
  pickerItemActive: {
    backgroundColor: 'rgba(240,165,0,0.04)',
  },
  pickerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#23233c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerAvatarText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '800',
  },
  pickerItemText: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '700',
  },
  pickerItemSub: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2,
  },
  pickerCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#334155',
    backgroundColor: '#0d0d1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCheckboxActiveAmber: {
    backgroundColor: '#f0a500',
    borderColor: '#f0a500',
  },
  pickerCheckboxActiveGreen: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e',
  },
  sheetConfirmBtn: {
    backgroundColor: '#f0a500',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
  },
  sheetConfirmBtnText: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '800',
  },

  // Backup Sheet Styles
  backupGuideText: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    padding: 12,
  },
  backupStatusBox: {
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  backupStatusBoxText: {
    color: '#22c55e',
    fontSize: 12,
    fontWeight: '700',
  },
  backupLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  backupLoadingRowText: {
    color: '#f0a500',
    fontSize: 12,
  },
  backupActionTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  backupActionTileTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  backupActionTileSub: {
    color: '#64748b',
    fontSize: 11,
  },

  // Edit Ticket Modal
  editField: {
    marginBottom: 14,
  },
  editFieldHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  editFieldLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  lockedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(240,165,0,0.1)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.3)',
  },
  lockedPillText: {
    color: '#f0a500',
    fontSize: 10,
    fontWeight: '700',
  },
  editTextInput: {
    backgroundColor: '#0d0d1a',
    borderRadius: 10,
    padding: 12,
    color: '#f8fafc',
    fontSize: 15,
    borderWidth: 1.5,
    borderColor: '#23233c',
  },
  editTextInputDisabled: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderColor: 'rgba(255,255,255,0.06)',
    color: '#64748b',
  },
  quickOwnerChip: {
    paddingHorizontal: 9,
    paddingVertical: 2,
    borderRadius: 12,
    backgroundColor: '#0d0d1a',
    borderWidth: 1,
    borderColor: '#23233c',
  },
  quickOwnerChipActive: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34,197,94,0.1)',
  },
  quickOwnerChipText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  quickOwnerChipActiveText: {
    color: '#22c55e',
  },
  dateShortcutChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: '#0d0d1a',
    borderWidth: 1,
    borderColor: '#23233c',
  },
  dateShortcutChipText: {
    color: '#f0a500',
    fontSize: 11,
    fontWeight: '700',
  },
});
