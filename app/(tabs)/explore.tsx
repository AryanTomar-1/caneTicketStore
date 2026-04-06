import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  Alert,
  SafeAreaView,
  RefreshControl,
  Animated,
  PanResponder,
  ListRenderItem,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { getAllTickets, deleteTicket, formatDateTime } from '../../utils/storage';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Ticket {
  id: string;
  name: string;
  fatherName: string;
  date: string;
  quantity: string | number;
  comment?: string;
  createdAt: string;
}

const formatDateInput = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function DashboardScreen(): React.ReactElement {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filtered, setFiltered] = useState<Ticket[]>([]);
  const [searchText, setSearchText] = useState<string>('');
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [uniqueNames, setUniqueNames] = useState<string[]>([]);
  const [showNamesModal, setShowNamesModal] = useState<boolean>(false);
  const [filterDate, setFilterDate] = useState<string>('');
  const [showDateInput, setShowDateInput] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [lastLoaded, setLastLoaded] = useState<number>(0);
  const [isSearchListening, setIsSearchListening] = useState<boolean>(false);

  const micPulseAnim = useRef<Animated.Value>(new Animated.Value(1)).current;
  const micPulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  // ── STT for search box ────────────────────────────────────────────────────
  useSpeechRecognitionEvent('start', () => setIsSearchListening(true));
  useSpeechRecognitionEvent('end', () => { setIsSearchListening(false); stopMicPulse(); });
  useSpeechRecognitionEvent('result', (event) => {
    const result = event.results[0]?.transcript ?? '';
    if (result) handleSearch(result);
  });
  useSpeechRecognitionEvent('error', () => { setIsSearchListening(false); stopMicPulse(); });

  // ── Mic pulse ─────────────────────────────────────────────────────────────
  const startMicPulse = () => {
    micPulseLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(micPulseAnim, { toValue: 1.3, duration: 400, useNativeDriver: true }),
      Animated.timing(micPulseAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]));
    micPulseLoop.current.start();
  };
  const stopMicPulse = () => { micPulseLoop.current?.stop(); micPulseAnim.setValue(1); };

  const startSearchListening = async (): Promise<void> => {
    try {
      const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!granted) return;
      ExpoSpeechRecognitionModule.start({ lang: 'hi-IN', interimResults: true });
      startMicPulse();
    } catch (e) { console.error('Search STT error:', e); }
  };

  const stopSearchListening = (): void => {
    ExpoSpeechRecognitionModule.stop();
    setIsSearchListening(false);
    stopMicPulse();
  };

  // Hold-to-record PanResponder for search mic
  const searchMicResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => startSearchListening(),
    onPanResponderRelease: () => stopSearchListening(),
    onPanResponderTerminate: () => stopSearchListening(),
  });

  // ── Data loading ──────────────────────────────────────────────────────────
  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    const interval = setInterval(() => setLastLoaded(Date.now()), 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { loadData(); }, [lastLoaded]);

  const loadData = async (): Promise<void> => {
    const data: Ticket[] = await getAllTickets();
    setTickets(data);
    const names = [...new Set(data.map(t => t.name))].sort();
    setUniqueNames(names);
    applyFilters(data, searchText, selectedName, filterDate);
  };

  const applyFilters = (data: Ticket[], search: string, name: string | null, date: string): void => {
    let result = [...data];
    if (name) result = result.filter(t => t.name === name);
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(t =>
        t.name?.toLowerCase().includes(q) ||
        t.fatherName?.toLowerCase().includes(q) ||
        t.comment?.toLowerCase().includes(q)
      );
    }
    if (date.trim()) result = result.filter(t => t.date?.includes(date.trim()));
    setFiltered(result);
  };

  const handleSearch = (text: string): void => {
    setSearchText(text);
    applyFilters(tickets, text, selectedName, filterDate);
  };

  const handleSelectName = (name: string | null): void => {
    const newName = selectedName === name ? null : name;
    setSelectedName(newName);
    setShowNamesModal(false);
    applyFilters(tickets, searchText, newName, filterDate);
  };

  const handleDateFilter = (date: string): void => {
    const formatted = formatDateInput(date);
    setFilterDate(formatted);
    applyFilters(tickets, searchText, selectedName, formatted);
  };

  const clearFilters = (): void => {
    setSearchText(''); setSelectedName(null); setFilterDate('');
    setShowDateInput(false); setFiltered(tickets);
  };

  const handleDelete = (id: string, name: string): void => {
    Alert.alert(
      'Delete Record / रिकॉर्ड हटाएं',
      `Delete ticket for "${name}"?\n"${name}" का टिकट हटाएं?`,
      [
        { text: 'Cancel / रद्द करें', style: 'cancel' },
        { text: 'Delete / हटाएं', style: 'destructive', onPress: async () => { await deleteTicket(id); loadData(); } },
      ]
    );
  };

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const totalQty = filtered.reduce((sum, t) => sum + (parseFloat(String(t.quantity)) || 0), 0);
  const hasFilters = searchText || selectedName || filterDate;

  const renderTicket: ListRenderItem<Ticket> = ({ item }) => (
    <View style={styles.ticketCard}>
      <View style={styles.ticketHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{item.name ? item.name.charAt(0).toUpperCase() : '?'}</Text>
        </View>
        <View style={styles.ticketInfo}>
          <Text style={styles.ticketName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.ticketFather} numberOfLines={1}>पिता: {item.fatherName}</Text>
        </View>
        <TouchableOpacity onPress={() => handleDelete(item.id, item.name)} style={styles.deleteBtn}>
          <Ionicons name="trash-outline" size={18} color="#e74c3c" />
        </TouchableOpacity>
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
      </View>

      {/* Comment row */}
      <View style={styles.commentRow}>
        <Text style={styles.commentText}>Comment</Text>
        <Ionicons name="chatbubble-outline" size={12} color="#888" />
        <Text style={styles.commentText} >{item.comment}</Text>
      </View>

      <Text style={styles.ticketTime}>Added: {formatDateTime(item.createdAt)}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.stateBox} >
        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { borderColor: 'rgba(240,165,0,0.4)' }]}>
            <Text style={[styles.statNum, { color: '#f0a500' }]}>{filtered.length}</Text>
            <Text style={styles.statLabel}>टिकट / Tickets</Text>
          </View>
          <View style={[styles.statCard, { borderColor: 'rgba(6,182,212,0.4)' }]}>
            <Text style={[styles.statNum, { color: '#06b6d4' }]}>{totalQty.toFixed(2)}</Text>
            <Text style={styles.statLabel}>क्विंटल / Qty</Text>
          </View>
          <View style={[styles.statCard, { borderColor: 'rgba(139,92,246,0.4)' }]}>
            <Text style={[styles.statNum, { color: '#8b5cf6' }]}>{uniqueNames.length}</Text>
            <Text style={styles.statLabel}>नाम / Names</Text>
          </View>
        </View>

        {/* ── Search box with mic ── */}
        <View style={[styles.searchBox, isSearchListening && styles.searchBoxListening]}>
          <Ionicons name="search" size={16} color={isSearchListening ? '#e74c3c' : '#888'} />
          <TextInput
            style={styles.searchInput}
            value={searchText}
            onChangeText={handleSearch}
            placeholder={isSearchListening ? 'सुन रहा है... / Listening...' : 'नाम खोजें / Search name...'}
            placeholderTextColor={isSearchListening ? '#e74c3c' : '#555'}
            autoCorrect={false}
          />
          {searchText ? (
            <TouchableOpacity onPress={() => handleSearch('')}>
              <Ionicons name="close-circle" size={16} color="#888" />
            </TouchableOpacity>
          ) : null}

          {/* Mic button — hold to record */}
          <Animated.View style={{ transform: [{ scale: micPulseAnim }] }}>
            <View
              {...searchMicResponder.panHandlers}
              style={[styles.searchMicBtn, isSearchListening && styles.searchMicBtnActive]}
            >
              <Ionicons
                name={isSearchListening ? 'mic' : 'mic-outline'}
                size={16}
                color={isSearchListening ? '#fff' : '#f0a500'}
              />
            </View>
          </Animated.View>
        </View>

        {/* Hold hint */}
        <View style={styles.holdHintRow}>
          <Ionicons name="information-circle-outline" size={12} color="#444" />
          <Text style={styles.holdHintText}>Hold mic to search by voice / माइक दबाकर बोलें</Text>
        </View>

        {/* Filters */}
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, selectedName && styles.filterChipOn]}
            onPress={() => setShowNamesModal(true)}
          >
            <Ionicons name="person-outline" size={13} color={selectedName ? '#f0a500' : '#888'} />
            <Text style={[styles.filterChipText, selectedName && { color: '#f0a500' }]} numberOfLines={1}>
              {selectedName || 'Filter Name / नाम'}
            </Text>
            <Ionicons name="chevron-down" size={12} color={selectedName ? '#f0a500' : '#888'} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterChip, filterDate && styles.filterChipOn]}
            onPress={() => setShowDateInput(!showDateInput)}
          >
            <Ionicons name="calendar-outline" size={13} color={filterDate ? '#f0a500' : '#888'} />
            <Text style={[styles.filterChipText, filterDate && { color: '#f0a500' }]}>
              {filterDate || 'Date / तारीख'}
            </Text>
          </TouchableOpacity>

          {hasFilters ? (
            <TouchableOpacity style={styles.clearChip} onPress={clearFilters}>
              <Ionicons name="close" size={13} color="#e74c3c" />
              <Text style={styles.clearChipText}>Clear</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Date Input */}
        {showDateInput && (
          <View style={styles.dateInputRow}>
            <Ionicons name="calendar" size={15} color="#f0a500" />
            <TextInput
              style={styles.dateInput}
              value={filterDate}
              onChangeText={handleDateFilter}
              placeholder="e.g. 2024 or 03/2024"
              placeholderTextColor="#555"
              keyboardType="numeric"
              autoFocus
            />
            {filterDate ? (
              <TouchableOpacity onPress={() => { handleDateFilter(''); setShowDateInput(false); }}>
                <Ionicons name="close-circle" size={16} color="#888" />
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {selectedName && (
          <View style={styles.activeTag}>
            <Text style={styles.activeTagText}>
              Showing: <Text style={{ color: '#f0a500', fontWeight: '700' }}>{selectedName}</Text>
            </Text>
          </View>
        )}

        <Text style={styles.resultsLabel}>
          {filtered.length} Record{filtered.length !== 1 ? 's' : ''} / रिकॉर्ड
        </Text>
      </View>
      <FlatList<Ticket>
        data={filtered}
        keyExtractor={item => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f0a500" colors={['#f0a500']} />
        }
        renderItem={renderTicket}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="document-outline" size={55} color="#2d2d4e" />
            <Text style={styles.emptyTitle}>कोई रिकॉर्ड नहीं</Text>
            <Text style={styles.emptySubtitle}>
              {hasFilters ? 'Try different filters' : 'Add your first ticket using the mic tab'}
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />

      {/* Names Bottom Modal */}
      <Modal visible={showNamesModal} transparent animationType="slide">
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowNamesModal(false)}>
          <View style={styles.namesSheet}>
            <View style={styles.namesHeader}>
              <Text style={styles.namesTitle}>👤 नाम चुनें / Select Name</Text>
              <TouchableOpacity onPress={() => setShowNamesModal(false)}>
                <Ionicons name="close" size={22} color="#888" />
              </TouchableOpacity>
            </View>
            <ScrollView>
              <TouchableOpacity
                style={[styles.nameItem, !selectedName && styles.nameItemOn]}
                onPress={() => handleSelectName(null)}
              >
                <Text style={[styles.nameItemText, !selectedName && { color: '#f0a500' }]}>All / सभी नाम</Text>
                {!selectedName && <Ionicons name="checkmark" size={16} color="#f0a500" />}
              </TouchableOpacity>
              {uniqueNames.map(name => {
                const count = tickets.filter(t => t.name === name).length;
                const qty = tickets.filter(t => t.name === name).reduce((s, t) => s + (parseFloat(String(t.quantity)) || 0), 0);
                return (
                  <TouchableOpacity
                    key={name}
                    style={[styles.nameItem, selectedName === name && styles.nameItemOn]}
                    onPress={() => handleSelectName(name)}
                  >
                    <View style={styles.nameAvatar}>
                      <Text style={[styles.nameAvatarText, selectedName === name && { color: '#f0a500' }]}>
                        {name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.nameItemText, selectedName === name && { color: '#f0a500' }]}>{name}</Text>
                      <Text style={styles.nameItemSub}>{count} tickets · {qty.toFixed(2)} क्विंटल</Text>
                    </View>
                    {selectedName === name && <Ionicons name="checkmark" size={16} color="#f0a500" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1e',top:40 },
  listContent: { padding: 14, paddingBottom: 30 },

  stateBox: {marginLeft:10, marginRight:10},
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  statCard: { flex: 1, backgroundColor: '#1a1a2e', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1 },
  statNum: { fontSize: 22, fontWeight: '900' },
  statLabel: { color: '#666', fontSize: 9, fontWeight: '600', textAlign: 'center', marginTop: 2 },

  // Search box
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1a1a2e', borderRadius: 10, padding: 11, borderWidth: 1, borderColor: '#2d2d4e', marginBottom: 6 },
  searchBoxListening: { borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.05)' },
  searchInput: { flex: 1, color: '#f0f0f0', fontSize: 14 },

  // Search mic button
  searchMicBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#0f0f1e', borderWidth: 1, borderColor: 'rgba(240,165,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  searchMicBtnActive: { backgroundColor: '#e74c3c', borderColor: '#e74c3c' },

  holdHintRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 },
  holdHintText: { color: '#444', fontSize: 10 },

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

  ticketCard: { backgroundColor: '#1a1a2e', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#2d2d4e' },
  ticketHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(240,165,0,0.15)', borderWidth: 1.5, borderColor: 'rgba(240,165,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#f0a500', fontSize: 16, fontWeight: '800' },
  ticketInfo: { flex: 1 },
  ticketName: { color: '#f0f0f0', fontSize: 15, fontWeight: '700' },
  ticketFather: { color: '#888', fontSize: 11, marginTop: 2 },
  deleteBtn: { padding: 5 },

  badgeRow: { flexDirection: 'row', gap: 7, marginBottom: 8 },
  badgeDate: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(240,165,0,0.1)', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: 'rgba(240,165,0,0.25)' },
  badgeDateText: { color: '#f0a500', fontSize: 11, fontWeight: '700' },
  badgeQty: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(6,182,212,0.1)', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: 'rgba(6,182,212,0.25)' },
  badgeQtyText: { color: '#06b6d4', fontSize: 11, fontWeight: '700' },

  commentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 6, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: 7 },
  commentText: { flex: 1, color: '#888', fontSize: 11, lineHeight: 16 },

  ticketTime: { color: '#444', fontSize: 10 },

  emptyState: { alignItems: 'center', paddingVertical: 50 },
  emptyTitle: { color: '#555', fontSize: 16, fontWeight: '700', marginTop: 14 },
  emptySubtitle: { color: '#444', fontSize: 12, textAlign: 'center', marginTop: 6 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  namesSheet: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, maxHeight: '70%', borderTopWidth: 1, borderColor: '#2d2d4e' },
  namesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  namesTitle: { color: '#f0f0f0', fontSize: 16, fontWeight: '700' },
  nameItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  nameItemOn: { backgroundColor: 'rgba(240,165,0,0.05)' },
  nameAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#2d2d4e', alignItems: 'center', justifyContent: 'center' },
  nameAvatarText: { color: '#888', fontSize: 13, fontWeight: '800' },
  nameItemText: { color: '#ccc', fontSize: 14, fontWeight: '600' },
  nameItemSub: { color: '#555', fontSize: 10, marginTop: 1 },
});
