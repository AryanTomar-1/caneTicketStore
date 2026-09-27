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

// Unique ID helper for staged slips
const localId = () => Math.random().toString(36).slice(2);

interface BatchEntryProps {
  onSaved: () => void;
}

export default function BatchEntryScreen({ onSaved }: BatchEntryProps) {
  const { selectedSeason } = useSeason();

  // ── Farmer Master (Entered ONCE for the batch) ─────────────────────────────
  const [farmerCode, setFarmerCode] = useState('');
  const [farmerName, setFarmerName] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [farmerLookupDone, setFarmerLookupDone] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [farmerError, setFarmerError] = useState('');

  // ── Recent farmers ────────────────────────────────────────────────────────
  const [recentFarmers, setRecentFarmers] = useState<RecentFarmer[]>([]);

  // ── Slip Sub-Form (Added multiple times) ───────────────────────────────────
  const [slipDate, setSlipDate] = useState(todayFormatted());
  const [ownerType, setOwnerType] = useState<'self' | 'other' | null>('self');
  const [ownerName, setOwnerName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [comment, setComment] = useState('');

  // ── Staged Slips List ─────────────────────────────────────────────────────
  const [stagedSlips, setStagedSlips] = useState<BatchSlipItem[]>([]);

  // ── Loading & Success ─────────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const nameRef = useRef<TextInput>(null);
  const fatherRef = useRef<TextInput>(null);
  const qtyRef = useRef<TextInput>(null);

  useEffect(() => {
    loadRecentFarmers();
  }, []);

  const loadRecentFarmers = async () => {
    const recent = await getRecentFarmers(6);
    setRecentFarmers(recent);
  };

  // ── Auto-lookup farmer by code on blur ─────────────────────────────────────
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
      }
    } catch {
      // Silently ignore — user can fill manually
    } finally {
      setIsLookingUp(false);
      setFarmerLookupDone(true);
    }
  }, [farmerCode, farmerLookupDone]);

  // ── Apply recent farmer to master fields ──────────────────────────────────
  const applyRecentFarmer = (farmer: RecentFarmer) => {
    setFarmerCode(farmer.farmer_code);
    setFarmerName(farmer.name);
    setFatherName(farmer.fatherName);
    setFarmerLookupDone(true);
    setFarmerError('');
    Haptics.selectionAsync();
    qtyRef.current?.focus();
  };

  // ── Validate farmer master fields ─────────────────────────────────────────
  const validateFarmer = (): boolean => {
    if (!farmerCode.trim()) {
      setFarmerError('किसान कोड आवश्यक है।');
      return false;
    }
    if (!farmerName.trim()) {
      setFarmerError('किसान का नाम आवश्यक है।');
      return false;
    }
    if (!fatherName.trim()) {
      setFarmerError('पिता का नाम आवश्यक है।');
      return false;
    }
    setFarmerError('');
    return true;
  };

  // ── Date input & validation ───────────────────────────────────────────────
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
    if (yearParts[0] !== y && yearParts[1] !== y) {
      return `यह तारीख (${date}) वर्तमान सीजन (${selectedSeason}) के लिए मान्य नहीं है।`;
    }
    if (yearParts[0] === y && parseInt(m, 10) < 10) {
      return `यह महीना (${m}) इस सीजन से पहले का है।`;
    }
    if (yearParts[1] === y && parseInt(m, 10) >= 10) {
      return `यह महीना (${m}) अगले सीजन में आता है।`;
    }
    return null;
  };

  // ── Add Slip to Staged List ───────────────────────────────────────────────
  const handleAddSlip = async () => {
    if (!validateFarmer()) return;

    // Validate date
    const dateErr = validateDateForSeason(slipDate);
    if (dateErr) {
      Alert.alert('तारीख त्रुटि', dateErr);
      return;
    }

    // Validate owner
    const caneOwner = ownerType === 'self' ? 'मेरा गन्ना' : ownerName.trim();
    if (!ownerType) {
      Alert.alert('मालिक चुनें', 'कृपया गन्ना मालिक का विकल्प चुनें।');
      return;
    }
    if (ownerType === 'other' && !ownerName.trim()) {
      Alert.alert('मालिक का नाम', 'कृपया मालिक का नाम दर्ज करें।');
      return;
    }

    // Validate quantity
    const qty = parseFloat(quantity);
    if (!quantity.trim() || isNaN(qty) || qty <= 0) {
      Alert.alert('मात्रा त्रुटि', 'कृपया सही मात्रा दर्ज करें (0 से अधिक संख्या)।');
      return;
    }

    // Duplicate check
    const dup = await checkDuplicate(farmerName.trim(), slipDate);
    const alreadyInBatch = stagedSlips.some(
      s => s.date === slipDate && s.caneOwner === caneOwner
    );

    const addSlipItem = () => {
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
      // Reset only the slip sub-form (Keep farmer master intact!)
      setSlipDate(todayFormatted());
      setOwnerType('self');
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
      Alert.alert('डुप्लीकेट पर्ची?', `${why}\nक्या फिर भी जोड़ना चाहते हैं?`, [
        { text: 'रद्द करें', style: 'cancel' },
        { text: 'जोड़ें', onPress: addSlipItem },
      ]);
    } else {
      addSlipItem();
    }
  };

  const removeSlip = (id: string) => {
    setStagedSlips(prev => prev.filter(s => s.id !== id));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // ── Submit All Staged Slips ───────────────────────────────────────────────
  const handleSubmitAll = async () => {
    if (!validateFarmer()) return;
    if (stagedSlips.length === 0) {
      Alert.alert('कोई पर्ची नहीं', 'पहले कम से कम एक पर्ची जोड़ें।');
      return;
    }

    Alert.alert(
      'सभी पर्चियां सेव करें?',
      `${farmerName.trim()} (कोड: ${farmerCode.trim()}) के लिए कुल ${stagedSlips.length} पर्चियां (${totalQty.toFixed(1)} क्विंटल) सेव की जाएंगी।`,
      [
        { text: 'रद्द करें', style: 'cancel' },
        {
          text: `हाँ, ${stagedSlips.length} पर्चियां सेव करें`,
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
      // Reset all form state
      setFarmerCode('');
      setFarmerName('');
      setFatherName('');
      setFarmerLookupDone(false);
      setFarmerError('');
      setStagedSlips([]);
      setSlipDate(todayFormatted());
      setOwnerType('self');
      setOwnerName('');
      setQuantity('');
      setComment('');
      await loadRecentFarmers();
      setTimeout(() => {
        setSavedSuccess(false);
        onSaved();
      }, 2000);
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : 'सेव करने में समस्या। पुनः प्रयास करें।';
      Alert.alert('त्रुटि', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalQty = stagedSlips.reduce((s, slip) => s + (parseFloat(slip.quantity) || 0), 0);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Success Banner */}
        {savedSuccess && (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
            <Text style={styles.successText}>✅ सभी पर्चियां सफलतापूर्वक सेव हो गईं!</Text>
          </View>
        )}

        {/* ── 1. Recent Farmers (Quick Autofill Master) ── */}
        {recentFarmers.length > 0 && (
          <View style={styles.recentBox}>
            <Text style={styles.recentTitle}>
              <Ionicons name="time-outline" size={12} color="#f0a500" /> हाल के किसान — टैप करके चुनें:
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recentScroll}>
              {recentFarmers.map(f => (
                <TouchableOpacity
                  key={f.farmer_code}
                  style={styles.recentChip}
                  onPress={() => applyRecentFarmer(f)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.recentChipCode}>{f.farmer_code}</Text>
                  <Text style={styles.recentChipName} numberOfLines={1}>{f.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── 2. Farmer Master Section (ENTERED ONCE) ── */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionHeaderLeft}>
              <View style={[styles.sectionIconCircle, { backgroundColor: 'rgba(240,165,0,0.12)' }]}>
                <Ionicons name="person" size={16} color="#f0a500" />
              </View>
              <Text style={styles.sectionTitle}>किसान जानकारी (एक बार भरें)</Text>
            </View>
            {farmerName && fatherName ? (
              <View style={styles.checkedPill}>
                <Ionicons name="checkmark-circle" size={12} color="#22c55e" />
                <Text style={styles.checkedPillText}>तय है</Text>
              </View>
            ) : null}
          </View>

          {/* Code & Name Row */}
          <View style={styles.rowDouble}>
            <View style={{ flex: 1.1 }}>
              <Text style={styles.fieldLabel}>किसान कोड / Code</Text>
              <TextInput
                style={styles.inputField}
                value={farmerCode}
                onChangeText={v => {
                  setFarmerCode(v);
                  setFarmerLookupDone(false);
                  setFarmerError('');
                }}
                onBlur={handleCodeBlur}
                placeholder="जैसे: 08"
                placeholderTextColor="#475569"
                keyboardType="default"
                returnKeyType="next"
                onSubmitEditing={() => nameRef.current?.focus()}
              />
              {isLookingUp && (
                <View style={styles.lookupIndicator}>
                  <ActivityIndicator size="small" color="#f0a500" />
                  <Text style={styles.lookupText}>खोज रहे हैं...</Text>
                </View>
              )}
            </View>

            <View style={{ flex: 2 }}>
              <Text style={styles.fieldLabel}>नाम / Name</Text>
              <TextInput
                ref={nameRef}
                style={styles.inputField}
                value={farmerName}
                onChangeText={v => { setFarmerName(v); setFarmerError(''); }}
                placeholder="किसान का नाम"
                placeholderTextColor="#475569"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => fatherRef.current?.focus()}
              />
            </View>
          </View>

          {/* Father Name */}
          <View style={{ marginTop: 8 }}>
            <Text style={styles.fieldLabel}>पिता का नाम / Father Name</Text>
            <TextInput
              ref={fatherRef}
              style={styles.inputField}
              value={fatherName}
              onChangeText={v => { setFatherName(v); setFarmerError(''); }}
              placeholder="पिता का नाम"
              placeholderTextColor="#475569"
              autoCorrect={false}
              returnKeyType="done"
            />
          </View>

          {!!farmerError && (
            <View style={styles.errorBox}>
              <Ionicons name="warning-outline" size={13} color="#ef4444" />
              <Text style={styles.errorText}>{farmerError}</Text>
            </View>
          )}
        </View>

        {/* ── 3. Slip Sub-Form (ADDED MULTIPLE TIMES) ── */}
        <View style={[styles.sectionCard, styles.slipSectionCard]}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionHeaderLeft}>
              <View style={[styles.sectionIconCircle, { backgroundColor: 'rgba(34,197,94,0.12)' }]}>
                <Ionicons name="add-circle" size={16} color="#22c55e" />
              </View>
              <Text style={styles.sectionTitle}>पर्ची विवरण जोड़ें</Text>
            </View>
          </View>

          {/* Date Row with Shortcuts */}
          <View style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text style={styles.fieldLabel}>तारीख / Date</Text>
              <View style={styles.dateShortcutsRow}>
                <TouchableOpacity
                  style={[styles.dateChip, slipDate === todayFormatted() && styles.dateChipActive]}
                  onPress={() => setSlipDate(todayFormatted())}
                >
                  <Text style={[styles.dateChipText, slipDate === todayFormatted() && styles.dateChipTextActive]}>
                    आज
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.dateChip, slipDate === yesterdayFormatted() && styles.dateChipActive]}
                  onPress={() => setSlipDate(yesterdayFormatted())}
                >
                  <Text style={[styles.dateChipText, slipDate === yesterdayFormatted() && styles.dateChipTextActive]}>
                    कल
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            <TextInput
              style={[styles.inputField, { letterSpacing: 1 }]}
              value={slipDate}
              onChangeText={handleDateChange}
              placeholder="DD/MM/YYYY"
              placeholderTextColor="#475569"
              keyboardType="numeric"
              maxLength={10}
            />
          </View>

          {/* Cane Owner Radio */}
          <View style={{ marginBottom: 10 }}>
            <Text style={styles.fieldLabel}>गन्ना मालिक / Cane Owner</Text>
            <View style={styles.ownerRow}>
              <TouchableOpacity
                style={[styles.ownerBtn, ownerType === 'self' && styles.ownerBtnSelf]}
                onPress={() => { setOwnerType('self'); setOwnerName(''); }}
              >
                <Ionicons
                  name={ownerType === 'self' ? 'checkmark-circle' : 'radio-button-off'}
                  size={15}
                  color={ownerType === 'self' ? '#22c55e' : '#64748b'}
                />
                <Text style={[styles.ownerBtnText, ownerType === 'self' && { color: '#22c55e' }]}>
                  खुद का (मेरा गन्ना)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.ownerBtn, ownerType === 'other' && styles.ownerBtnOther]}
                onPress={() => setOwnerType('other')}
              >
                <Ionicons
                  name={ownerType === 'other' ? 'checkmark-circle' : 'radio-button-off'}
                  size={15}
                  color={ownerType === 'other' ? '#f0a500' : '#64748b'}
                />
                <Text style={[styles.ownerBtnText, ownerType === 'other' && { color: '#f0a500' }]}>
                  दूसरे का
                </Text>
              </TouchableOpacity>
            </View>

            {ownerType === 'other' && (
              <TextInput
                style={[styles.inputField, { marginTop: 6 }]}
                value={ownerName}
                onChangeText={setOwnerName}
                placeholder="मालिक का नाम दर्ज करें"
                placeholderTextColor="#475569"
                autoCorrect={false}
              />
            )}
          </View>

          {/* Quantity */}
          <View style={{ marginBottom: 10 }}>
            <Text style={styles.fieldLabel}>मात्रा / Quantity (क्विंटल)</Text>
            <TextInput
              ref={qtyRef}
              style={[styles.inputField, { fontSize: 16, fontWeight: '800' }]}
              value={quantity}
              onChangeText={v => setQuantity(v.replace(/[^0-9.]/g, ''))}
              placeholder="जैसे: 75.0"
              placeholderTextColor="#475569"
              keyboardType="numeric"
              returnKeyType="done"
            />
          </View>

          {/* Comment (Optional) */}
          <View style={{ marginBottom: 14 }}>
            <Text style={styles.fieldLabel}>टिप्पणी / Comment (वैकल्पिक)</Text>
            <TextInput
              style={[styles.inputField, { height: 42 }]}
              value={comment}
              onChangeText={setComment}
              placeholder="कोई नोट..."
              placeholderTextColor="#475569"
            />
          </View>

          {/* Add Slip Button */}
          <TouchableOpacity style={styles.addSlipBtn} onPress={handleAddSlip} activeOpacity={0.8}>
            <Ionicons name="add-circle" size={19} color="#0f172a" />
            <Text style={styles.addSlipBtnText}>+ पर्ची जोड़ें (Add Slip)</Text>
          </TouchableOpacity>
        </View>

        {/* ── 4. Staged Slips List ── */}
        {stagedSlips.length > 0 && (
          <View style={styles.stagedSection}>
            <View style={styles.stagedHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="layers" size={16} color="#06b6d4" />
                <Text style={styles.stagedTitle}>
                  तैयार पर्चियां ({stagedSlips.length})
                </Text>
              </View>
              <Text style={styles.stagedTotalText}>
                कुल: {totalQty.toFixed(1)} क्विं
              </Text>
            </View>

            {stagedSlips.map((slip, idx) => (
              <View key={slip.id} style={styles.slipCard}>
                <View style={styles.slipIndexBadge}>
                  <Text style={styles.slipIndexText}>#{idx + 1}</Text>
                </View>

                <View style={styles.slipDetails}>
                  <View style={styles.slipBadgeRow}>
                    <View style={styles.datePill}>
                      <Ionicons name="calendar-outline" size={11} color="#f0a500" />
                      <Text style={styles.datePillText}>{slip.date}</Text>
                    </View>
                    <View style={styles.ownerPill}>
                      <Ionicons name="leaf-outline" size={11} color="#22c55e" />
                      <Text style={styles.ownerPillText}>{slip.caneOwner}</Text>
                    </View>
                  </View>
                  {!!slip.comment && (
                    <Text style={styles.slipCommentText} numberOfLines={1}>
                      {slip.comment}
                    </Text>
                  )}
                </View>

                <View style={styles.slipQtyBox}>
                  <Text style={styles.slipQtyValue}>
                    {parseFloat(slip.quantity).toFixed(2)}
                  </Text>
                  <Text style={styles.slipQtyUnit}>क्विं</Text>
                </View>

                <TouchableOpacity
                  onPress={() => removeSlip(slip.id)}
                  style={styles.deleteSlipBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="trash-outline" size={17} color="#ef4444" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* ── 5. Final Save All Button ── */}
        {stagedSlips.length > 0 && (
          <TouchableOpacity
            style={[styles.submitAllBtn, isSubmitting && styles.submitAllBtnDisabled]}
            onPress={handleSubmitAll}
            disabled={isSubmitting}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <>
                <Ionicons name="checkmark-done" size={20} color="#0f172a" />
                <Text style={styles.submitAllBtnText}>
                  सभी {stagedSlips.length} पर्चियां सेव करें · {totalQty.toFixed(1)} क्विं
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d1a',
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 40,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#22c55e',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  successText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    flex: 1,
  },

  // Recent Farmers
  recentBox: {
    backgroundColor: '#16162a',
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.25)',
  },
  recentTitle: {
    color: '#f0a500',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  recentScroll: {
    flexDirection: 'row',
  },
  recentChip: {
    backgroundColor: '#0d0d1a',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.35)',
    alignItems: 'center',
  },
  recentChipCode: {
    color: '#f0a500',
    fontSize: 12,
    fontWeight: '800',
  },
  recentChipName: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 1,
  },

  // Section Card
  sectionCard: {
    backgroundColor: '#16162a',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#23233c',
  },
  slipSectionCard: {
    borderColor: 'rgba(34,197,94,0.3)',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '800',
  },
  checkedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(34,197,94,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  checkedPillText: {
    color: '#22c55e',
    fontSize: 11,
    fontWeight: '700',
  },

  // Form Fields
  rowDouble: {
    flexDirection: 'row',
    gap: 10,
  },
  fieldLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  inputField: {
    backgroundColor: '#0d0d1a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
    borderWidth: 1.5,
    borderColor: '#23233c',
  },
  lookupIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  lookupText: {
    color: '#f0a500',
    fontSize: 11,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },

  // Date Shortcuts
  dateShortcutsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  dateChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: '#0d0d1a',
    borderWidth: 1,
    borderColor: '#23233c',
  },
  dateChipActive: {
    borderColor: '#f0a500',
    backgroundColor: 'rgba(240,165,0,0.12)',
  },
  dateChipText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  dateChipTextActive: {
    color: '#f0a500',
    fontWeight: '700',
  },

  // Owner Options
  ownerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  ownerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#0d0d1a',
    borderRadius: 10,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: '#23233c',
  },
  ownerBtnSelf: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34,197,94,0.08)',
  },
  ownerBtnOther: {
    borderColor: '#f0a500',
    backgroundColor: 'rgba(240,165,0,0.08)',
  },
  ownerBtnText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },

  // Add Slip Button
  addSlipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#f0a500',
    borderRadius: 12,
    paddingVertical: 13,
  },
  addSlipBtnText: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '900',
  },

  // Staged Slips Section
  stagedSection: {
    backgroundColor: '#16162a',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(6,182,212,0.3)',
  },
  stagedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  stagedTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '800',
  },
  stagedTotalText: {
    color: '#06b6d4',
    fontSize: 13,
    fontWeight: '800',
  },

  // Individual Staged Slip Card
  slipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0d0d1a',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#23233c',
  },
  slipIndexBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#16162a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slipIndexText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
  },
  slipDetails: {
    flex: 1,
  },
  slipBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  datePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  datePillText: {
    color: '#f0a500',
    fontSize: 11,
    fontWeight: '700',
  },
  ownerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ownerPillText: {
    color: '#22c55e',
    fontSize: 11,
    fontWeight: '600',
  },
  slipCommentText: {
    color: '#64748b',
    fontSize: 10,
    marginTop: 2,
    fontStyle: 'italic',
  },
  slipQtyBox: {
    alignItems: 'flex-end',
  },
  slipQtyValue: {
    color: '#06b6d4',
    fontSize: 14,
    fontWeight: '900',
  },
  slipQtyUnit: {
    color: '#64748b',
    fontSize: 10,
  },
  deleteSlipBtn: {
    padding: 4,
  },

  // Submit All Button
  submitAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#22c55e',
    borderRadius: 14,
    paddingVertical: 15,
  },
  submitAllBtnDisabled: {
    opacity: 0.6,
  },
  submitAllBtnText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '900',
  },
});
