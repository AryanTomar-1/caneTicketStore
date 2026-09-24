import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import {
  getTicketByFarmer_code,
  getRecentFarmers,
  checkDuplicate,
  saveBatchTickets,
} from '../utils/storage';
import { formatDateInput, isValidDate, todayFormatted, yesterdayFormatted } from '../utils/dateHelpers';
import { BatchSlipItem, RecentFarmer, Ticket } from '../types';
import { useSeason } from '../context/SeasonContext';

// ─── Unique ID helper for temp list keys ──────────────────────────────────────
const localId = () => Math.random().toString(36).slice(2);

// ─── Props ────────────────────────────────────────────────────────────────────
interface BatchEntryProps {
  onSaved: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function BatchEntryScreen({ onSaved }: BatchEntryProps) {
  const { selectedSeason } = useSeason();

  // ── Farmer Master ──────────────────────────────────────────────────────────
  const [farmerCode, setFarmerCode] = useState('');
  const [farmerName, setFarmerName] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [farmerLookupDone, setFarmerLookupDone] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [farmerError, setFarmerError] = useState('');

  // ── Recent farmers ────────────────────────────────────────────────────────
  const [recentFarmers, setRecentFarmers] = useState<RecentFarmer[]>([]);

  // ── Slip sub-form ─────────────────────────────────────────────────────────
  const [slipDate, setSlipDate] = useState(todayFormatted());
  const [ownerType, setOwnerType] = useState<'self' | 'other' | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [comment, setComment] = useState('');

  // ── Staged slips ──────────────────────────────────────────────────────────
  const [stagedSlips, setStagedSlips] = useState<BatchSlipItem[]>([]);

  // ── Loading ───────────────────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const nameRef = useRef<TextInput>(null);
  const fatherRef = useRef<TextInput>(null);
  const qtyRef = useRef<TextInput>(null);

  // Load recent farmers on mount
  useEffect(() => {
    loadRecentFarmers();
  }, []);

  const loadRecentFarmers = async () => {
    const recent = await getRecentFarmers(5);
    setRecentFarmers(recent);
  };

  // ── Auto-lookup farmer by code ────────────────────────────────────────────
  const handleCodeBlur = useCallback(async () => {
    const code = farmerCode.trim();
    if (!code || farmerLookupDone) return;

    setIsLookingUp(true);
    setFarmerError('');
    try {
      const tickets: Ticket[] = await getTicketByFarmer_code(code);
      if (tickets.length > 0) {
        const uniqueNames = [...new Set(tickets.map((t: Ticket) => t.name))];
        if (uniqueNames.length === 1) {
          const found = tickets.find((t: Ticket) => t.name === uniqueNames[0])!;
          setFarmerName(found.name);
          setFatherName(found.fatherName);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        // If multiple names for same code, leave blank for manual entry
      }
    } catch {
      // Silently ignore — user can fill manually
    } finally {
      setIsLookingUp(false);
      setFarmerLookupDone(true);
    }
  }, [farmerCode, farmerLookupDone]);

  const applyRecentFarmer = (farmer: RecentFarmer) => {
    setFarmerCode(farmer.farmer_code);
    setFarmerName(farmer.name);
    setFatherName(farmer.fatherName);
    setFarmerLookupDone(true);
    setFarmerError('');
    Haptics.selectionAsync();
  };

  // ── Validate farmer master fields ─────────────────────────────────────────
  const validateFarmer = (): boolean => {
    if (!farmerCode.trim()) {
      setFarmerError('किसान कोड आवश्यक है।');
      return false;
    }
    if (!farmerName.trim()) {
      setFarmerError('नाम आवश्यक है।');
      return false;
    }
    if (!fatherName.trim()) {
      setFarmerError('पिता का नाम आवश्यक है।');
      return false;
    }
    setFarmerError('');
    return true;
  };

  // ── Date helpers ──────────────────────────────────────────────────────────
  const handleDateChange = (text: string) => {
    if (text.length < slipDate.length) {
      const stripped = text.endsWith('/') ? text.slice(0, -1) : text;
      setSlipDate(stripped);
      return;
    }
    setSlipDate(formatDateInput(text));
  };

  const validateDateForSeason = (date: string): string | null => {
    if (!isValidDate(date)) return 'कृपया सही तारीख दर्ज करें (DD/MM/YYYY)।';
    const [, m, y] = date.split('/');
    const yearParts = selectedSeason.split('-');
    if (yearParts[0] !== y && yearParts[1] !== y)
      return `यह तारीख (${date}) इस सीजन के लिए नहीं है।`;
    if (yearParts[0] === y && parseInt(m, 10) < 10)
      return `यह महीना (${m}) इस सीजन से पहले का है।`;
    if (yearParts[1] === y && parseInt(m, 10) >= 10)
      return `यह महीना (${m}) अगले सीजन में आता है।`;
    return null;
  };

  // ── Add slip to staged list ───────────────────────────────────────────────
  const handleAddSlip = async () => {
    if (!validateFarmer()) return;

    // Validate date
    const dateErr = validateDateForSeason(slipDate);
    if (dateErr) { Alert.alert('तारीख त्रुटि', dateErr); return; }

    // Validate owner
    const caneOwner = ownerType === 'self' ? 'मेरा गन्ना' : ownerName.trim();
    if (!ownerType) { Alert.alert('मालिक चुनें', 'कृपया गन्ना मालिक का विकल्प चुनें।'); return; }
    if (ownerType === 'other' && !ownerName.trim()) {
      Alert.alert('मालिक का नाम', 'कृपया मालिक का नाम दर्ज करें।'); return;
    }

    // Validate quantity
    const qty = parseFloat(quantity);
    if (!quantity.trim() || isNaN(qty) || qty <= 0) {
      Alert.alert('मात्रा त्रुटि', 'कृपया सही मात्रा दर्ज करें (0 से अधिक)।'); return;
    }

    // Soft duplicate check
    const dup = await checkDuplicate(farmerName.trim(), slipDate);
    const alreadyInBatch = stagedSlips.some(
      s => s.date === slipDate && s.caneOwner === caneOwner
    );

    const addSlip = () => {
      setStagedSlips(prev => [
        ...prev,
        {
          id: localId(),
          date: slipDate,
          caneOwner,
          quantity: quantity.trim(),
          comment: comment.trim(),
        },
      ]);
      // Reset slip sub-form (keep farmer fields)
      setSlipDate(todayFormatted());
      setOwnerType(null);
      setOwnerName('');
      setQuantity('');
      setComment('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qtyRef.current?.focus();
    };

    if (dup || alreadyInBatch) {
      const why = dup
        ? `"${farmerName.trim()}" का ${slipDate} को रिकॉर्ड पहले से मौजूद है।`
        : `इस बैच में ${slipDate} की पर्ची पहले से है।`;
      Alert.alert('डुप्लीकेट पर्ची?', `${why}\nफिर भी जोड़ें?`, [
        { text: 'रद्द करें', style: 'cancel' },
        { text: 'जोड़ें', onPress: addSlip },
      ]);
    } else {
      addSlip();
    }
  };

  const removeSlip = (id: string) => {
    setStagedSlips(prev => prev.filter(s => s.id !== id));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // ── Submit all staged slips ───────────────────────────────────────────────
  const handleSubmitAll = async () => {
    if (!validateFarmer()) return;
    if (stagedSlips.length === 0) {
      Alert.alert('पर्ची नहीं', 'पहले कम से कम एक पर्ची जोड़ें।'); return;
    }

    Alert.alert(
      'सभी पर्चियां सेव करें?',
      `${stagedSlips.length} पर्चियां\n${farmerName.trim()} (कोड: ${farmerCode.trim()}) के लिए सेव होंगी।`,
      [
        { text: 'रद्द करें', style: 'cancel' },
        {
          text: `${stagedSlips.length} पर्चियां सेव करें`,
          style: 'default',
          onPress: performSubmit,
        },
      ]
    );
  };

  const performSubmit = async () => {
    setIsSubmitting(true);
    try {
      await saveBatchTickets({
        farmer_code: farmerCode.trim(),
        name: farmerName.trim(),
        fatherName: fatherName.trim(),
        slips: stagedSlips.map(s => ({
          date: s.date,
          caneOwner: s.caneOwner,
          quantity: parseFloat(s.quantity),
          comment: s.comment,
        })),
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSavedSuccess(true);
      // Reset everything
      setFarmerCode('');
      setFarmerName('');
      setFatherName('');
      setFarmerLookupDone(false);
      setFarmerError('');
      setStagedSlips([]);
      setSlipDate(todayFormatted());
      setOwnerType(null);
      setOwnerName('');
      setQuantity('');
      setComment('');
      await loadRecentFarmers();
      setTimeout(() => { setSavedSuccess(false); onSaved(); }, 2000);
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : 'सेव करने में समस्या। पुनः प्रयास करें।';
      Alert.alert('त्रुटि', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Running totals ────────────────────────────────────────────────────────
  const totalQty = stagedSlips.reduce((s, slip) => s + (parseFloat(slip.quantity) || 0), 0);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={80}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Success Banner */}
        {savedSuccess && (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
            <Text style={styles.successText}>✅ सभी पर्चियां सफलतापूर्वक सेव हुईं!</Text>
          </View>
        )}

        {/* ── Recent Farmers ── */}
        {recentFarmers.length > 0 && (
          <View style={styles.recentBox}>
            <Text style={styles.recentTitle}>
              <Ionicons name="time-outline" size={12} color="#f0a500" /> हाल के किसान
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recentScroll}>
              {recentFarmers.map(f => (
                <TouchableOpacity
                  key={f.farmer_code}
                  style={styles.recentChip}
                  onPress={() => applyRecentFarmer(f)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.recentChipCode}>{f.farmer_code}</Text>
                  <Text style={styles.recentChipName} numberOfLines={1}>{f.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Farmer Master Box ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="person-outline" size={14} color="#f0a500" /> किसान जानकारी (एक बार भरें)
          </Text>

          <Text style={styles.label}>किसान कोड / Farmer Code</Text>
          <TextInput
            style={styles.input}
            value={farmerCode}
            onChangeText={v => { setFarmerCode(v); setFarmerLookupDone(false); setFarmerError(''); }}
            placeholder="किसान कोड"
            placeholderTextColor="#555"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => nameRef.current?.focus()}
            onBlur={handleCodeBlur}
          />
          {isLookingUp && (
            <View style={styles.lookupRow}>
              <ActivityIndicator size="small" color="#f0a500" />
              <Text style={styles.lookupText}>डेटाबेस में खोज रहे हैं...</Text>
            </View>
          )}

          <Text style={styles.label}>नाम / Name</Text>
          <TextInput
            ref={nameRef}
            style={styles.input}
            value={farmerName}
            onChangeText={v => { setFarmerName(v); setFarmerError(''); }}
            placeholder="किसान का नाम"
            placeholderTextColor="#555"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => fatherRef.current?.focus()}
          />

          <Text style={styles.label}>पिता का नाम / Father Name</Text>
          <TextInput
            ref={fatherRef}
            style={styles.input}
            value={fatherName}
            onChangeText={v => { setFatherName(v); setFarmerError(''); }}
            placeholder="पिता का नाम"
            placeholderTextColor="#555"
            autoCorrect={false}
            returnKeyType="done"
          />

          {!!farmerError && (
            <View style={styles.errorRow}>
              <Ionicons name="warning-outline" size={14} color="#e74c3c" />
              <Text style={styles.errorText}>{farmerError}</Text>
            </View>
          )}
        </View>

        {/* ── Slip Sub-Form ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="add-circle-outline" size={14} color="#2ecc71" /> पर्ची विवरण जोड़ें
          </Text>

          {/* Date row with shortcuts */}
          <Text style={styles.label}>तारीख / Date</Text>
          <View style={styles.dateShortcutRow}>
            <TouchableOpacity
              style={[styles.dateShortcut, slipDate === todayFormatted() && styles.dateShortcutActive]}
              onPress={() => setSlipDate(todayFormatted())}
            >
              <Text style={[styles.dateShortcutText, slipDate === todayFormatted() && styles.dateShortcutActiveText]}>
                आज
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dateShortcut, slipDate === yesterdayFormatted() && styles.dateShortcutActive]}
              onPress={() => setSlipDate(yesterdayFormatted())}
            >
              <Text style={[styles.dateShortcutText, slipDate === yesterdayFormatted() && styles.dateShortcutActiveText]}>
                कल
              </Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.dateInput, isValidDate(slipDate) && styles.dateInputValid]}
              value={slipDate}
              onChangeText={handleDateChange}
              placeholder="DD/MM/YYYY"
              placeholderTextColor="#555"
              keyboardType="numeric"
              maxLength={10}
              autoCorrect={false}
            />
          </View>

          {/* Cane Owner */}
          <Text style={styles.label}>गन्ना मालिक / Cane Owner</Text>
          <View style={styles.ownerRow}>
            <TouchableOpacity
              style={[styles.ownerBtn, ownerType === 'self' && styles.ownerBtnSelf]}
              onPress={() => { setOwnerType('self'); setOwnerName(''); }}
            >
              <Ionicons
                name={ownerType === 'self' ? 'radio-button-on' : 'radio-button-off'}
                size={16}
                color={ownerType === 'self' ? '#2ecc71' : '#555'}
              />
              <Text style={[styles.ownerBtnText, ownerType === 'self' && { color: '#2ecc71' }]}>
                खुद का
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.ownerBtn, ownerType === 'other' && styles.ownerBtnOther]}
              onPress={() => setOwnerType('other')}
            >
              <Ionicons
                name={ownerType === 'other' ? 'radio-button-on' : 'radio-button-off'}
                size={16}
                color={ownerType === 'other' ? '#f0a500' : '#555'}
              />
              <Text style={[styles.ownerBtnText, ownerType === 'other' && { color: '#f0a500' }]}>
                दूसरे का
              </Text>
            </TouchableOpacity>
          </View>
          {ownerType === 'other' && (
            <TextInput
              style={styles.input}
              value={ownerName}
              onChangeText={setOwnerName}
              placeholder="मालिक का नाम दर्ज करें"
              placeholderTextColor="#555"
              autoCorrect={false}
              autoFocus
            />
          )}

          {/* Quantity */}
          <Text style={styles.label}>मात्रा / Quantity (क्विंटल)</Text>
          <TextInput
            ref={qtyRef}
            style={styles.input}
            value={quantity}
            onChangeText={v => setQuantity(v.replace(/[^0-9.]/g, ''))}
            placeholder="जैसे: 12.5"
            placeholderTextColor="#555"
            keyboardType="numeric"
            returnKeyType="done"
          />

          {/* Comment */}
          <Text style={styles.label}>टिप्पणी / Comment (वैकल्पिक)</Text>
          <TextInput
            style={[styles.input, styles.commentInput]}
            value={comment}
            onChangeText={setComment}
            placeholder="कोई नोट..."
            placeholderTextColor="#555"
            multiline
            numberOfLines={2}
            textAlignVertical="top"
          />

          {/* Add Button */}
          <TouchableOpacity style={styles.addSlipBtn} onPress={handleAddSlip} activeOpacity={0.8}>
            <Ionicons name="add-circle" size={20} color="#1a1a2e" />
            <Text style={styles.addSlipBtnText}>पर्ची जोड़ें (Add Slip)</Text>
          </TouchableOpacity>
        </View>

        {/* ── Staged Slips List ── */}
        {stagedSlips.length > 0 && (
          <View style={styles.section}>
            <View style={styles.stagedHeader}>
              <Text style={styles.sectionTitle}>
                <Ionicons name="list-outline" size={14} color="#06b6d4" /> तैयार पर्चियां ({stagedSlips.length})
              </Text>
              <Text style={styles.stagedTotalText}>
                कुल: {totalQty.toFixed(2)} क्विं
              </Text>
            </View>

            {stagedSlips.map((slip, idx) => (
              <View key={slip.id} style={styles.stagedCard}>
                <View style={styles.stagedCardLeft}>
                  <Text style={styles.stagedCardIdx}>#{idx + 1}</Text>
                  <View>
                    <Text style={styles.stagedCardDate}>{slip.date}</Text>
                    <Text style={styles.stagedCardOwner}>{slip.caneOwner}</Text>
                    {!!slip.comment && (
                      <Text style={styles.stagedCardComment} numberOfLines={1}>{slip.comment}</Text>
                    )}
                  </View>
                </View>
                <Text style={styles.stagedCardQty}>{parseFloat(slip.quantity).toFixed(2)} क्विं</Text>
                <TouchableOpacity
                  onPress={() => removeSlip(slip.id)}
                  style={styles.stagedDeleteBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="trash-outline" size={16} color="#e74c3c" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Bottom padding for the fixed submit button */}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* ── Fixed Submit Button ── */}
      {stagedSlips.length > 0 && (
        <View style={styles.submitBar}>
          <TouchableOpacity
            style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
            onPress={handleSubmitAll}
            disabled={isSubmitting}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#1a1a2e" />
            ) : (
              <>
                <Ionicons name="save" size={20} color="#1a1a2e" />
                <Text style={styles.submitBtnText}>
                  {stagedSlips.length} पर्चियां सेव करें · {totalQty.toFixed(1)} क्विं
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const C = {
  bg: '#0f0f1e',
  card: '#1a1a2e',
  border: '#2d2d4e',
  gold: '#f0a500',
  green: '#2ecc71',
  cyan: '#06b6d4',
  red: '#e74c3c',
  text: '#f0f0f0',
  sub: '#888',
  faint: '#555',
};

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16 },

  successBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.green, borderRadius: 10, padding: 12, marginBottom: 14,
  },
  successText: { color: '#fff', fontWeight: '700', fontSize: 14, flex: 1 },

  // Recent Farmers
  recentBox: {
    backgroundColor: C.card, borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: 'rgba(240,165,0,0.3)', marginBottom: 14,
  },
  recentTitle: { color: C.gold, fontSize: 11, fontWeight: '700', marginBottom: 8 },
  recentScroll: { flexDirection: 'row' },
  recentChip: {
    backgroundColor: C.bg, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
    marginRight: 8, borderWidth: 1, borderColor: 'rgba(240,165,0,0.4)',
    minWidth: 80, alignItems: 'center',
  },
  recentChipCode: { color: C.gold, fontSize: 11, fontWeight: '800' },
  recentChipName: { color: C.sub, fontSize: 10, marginTop: 2, maxWidth: 80 },

  // Section
  section: {
    backgroundColor: C.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border, marginBottom: 14,
  },
  sectionTitle: { color: C.text, fontSize: 13, fontWeight: '700', marginBottom: 12 },

  // Labels & Inputs
  label: { color: C.sub, fontSize: 11, fontWeight: '600', marginBottom: 5, marginTop: 8 },
  input: {
    backgroundColor: C.bg, borderRadius: 10, padding: 12,
    color: C.text, fontSize: 15, fontWeight: '600',
    borderWidth: 1.5, borderColor: C.border, marginBottom: 4,
  },
  commentInput: { height: 70, textAlignVertical: 'top', paddingTop: 10 },

  // Lookup indicator
  lookupRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  lookupText: { color: C.gold, fontSize: 11 },

  // Error
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  errorText: { color: C.red, fontSize: 12, fontWeight: '600' },

  // Date shortcuts
  dateShortcutRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4,
  },
  dateShortcut: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.border,
  },
  dateShortcutActive: { borderColor: C.gold, backgroundColor: 'rgba(240,165,0,0.15)' },
  dateShortcutText: { color: C.faint, fontSize: 12, fontWeight: '700' },
  dateShortcutActiveText: { color: C.gold },
  dateInput: {
    flex: 1, backgroundColor: C.bg, borderRadius: 10, padding: 11,
    color: C.text, fontSize: 14, fontWeight: '600',
    borderWidth: 1.5, borderColor: C.border,
  },
  dateInputValid: { borderColor: C.green },

  // Owner buttons
  ownerRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  ownerBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.bg, borderRadius: 10, padding: 12,
    borderWidth: 1.5, borderColor: C.border,
  },
  ownerBtnSelf: { borderColor: C.green, backgroundColor: 'rgba(46,204,113,0.08)' },
  ownerBtnOther: { borderColor: C.gold, backgroundColor: 'rgba(240,165,0,0.08)' },
  ownerBtnText: { color: C.sub, fontSize: 13, fontWeight: '700' },

  // Add slip button
  addSlipBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.green, borderRadius: 12, paddingVertical: 14, marginTop: 10,
  },
  addSlipBtnText: { color: '#1a1a2e', fontSize: 15, fontWeight: '800' },

  // Staged list
  stagedHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8,
  },
  stagedTotalText: { color: C.cyan, fontSize: 13, fontWeight: '800' },
  stagedCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.bg, borderRadius: 10, padding: 12,
    marginBottom: 6, borderWidth: 1, borderColor: C.border,
  },
  stagedCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  stagedCardIdx: { color: C.faint, fontSize: 12, fontWeight: '800', width: 22 },
  stagedCardDate: { color: C.gold, fontSize: 13, fontWeight: '700' },
  stagedCardOwner: { color: C.sub, fontSize: 11 },
  stagedCardComment: { color: C.faint, fontSize: 10, fontStyle: 'italic' },
  stagedCardQty: { color: C.cyan, fontSize: 14, fontWeight: '800', minWidth: 80, textAlign: 'right' },
  stagedDeleteBtn: { padding: 4 },

  // Submit bar
  submitBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 12, backgroundColor: C.bg,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: C.gold, borderRadius: 14, paddingVertical: 16,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#1a1a2e', fontSize: 15, fontWeight: '800' },
});
