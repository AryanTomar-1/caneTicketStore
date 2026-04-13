import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  FlatList, Modal, Alert, RefreshControl, Animated, PanResponder,
  Share, Linking, ListRenderItem,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { getAllTickets, deleteTicket, updateTicket, formatDateTime, checkDuplicate } from '../../utils/storage';
import { formatDateInput, isValidDate } from '../../utils/dateHelpers';
import { useMicPulse } from '../../hooks/useMicPulse';
import { Ticket } from '../../types';
import SeasonSelector from '../../components/SeasonSelector';
import { useSeason } from '../../context/SeasonContext';

// ─── Component ───────────────────────────────────────────────────────────────

export default function DashboardScreen(): React.ReactElement {
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
  const { selectedSeason } = useSeason(); // import from context

  const [selectedOwners, setSelectedOwners] = useState<string[]>([]);
  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const [uniqueOwners, setUniqueOwners] = useState<string[]>([]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalQty = filtered.reduce((sum, t) => sum + (parseFloat(String(t.quantity)) || 0), 0);
  const hasFilters = searchText || selectedNames.length > 0 || selectedOwners.length > 0 || filterDate;
  const [pricePerQty, setPricePerQty] = useState<string>('');
  const totalAmount = pricePerQty ? (totalQty * parseFloat(pricePerQty)).toFixed(2) : null;

  // Edit modal
  const [editTicket, setEditTicket] = useState<Ticket | null>(null);
  const [editForm, setEditForm] = useState({ name: '', fatherName: '', date: '', quantity: '', comment: '' });

  const mic = useMicPulse();

  // ── STT for search ────────────────────────────────────────────────────────
  useSpeechRecognitionEvent('start', () => setIsSearchListening(true));
  useSpeechRecognitionEvent('end', () => { setIsSearchListening(false); mic.stop(); });
  useSpeechRecognitionEvent('result', (event) => {
    const result = event.results[0]?.transcript ?? '';
    if (result) handleSearch(result);
  });
  useSpeechRecognitionEvent('error', () => { setIsSearchListening(false); mic.stop(); });

  const startSearchListening = async (): Promise<void> => {
    try {
      const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!granted) return;
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

  // ── Data ──────────────────────────────────────────────────────────────────
  // Replace the deleted useEffects with this one:
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [selectedSeason]) // reload when season changes too
  );

  const loadData = async () => {
    let data = await getAllTickets();
    setUniqueOwners([...new Set(data.map(t => t.caneOwner).filter(Boolean))].sort());
    if (selectedOwners.length > 0) {
      data = data.filter(t => selectedOwners.includes(t.caneOwner));
    }
    setTickets(data);
    setUniqueNames([...new Set(data.map(t => t.name))].sort());
    applyFilters(data, searchText, selectedNames, filterDate);
  };

  const applyFilters = (data: Ticket[], search: string, names: string[], date: string) => {
    let result = [...data];
    // Filter by multiple selected names (OR logic)
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
    applyFilters(tickets, text, selectedNames, filterDate);
  };

  const handleSelectOwner = (owner: string | null) => {
    if (owner === null) {
      setSelectedOwners([]);
      setShowOwnerModal(false);
      return;
    }
    const newOwners = selectedOwners.includes(owner)
      ? selectedOwners.filter(o => o !== owner)
      : [...selectedOwners, owner];
    setSelectedOwners(newOwners);
  };

  const handleSelectName = (name: string | null) => {
    if (name === null) {
      // Clear all
      setSelectedNames([]);
      setShowNamesModal(false);
      applyFilters(tickets, searchText, [], filterDate);
      return;
    }
    const newNames = selectedNames.includes(name)
      ? selectedNames.filter(n => n !== name)  // deselect
      : [...selectedNames, name];               // select
    setSelectedNames(newNames);
    applyFilters(tickets, searchText, newNames, filterDate);
    // Don't close modal so user can select more
  };

  const handleDateFilter = (date: string) => {
    const fmt = formatDateInput(date);
    setFilterDate(fmt);
    applyFilters(tickets, searchText, selectedNames, fmt);
  };

  const clearFilters = () => {
    setSearchText(''); setSelectedNames([]); setFilterDate('');
    setSelectedOwners([]);
    setShowDateInput(false); setFiltered(tickets);
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = (id: string, name: string) => {
    Alert.alert(
      'रिकॉर्ड हटाएं / Delete',
      `"${name}" का टिकट हटाएं?`,
      [
        { text: 'रद्द करें', style: 'cancel' },
        { text: 'हटाएं', style: 'destructive', onPress: async () => { await deleteTicket(id); loadData(); } },
      ]
    );
  };

  // ── Edit ──────────────────────────────────────────────────────────────────
  const openEdit = (ticket: Ticket) => {
    setEditTicket(ticket);
    setEditForm({
      name: ticket.name,
      fatherName: ticket.fatherName,
      date: ticket.date,
      quantity: String(ticket.quantity),
      comment: ticket.comment ?? '',
    });
  };

  const handleEditSave = async () => {
    if (!editTicket) return;
    const { name, fatherName, date, quantity, comment } = editForm;

    if (!name.trim() || !fatherName.trim() || !date.trim() || !quantity.trim()) {
      Alert.alert('आवश्यक', 'सभी फ़ील्ड भरें।'); return;
    }
    if (!isValidDate(date)) { Alert.alert('गलत तारीख', 'DD/MM/YYYY format में दर्ज करें।'); return; }
    if (isNaN(parseFloat(quantity))) { Alert.alert('गलत मात्रा', 'सही संख्या दर्ज करें।'); return; }

    // Duplicate check (exclude current ticket)
    const dup = await checkDuplicate(name, date, editTicket.id);
    if (dup) {
      Alert.alert('डुप्लीकेट', `"${name}" का ${date} को रिकॉर्ड पहले से मौजूद है।`); return;
    }

    await updateTicket(editTicket.id, {
      name: name.trim(),
      fatherName: fatherName.trim(),
      date: date.trim(),
      quantity: parseFloat(quantity),
      comment: comment.trim(),
    });
    setEditTicket(null);
    loadData();
  };

  // ── WhatsApp share ────────────────────────────────────────────────────────
  const shareOnWhatsApp = (ticket: Ticket) => {
    const msg =
      `🌾 *गन्ना टिकट / Cane Ticket*\n` +
      `👤 नाम: ${ticket.name}\n` +
      `👨 पिता: ${ticket.fatherName}\n` +
      `📅 तारीख: ${ticket.date}\n` +
      `⚖️ मात्रा: ${parseFloat(String(ticket.quantity)).toFixed(2)} क्विंटल` +
      (ticket.comment ? `\n📝 टिप्पणी: ${ticket.comment}` : '') +
      `\n\n_${formatDateTime(ticket.createdAt)}_`;

    const url = `whatsapp://send?text=${encodeURIComponent(msg)}`;
    Linking.canOpenURL(url).then(supported => {
      if (supported) {
        Linking.openURL(url);
      } else {
        // Fallback to system share
        Share.share({ message: msg });
      }
    });
  };

  // ── Ticket card ───────────────────────────────────────────────────────────
  const renderTicket: ListRenderItem<Ticket> = ({ item }) => (
    <View style={styles.ticketCard}>
      <View style={styles.ticketHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{item.name?.charAt(0).toUpperCase() ?? '?'}</Text>
        </View>
        <View style={styles.ticketInfo}>
          <Text style={styles.ticketName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.ticketFather} numberOfLines={1}>पिता: {item.fatherName}</Text>
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

      <Text style={styles.ticketTime}>Added: {formatDateTime(item.createdAt)}</Text>
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Header section */}
        <View style={styles.header}>
          {/* Season selector row */}
          <View style={styles.seasonRow}>
            <Text style={styles.seasonRowLabel}>चालू सीजन:</Text>
            <SeasonSelector /> {/* no props needed */}
          </View>
          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { borderColor: 'rgba(240,165,0,0.4)' }]}>
              <Text style={[styles.statNum, { color: '#f0a500' }]}>{filtered.length}</Text>
              <Text style={styles.statLabel}>टिकट</Text>
            </View>
            <View style={[styles.statCard, { borderColor: 'rgba(6,182,212,0.4)' }]}>
              <Text style={[styles.statNum, { color: '#06b6d4' }]}>{totalQty.toFixed(2)}</Text>
              <Text style={styles.statLabel}>क्विंटल</Text>
            </View>
            <View style={[styles.statCard, { borderColor: 'rgba(139,92,246,0.4)' }]}>
              <Text style={[styles.statNum, { color: '#8b5cf6' }]}>{uniqueNames.length}</Text>
              <Text style={styles.statLabel}>नाम</Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={[styles.statCard, styles.priceCard, { borderColor: 'rgba(240,165,0,0.4)' }]}>
              <TextInput
                style={styles.priceInput}
                value={pricePerQty}
                onChangeText={setPricePerQty}
                placeholder="₹/क्विं"
                placeholderTextColor="#555"
                keyboardType="numeric"
              />
              <Text style={styles.statLabel}>दर / Rate</Text>
            </View>
            {totalAmount && (
              <View style={styles.totalAmountCard}>
                <View style={styles.totalAmountLeft}>
                  <Text style={styles.totalAmountLabel}>कुल राशि / Total Amount</Text>
                  <Text style={styles.totalAmountSub}>
                    {totalQty.toFixed(2)} क्विं × ₹{pricePerQty}
                  </Text>
                </View>
                <Text style={styles.totalAmountValue}>₹{totalAmount}</Text>
              </View>
            )}
          </View>

          {/* Search + mic */}
          <View style={[styles.searchBox, isSearchListening && styles.searchBoxListening]}>
            <Ionicons name="search" size={16} color={isSearchListening ? '#e74c3c' : '#888'} />
            <TextInput
              style={styles.searchInput}
              value={searchText}
              onChangeText={handleSearch}
              placeholder={isSearchListening ? 'सुन रहा है...' : 'नाम खोजें / किसान कोड / Search...'}
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
          <Text style={styles.holdHint}>📌 माइक दबाकर रखें / Hold mic to search</Text>

          {/* Filters */}
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterChip, selectedOwners.length > 0 && styles.filterChipOn]}
              onPress={() => setShowOwnerModal(true)}
            >
              <Ionicons name="leaf-outline" size={13} color={selectedOwners.length > 0 ? '#2ecc71' : '#888'} />
              <Text style={[styles.filterChipText, selectedOwners.length > 0 && { color: '#2ecc71' }]} numberOfLines={1}>
                {selectedOwners.length === 0
                  ? 'मालिक / Owner'
                  : selectedOwners.length === 1
                    ? selectedOwners[0]
                    : `${selectedOwners.length} मालिक`}
              </Text>
              <Ionicons name="chevron-down" size={12} color={selectedOwners.length > 0 ? '#2ecc71' : '#888'} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.filterChip, selectedNames.length > 0 && styles.filterChipOn]}
              onPress={() => setShowNamesModal(true)}
            >
              <Ionicons name="person-outline" size={13} color={selectedNames.length > 0 ? '#f0a500' : '#888'} />
              <Text style={[styles.filterChipText, selectedNames.length > 0 && { color: '#f0a500' }]} numberOfLines={1}>
                {selectedNames.length === 0
                  ? 'नाम चुनें'
                  : selectedNames.length === 1
                    ? selectedNames[0]
                    : `${selectedNames.length} नाम चुने`}
              </Text>
              <Ionicons name="chevron-down" size={12} color={selectedNames.length > 0 ? '#f0a500' : '#888'} />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.filterChip, filterDate && styles.filterChipOn]}
              onPress={() => setShowDateInput(!showDateInput)}>
              <Ionicons name="calendar-outline" size={13} color={filterDate ? '#f0a500' : '#888'} />
              <Text style={[styles.filterChipText, filterDate && { color: '#f0a500' }]}>
                {filterDate || 'तारीख'}
              </Text>
            </TouchableOpacity>

            {hasFilters ? (
              <TouchableOpacity style={styles.clearChip} onPress={clearFilters}>
                <Ionicons name="close" size={13} color="#e74c3c" />
                <Text style={styles.clearChipText}>Clear</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {showDateInput && (
            <View style={styles.dateInputRow}>
              <Ionicons name="calendar" size={15} color="#f0a500" />
              <TextInput style={styles.dateInput} value={filterDate} onChangeText={handleDateFilter}
                placeholder="e.g. 2024 or 03/2024" placeholderTextColor="#555" keyboardType="numeric" autoFocus />
              {filterDate ? (
                <TouchableOpacity onPress={() => { handleDateFilter(''); setShowDateInput(false); }}>
                  <Ionicons name="close-circle" size={16} color="#888" />
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          {selectedNames && selectedNames.length > 0 && (
            <View style={styles.activeTag}>
              <Text style={styles.activeTagText}>
                दिखा रहे:{" "}
                {selectedNames.map((name, index) => (
                  <Text key={index} style={{ color: '#f0a500', fontWeight: '700' }}>
                    {name}
                    {index !== selectedNames.length - 1 ? ', ' : ''}
                  </Text>
                ))}
              </Text>
            </View>
          )}

          <Text style={styles.resultsLabel}>
            {filtered.length} रिकॉर्ड / Record{filtered.length !== 1 ? 's' : ''}
          </Text>
        </View>

        {/* List */}
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

      {/* ── Names Modal ── */}
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
                style={[styles.nameItem, selectedNames.length === 0 && styles.nameItemOn]}
                onPress={() => handleSelectName(null)}
              >
                <Text style={[styles.nameItemText, selectedNames.length === 0 && { color: '#f0a500' }]}>
                  All / सभी नाम
                </Text>
                {selectedNames.length === 0 && <Ionicons name="checkmark" size={16} color="#f0a500" />}
              </TouchableOpacity>
              {uniqueNames.map(name => {
                const count = tickets.filter(t => t.name === name).length;
                const qty = tickets.filter(t => t.name === name)
                  .reduce((s, t) => s + (parseFloat(String(t.quantity)) || 0), 0);
                return (
                  <TouchableOpacity key={name}
                    style={[styles.nameItem, selectedNames.includes(name) && styles.nameItemOn]}
                    onPress={() => handleSelectName(name)}>
                    <View style={styles.nameAvatar}>
                      <Text style={[styles.nameAvatarText, selectedNames.includes(name) && { color: '#f0a500' }]}>
                        {name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.nameItemText, selectedNames.includes(name) && { color: '#f0a500' }]}>{name}</Text>
                      <Text style={styles.nameItemSub}>{count} tickets · {qty.toFixed(2)} क्विंटल</Text>
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

      {/* ── Owner Modal ── */}
      <Modal visible={showOwnerModal} transparent animationType="slide">
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowOwnerModal(false)}>
          <View style={styles.namesSheet}>
            <View style={styles.namesHeader}>
              <Text style={styles.namesTitle}>🌾 मालिक चुनें / Select Owner</Text>
              <TouchableOpacity onPress={() => setShowOwnerModal(false)}>
                <Ionicons name="close" size={22} color="#888" />
              </TouchableOpacity>
            </View>

            <ScrollView>
              {/* All option */}
              <TouchableOpacity
                style={[styles.nameItem, selectedOwners.length === 0 && styles.nameItemOn]}
                onPress={() => handleSelectOwner(null)}
              >
                <Text style={[styles.nameItemText, selectedOwners.length === 0 && { color: '#2ecc71' }]}>
                  All / सभी मालिक
                </Text>
                {selectedOwners.length === 0 && <Ionicons name="checkmark" size={16} color="#2ecc71" />}
              </TouchableOpacity>

              {uniqueOwners.map(owner => {
                const count = tickets.filter(t => t.caneOwner === owner).length;
                const qty = tickets
                  .filter(t => t.caneOwner === owner)
                  .reduce((s, t) => s + (parseFloat(String(t.quantity)) || 0), 0);
                const isSelected = selectedOwners.includes(owner);
                return (
                  <TouchableOpacity
                    key={owner}
                    style={[styles.nameItem, isSelected && styles.nameItemOn]}
                    onPress={() => handleSelectOwner(owner)}
                  >
                    <View style={[styles.nameAvatar, { backgroundColor: 'rgba(46,204,113,0.1)' }]}>
                      <Text style={[styles.nameAvatarText, isSelected && { color: '#2ecc71' }]}>
                        {owner.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.nameItemText, isSelected && { color: '#2ecc71' }]}>{owner}</Text>
                      <Text style={styles.nameItemSub}>{count} tickets · {qty.toFixed(2)} क्विंटल</Text>
                    </View>
                    <View style={[styles.checkbox, isSelected && { backgroundColor: '#2ecc71', borderColor: '#2ecc71' }]}>
                      {isSelected && <Ionicons name="checkmark" size={12} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Done button */}
            <TouchableOpacity
              style={[styles.doneBtn, { backgroundColor: '#2ecc71' }]}
              onPress={() => setShowOwnerModal(false)}
            >
              <Text style={styles.doneBtnText}>
                {selectedOwners.length > 0 ? `✓ ${selectedOwners.length} मालिक चुने` : 'बंद करें'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Edit Modal ── */}
      <Modal visible={!!editTicket} transparent animationType="slide">
        <View style={styles.editOverlay}>
          <View style={styles.editSheet}>
            <View style={styles.namesHeader}>
              <Text style={styles.namesTitle}>✏️ रिकॉर्ड संपादित करें</Text>
              <TouchableOpacity onPress={() => setEditTicket(null)}>
                <Ionicons name="close" size={22} color="#888" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {[
                { label: 'नाम / Name', field: 'name' as const, kb: 'default' as const },
                { label: 'पिता का नाम / Father Name', field: 'fatherName' as const, kb: 'default' as const },
                { label: 'तारीख / Date (DD/MM/YYYY)', field: 'date' as const, kb: 'numeric' as const },
                { label: 'मात्रा / Quantity', field: 'quantity' as const, kb: 'numeric' as const },
                { label: 'टिप्पणी / Comment', field: 'comment' as const, kb: 'default' as const },
              ].map(({ label, field, kb }) => (
                <View key={field} style={styles.editField}>
                  <Text style={styles.editLabel}>{label}</Text>
                  <TextInput
                    style={[styles.editInput, field === 'comment' && { height: 80, textAlignVertical: 'top' }]}
                    value={editForm[field]}
                    onChangeText={val => setEditForm(prev => ({ ...prev, [field]: val }))}
                    keyboardType={kb}
                    multiline={field === 'comment'}
                    autoCorrect={false}
                    placeholderTextColor="#555"
                  />
                </View>
              ))}
            </ScrollView>

            <View style={styles.editBtns}>
              <TouchableOpacity style={[styles.editBtn, { backgroundColor: '#2d2d4e' }]}
                onPress={() => setEditTicket(null)}>
                <Text style={styles.editBtnText}>रद्द करें</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.editBtn, { backgroundColor: '#f0a500' }]}
                onPress={handleEditSave}>
                <Text style={[styles.editBtnText, { color: '#1a1a2e' }]}>सहेजें ✓</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f1e' },
  container: { flex: 1 },
  header: { padding: 14, paddingBottom: 0 },
  listContent: { padding: 14, paddingBottom: 30 },

  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  seasonRowLabel: {
    color: '#666',
    fontSize: 12,
    fontWeight: '600',
  },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: '#1a1a2e', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1 },
  statNum: { fontSize: 20, fontWeight: '900' },
  statLabel: { color: '#666', fontSize: 9, fontWeight: '600', marginTop: 2 },

  priceCard: { justifyContent: 'center', alignItems: 'center' },
  priceInput: {
    color: '#f0a500',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    width: '100%',
    paddingVertical: 2,
  },

  totalAmountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(240,165,0,0.08)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.3)',
  },
  totalAmountLeft: { flex: 1 },
  totalAmountLabel: { color: '#f0a500', fontSize: 13, fontWeight: '700' },
  totalAmountSub: { color: '#666', fontSize: 11, marginTop: 2 },
  totalAmountValue: { color: '#f0a500', fontSize: 22, fontWeight: '900' },

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

  ticketCard: { backgroundColor: '#1a1a2e', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#2d2d4e' },
  ticketHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(240,165,0,0.15)', borderWidth: 1.5, borderColor: 'rgba(240,165,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#f0a500', fontSize: 16, fontWeight: '800' },
  ticketInfo: { flex: 1 },
  ticketName: { color: '#f0f0f0', fontSize: 15, fontWeight: '700' },
  ticketFather: { color: '#888', fontSize: 11, marginTop: 2 },
  ticketActions: { flexDirection: 'row', gap: 4 },
  actionBtn: { padding: 6 },

  badgeRow: { flexDirection: 'row', gap: 7, marginBottom: 8, flexWrap: 'wrap' },
  badgeDate: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(240,165,0,0.1)', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: 'rgba(240,165,0,0.25)' },
  badgeDateText: { color: '#f0a500', fontSize: 11, fontWeight: '700' },
  badgeQty: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(6,182,212,0.1)', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: 'rgba(6,182,212,0.25)' },
  badgeQtyText: { color: '#06b6d4', fontSize: 11, fontWeight: '700' },
  badgeEdited: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(139,92,246,0.1)', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: 'rgba(139,92,246,0.25)' },
  badgeEditedText: { color: '#8b5cf6', fontSize: 10, fontWeight: '700' },

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

  editOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  editSheet: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%', borderTopWidth: 1, borderColor: '#2d2d4e' },
  editField: { marginBottom: 14 },
  editLabel: { color: '#888', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  editInput: { backgroundColor: '#0f0f1e', borderRadius: 10, padding: 12, color: '#f0f0f0', fontSize: 15, borderWidth: 1.5, borderColor: '#2d2d4e' },
  editBtns: { flexDirection: 'row', gap: 10, marginTop: 16 },
  editBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  editBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: '#2d2d4e',
    backgroundColor: '#0f0f1e',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: '#f0a500',
    borderColor: '#f0a500',
  },
  doneBtn: {
    backgroundColor: '#f0a500',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  doneBtnText: {
    color: '#1a1a2e',
    fontSize: 14,
    fontWeight: '800',
  },
});
