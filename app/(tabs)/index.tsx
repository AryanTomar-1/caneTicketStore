import React, { useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import AsyncStorage from '@react-native-async-storage/async-storage';
import BatchEntryScreen from '../../components/BatchEntryScreen';
import SeasonSelector from '../../components/SeasonSelector';
import { STEPS, Step } from '../../constants/steps';
import { useSeason } from '../../context/SeasonContext';
import { useMicPulse, useSpeakerPulse } from '../../hooks/useMicPulse';
import { useKeyboard } from '../../hooks/useKeyboard';
import { FormData, RecentFarmer } from '../../types';
import { formatDateInput, isValidDate, todayFormatted, yesterdayFormatted } from '../../utils/dateHelpers';
import { checkDuplicate, getRecentFarmers, getTicketByFarmer_code, saveTicket } from '../../utils/storage';

export default function VoiceInputScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { selectedSeason } = useSeason();
  const { keyboardHeight } = useKeyboard();
  const mainScrollRef = useRef<ScrollView>(null);

  // ── Speaker / TTS Audio toggle ─────────────────────────────────────────────
  const [isSpeakerEnabled, setIsSpeakerEnabled] = useState<boolean>(true);
  const isSpeakerEnabledRef = useRef<boolean>(true);
  const [speakerToast, setSpeakerToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isSpeakerEnabledRef.current = isSpeakerEnabled;
  }, [isSpeakerEnabled]);

  useEffect(() => {
    AsyncStorage.getItem('@cane_speaker_enabled')
      .then(val => {
        if (val !== null) {
          const enabled = val === 'true';
          setIsSpeakerEnabled(enabled);
          isSpeakerEnabledRef.current = enabled;
        }
      })
      .catch(() => {});
  }, []);

  const toggleSpeaker = async (): Promise<void> => {
    const nextState = !isSpeakerEnabledRef.current;
    setIsSpeakerEnabled(nextState);
    isSpeakerEnabledRef.current = nextState;
    await AsyncStorage.setItem('@cane_speaker_enabled', String(nextState)).catch(() => {});
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setSpeakerToast(nextState ? '🔊 स्पीकर चालू (Speaker ON)' : '🔇 स्पीकर बंद (Speaker OFF)');
    toastTimerRef.current = setTimeout(() => {
      setSpeakerToast(null);
    }, 2200);

    if (!nextState) {
      Speech.stop();
      setIsSpeaking(false);
      speaker.stop();
    } else {
      if (currentStepDef) {
        speakText(currentStepDef.speak, true);
      }
    }
  };

  // ── Mode toggle ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<'single' | 'batch'>('single');

  // ── Step management (0..6 = form steps, 7 = confirmation / review screen) ─
  const [currentStep, setCurrentStep] = useState<number>(0);

  // ── Form State ─────────────────────────────────────────────────────────────
  const [formData, setFormData] = useState<FormData>({
    farmer_code: '',
    name: '',
    fatherName: '',
    caneOwner: '',
    date: '',
    quantity: '',
    comment: '',
  });

  const [inputValue, setInputValue] = useState<string>('');
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [micError, setMicError] = useState<string>('');
  const [recognizedText, setRecognizedText] = useState<string>('');

  // ── Lookup modal for found farmer ──────────────────────────────────────────
  const [showFarmerModal, setShowFarmerModal] = useState(false);
  const [foundPerson, setFoundPerson] = useState<{ name: string; fatherName: string } | null>(null);

  // ── Owner step radio ───────────────────────────────────────────────────────
  const [ownerType, setOwnerType] = useState<'self' | 'other' | null>(null);

  // ── Recent farmers ─────────────────────────────────────────────────────────
  const [recentFarmers, setRecentFarmers] = useState<RecentFarmer[]>([]);

  // ── Saving states ──────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // ── Animations ─────────────────────────────────────────────────────────────
  const mic = useMicPulse();
  const speaker = useSpeakerPulse();
  const stepScrollRef = useRef<ScrollView>(null);

  // ── STT listeners (gated by focus and single mode) ─────────────────────────
  useSpeechRecognitionEvent('start', () => {
    if (!isFocused || mode !== 'single') return;
    setIsListening(true);
    setMicError('');
    setRecognizedText('');
  });

  useSpeechRecognitionEvent('end', () => {
    if (!isFocused || mode !== 'single') return;
    setIsListening(false);
    mic.stop();
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (!isFocused || mode !== 'single') return;
    const result = event.results[0]?.transcript ?? '';
    if (result) {
      const cleaned = cleanForStep(result, currentStep);
      setInputValue(cleaned);
      setRecognizedText(cleaned);
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!isFocused || mode !== 'single') return;
    setIsListening(false);
    mic.stop();
    if (event.error !== 'no-speech') {
      setMicError('माइक त्रुटि। पुनः प्रयास करें।');
    }
  });

  useEffect(() => {
    if (isFocused && mode === 'single') {
      loadRecentFarmers();
      if (currentStep < STEPS.length) {
        setTimeout(() => speakText(STEPS[currentStep].speak), 600);
      }
    }
    return () => {
      speaker.stop();
      mic.stop();
      Speech.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused, mode]);

  // Keep input value in sync when changing steps
  useEffect(() => {
    if (currentStep < STEPS.length) {
      const stepKey = STEPS[currentStep].key;
      const existing = formData[stepKey] || '';
      setInputValue(existing);
      setRecognizedText('');
      if (stepKey === 'caneOwner') {
        if (existing === 'मेरा गन्ना') setOwnerType('self');
        else if (existing) setOwnerType('other');
        else setOwnerType(null);
      }
      // Scroll horizontal progress bar to keep current step visible
      stepScrollRef.current?.scrollTo({ x: currentStep * 75, animated: true });
    }
  }, [currentStep, formData]);

  const loadRecentFarmers = async () => {
    const recent = await getRecentFarmers(6);
    setRecentFarmers(recent);
  };

  // ── Apply recent farmer chip ───────────────────────────────────────────────
  const applyRecentFarmer = (farmer: RecentFarmer) => {
    setFormData(prev => ({
      ...prev,
      farmer_code: farmer.farmer_code,
      name: farmer.name,
      fatherName: farmer.fatherName,
    }));
    setCurrentStep(3); // Jump to caneOwner step
    Haptics.selectionAsync();
    setTimeout(() => speakText(`${farmer.name} चुने गए। ${STEPS[3].speak}`), 300);
  };

  const cleanForStep = (text: string, stepIndex: number): string => {
    if (stepIndex >= STEPS.length) return text;
    const key = STEPS[stepIndex].key;
    if (key === 'date') return formatDateInput(text.replace(/\D/g, ''));
    if (key === 'quantity') return text.replace(/[^0-9.]/g, '');
    return text.trim();
  };

  // ── TTS ────────────────────────────────────────────────────────────────────
  const speakText = (text: string, force: boolean = false): void => {
    if (!isSpeakerEnabledRef.current && !force) return;
    Speech.stop();
    setIsSpeaking(true);
    speaker.start();
    Speech.speak(text, {
      language: 'hi-IN',
      pitch: 1.0,
      rate: 0.88,
      onDone: () => { setIsSpeaking(false); speaker.stop(); },
      onError: () => { setIsSpeaking(false); speaker.stop(); },
      onStopped: () => { setIsSpeaking(false); speaker.stop(); },
    });
  };

  // ── STT ────────────────────────────────────────────────────────────────────
  const startListening = async (): Promise<void> => {
    Speech.stop();
    setIsSpeaking(false);
    speaker.stop();
    setMicError('');
    setRecognizedText('');
    try {
      const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!granted) {
        setMicError('माइक की अनुमति नहीं दी गई। सेटिंग में जाकर अनुमति दें।');
        return;
      }
      ExpoSpeechRecognitionModule.start({ lang: 'hi-IN', interimResults: true });
      mic.start();
    } catch {
      setMicError('माइक शुरू नहीं हो सका। पुनः प्रयास करें।');
    }
  };

  const stopListening = async (): Promise<void> => {
    ExpoSpeechRecognitionModule.stop();
    setIsListening(false);
    mic.stop();
  };

  const micPanResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { startListening(); },
    onPanResponderRelease: () => { stopListening(); },
    onPanResponderTerminate: () => { stopListening(); },
  });

  // ── Farmer lookup by code from history ─────────────────────────────────────
  const findFarmer = async (farmer_code: string) => {
    if (!farmer_code.trim()) return;
    try {
      const data = await getTicketByFarmer_code(farmer_code);
      if (!data || data.length === 0) {
        setCurrentStep(1);
        setTimeout(() => speakText(STEPS[1].speak), 400);
        return;
      }
      const uniqueNames = [...new Set(data.map(t => t.name))];
      if (uniqueNames.length === 1) {
        const person = data.find(t => t.name === uniqueNames[0]);
        if (person) {
          setFoundPerson({ name: person.name, fatherName: person.fatherName });
          setFormData(prev => ({ ...prev, farmer_code }));
          setShowFarmerModal(true);
          speakText(`${person.name} मिले। क्या यह सही है?`);
        }
      } else {
        setFormData(prev => ({ ...prev, farmer_code }));
        setCurrentStep(1);
        speakText(STEPS[1].speak);
      }
    } catch {
      setCurrentStep(1);
      setTimeout(() => speakText(STEPS[1].speak), 400);
    }
  };

  // ── Date input handler ─────────────────────────────────────────────────────
  const handleDateChange = (text: string): void => {
    if (text.length < inputValue.length) {
      const stripped = text.endsWith('/') ? text.slice(0, -1) : text;
      setInputValue(stripped);
      return;
    }
    setInputValue(formatDateInput(text));
  };

  const handleInputChange = (text: string): void => {
    if (currentStep < STEPS.length && STEPS[currentStep].key === 'date') {
      handleDateChange(text);
    } else {
      setInputValue(text);
    }
  };

  // ── Navigation Between Steps ───────────────────────────────────────────────
  const handleBack = (): void => {
    if (currentStep > 0) {
      const prevStep = currentStep - 1;
      setCurrentStep(prevStep);
      setTimeout(() => speakText(STEPS[prevStep].speak), 300);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleNext = (): void => {
    if (currentStep >= STEPS.length) return;

    const step = STEPS[currentStep];
    const value = inputValue.trim();

    // Validation for Cane Owner
    if (step.key === 'caneOwner') {
      if (!ownerType) {
        Alert.alert('आवश्यक', 'कृपया गन्ने के मालिक का विकल्प चुनें।');
        return;
      }
      if (ownerType === 'other' && !value) {
        Alert.alert('आवश्यक', 'मालिक का नाम दर्ज करें।');
        return;
      }
    } else if (step.key !== 'comment' && !value) {
      Alert.alert('आवश्यक', `कृपया ${step.labelHindi} दर्ज करें।`);
      return;
    }

    // Validation for Date
    if (step.key === 'date') {
      if (value.length < 10) {
        Alert.alert('अधूरी तारीख', 'कृपया पूरी तारीख दर्ज करें: DD/MM/YYYY');
        return;
      }
      if (!isValidDate(value)) {
        Alert.alert('गलत तारीख', `"${value}" सही तारीख नहीं है।\nकृपया सही तारीख दर्ज करें।`);
        return;
      }
      const selectedYear = selectedSeason.split('-');
      const fullDate = value.split('/');
      if (selectedYear[0] !== fullDate[2] && selectedYear[1] !== fullDate[2]) {
        speakText('यह टिकट इस सीजन में दर्ज नहीं हो सकता।');
        Alert.alert('गलत वर्ष', `"${value}" इस सीजन (${selectedSeason}) के लिए मान्य नहीं है।`);
        return;
      }
    }

    // Validation for Quantity
    if (step.key === 'quantity') {
      const num = parseFloat(value);
      if (isNaN(num) || num <= 0) {
        Alert.alert('गलत मात्रा', 'मात्रा 0 से अधिक सही संख्या होनी चाहिए।');
        return;
      }
    }

    if (isListening) stopListening();

    const finalVal = step.key === 'caneOwner' && ownerType === 'self' ? 'मेरा गन्ना' : value;
    setFormData(prev => ({ ...prev, [step.key]: finalVal }));
    Haptics.selectionAsync();

    // If farmer code step, auto lookup from previous records
    if (step.key === 'farmer_code') {
      findFarmer(finalVal);
      return;
    }

    // Move to next step or Completion Screen
    if (currentStep < STEPS.length - 1) {
      const next = currentStep + 1;
      setCurrentStep(next);
      setTimeout(() => speakText(STEPS[next].speak), 350);
    } else {
      // Step 6 completed -> Move to completion / review screen (index 7)
      setCurrentStep(STEPS.length);
      setTimeout(() => speakText('सभी विवरण दर्ज हो गए हैं। कृपया समीक्षा करें और पर्ची सेव करें।'), 300);
    }
  };

  // ── Reset Form ─────────────────────────────────────────────────────────────
  const resetForm = (): void => {
    setCurrentStep(0);
    setFormData({
      farmer_code: '',
      name: '',
      fatherName: '',
      caneOwner: '',
      date: '',
      quantity: '',
      comment: '',
    });
    setInputValue('');
    setRecognizedText('');
    setMicError('');
    setOwnerType(null);
    setTimeout(() => speakText(STEPS[0].speak), 300);
  };

  // ── Save Ticket to Storage ─────────────────────────────────────────────────
  const handleSaveTicket = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const dup = await checkDuplicate(formData.name.trim(), formData.date.trim());
      if (dup) {
        Alert.alert(
          'डुप्लीकेट रिकॉर्ड',
          `"${formData.name.trim()}" का ${formData.date.trim()} को रिकॉर्ड पहले से मौजूद है।\nक्या आप फिर भी सहेजना चाहते हैं?`,
          [
            { text: 'रद्द करें', style: 'cancel', onPress: () => setIsLoading(false) },
            { text: 'फिर भी सहेजें', style: 'destructive', onPress: performSave },
          ]
        );
        return;
      }
      await performSave();
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : 'सहेजने में समस्या।';
      Alert.alert('त्रुटि', msg);
      setIsLoading(false);
    }
  };

  const performSave = async () => {
    try {
      await saveTicket({
        farmer_code: formData.farmer_code.trim(),
        name: formData.name.trim(),
        fatherName: formData.fatherName.trim(),
        caneOwner: formData.caneOwner.trim() || 'मेरा गन्ना',
        date: formData.date.trim(),
        quantity: parseFloat(formData.quantity),
        comment: formData.comment.trim(),
      });

      setSavedSuccess(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      speakText('पर्ची सफलतापूर्वक सेव हो गई!');
      await loadRecentFarmers();
      setTimeout(() => {
        setSavedSuccess(false);
        resetForm();
      }, 2200);
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : 'सहेजने में समस्या।';
      Alert.alert('त्रुटि', msg);
    } finally {
      setIsLoading(false);
    }
  };

  const isCompletionScreen = currentStep >= STEPS.length;
  const currentStepDef: Step | undefined = !isCompletionScreen ? STEPS[currentStep] : undefined;
  const progressPercent = Math.min(((currentStep) / STEPS.length) * 100, 100);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.safe, { paddingTop: Math.max(insets.top, 10) }]}>
        {/* ── 1. HEADER ── */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.titleGroup}>
              <Ionicons name="document-text" size={20} color="#f0a500" />
              <Text style={styles.appTitle}>रिकॉर्ड जोड़ें</Text>
            </View>
            <SeasonSelector prefix="सीजन: " />
          </View>

          {/* Speaker Status Toast Notification */}
          {speakerToast && (
            <View style={[
              styles.speakerToastBanner,
              !isSpeakerEnabled && styles.speakerToastBannerMuted
            ]}>
              <Text style={styles.speakerToastText}>{speakerToast}</Text>
            </View>
          )}

          {/* ── 2. ENTRY TYPE (Segmented Control) ── */}
          <View style={styles.segmentedControl}>
            <TouchableOpacity
              style={[styles.segmentBtn, mode === 'single' && styles.segmentBtnActive]}
              onPress={() => {
                if (mode !== 'single') {
                  setMode('single');
                  resetForm();
                }
              }}
              activeOpacity={0.8}
            >
              <Ionicons
                name="mic"
                size={16}
                color={mode === 'single' ? '#0f172a' : '#94a3b8'}
              />
              <Text style={[styles.segmentBtnText, mode === 'single' && styles.segmentBtnTextActive]}>
                सिंगल पर्ची
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.segmentBtn, mode === 'batch' && styles.segmentBtnActive]}
              onPress={() => {
                if (mode !== 'batch') {
                  setMode('batch');
                  Speech.stop();
                }
              }}
              activeOpacity={0.8}
            >
              <Ionicons
                name="layers-outline"
                size={16}
                color={mode === 'batch' ? '#0f172a' : '#94a3b8'}
              />
              <Text style={[styles.segmentBtnText, mode === 'batch' && styles.segmentBtnTextActive]}>
                बैच पर्चियां
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── BATCH ENTRY MODE ── */}
        {mode === 'batch' ? (
          <BatchEntryScreen onSaved={loadRecentFarmers} />
        ) : (
          /* ── SINGLE PERCHI / VOICE FLOW ── */
          <ScrollView
            ref={mainScrollRef}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 80 : 40 }
            ]}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            showsVerticalScrollIndicator={false}
          >
            {/* Success Notification Banner */}
            {savedSuccess && (
              <View style={styles.successBanner}>
                <Ionicons name="checkmark-circle" size={22} color="#fff" />
                <Text style={styles.successText}>✅ पर्ची सफलतापूर्वक सेव हो गई!</Text>
              </View>
            )}

            {/* ── 3. RECENT FARMERS (Step 0 to 2) ── */}
            {currentStep <= 2 && recentFarmers.length > 0 && (
              <View style={styles.recentBox}>
                <Text style={styles.recentTitle}>
                  <Ionicons name="time-outline" size={13} color="#f0a500" /> हाल के किसान — टैप करके चुनें...
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recentScroll}>
                  {recentFarmers.map(rf => (
                    <TouchableOpacity
                      key={rf.farmer_code}
                      style={styles.recentChip}
                      onPress={() => applyRecentFarmer(rf)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.recentChipCode}>{rf.farmer_code}</Text>
                      <Text style={styles.recentChipName} numberOfLines={1}>{rf.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* ── 4. STEP PROGRESS INDICATOR ── */}
            <View style={styles.progressContainer}>
              <View style={styles.progressBarWrapper}>
                <View style={styles.progressBarTrack}>
                  <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
                </View>
                <Text style={styles.progressStepLabel}>
                  {isCompletionScreen ? 'चरण 7/7 पूर्ण' : `चरण ${currentStep + 1} / 7`}
                </Text>
              </View>

              {/* Horizontal Steps Pills */}
              <ScrollView
                ref={stepScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.stepChipsRow}
              >
                {STEPS.map((s, idx) => {
                  const isDone = idx < currentStep;
                  const isCurrent = idx === currentStep;
                  return (
                    <TouchableOpacity
                      key={s.key}
                      style={[
                        styles.stepChip,
                        isCurrent && styles.stepChipCurrent,
                        isDone && styles.stepChipDone,
                      ]}
                      onPress={() => {
                        // Allow tapping previous completed steps to edit
                        if (isDone) {
                          setCurrentStep(idx);
                        }
                      }}
                      disabled={!isDone}
                      activeOpacity={0.7}
                    >
                      {isDone ? (
                        <Ionicons name="checkmark" size={13} color="#22c55e" style={{ marginRight: 3 }} />
                      ) : (
                        <Text style={[styles.stepChipNum, isCurrent && styles.stepChipNumActive]}>
                          {idx + 1}
                        </Text>
                      )}
                      <Text
                        style={[
                          styles.stepChipText,
                          isCurrent && styles.stepChipTextActive,
                          isDone && styles.stepChipTextDone,
                        ]}
                      >
                        {s.labelHindi}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* ── 5. COMPLETION SCREEN (FINAL STEP 7) ── */}
            {isCompletionScreen ? (
              <View style={styles.completionContainer}>
                {/* Green Success Badge */}
                <View style={styles.completionHeader}>
                  <View style={styles.completionCheckCircle}>
                    <Ionicons name="checkmark-circle" size={44} color="#22c55e" />
                  </View>
                  <Text style={styles.completionTitle}>✓ पुष्टि की गई</Text>
                  <Text style={styles.completionSubtitle}>
                    कृपया सभी जानकारी जांचें और पर्ची सेव करें
                  </Text>
                </View>

                {/* 2-Column Summary Card */}
                <View style={styles.summaryCard}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>किसान कोड:</Text>
                    <Text style={styles.summaryValue}>{formData.farmer_code}</Text>
                  </View>
                  <View style={styles.summaryDivider} />

                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>नाम:</Text>
                    <Text style={styles.summaryValue}>{formData.name}</Text>
                  </View>
                  <View style={styles.summaryDivider} />

                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>पिता का नाम:</Text>
                    <Text style={styles.summaryValue}>{formData.fatherName}</Text>
                  </View>
                  <View style={styles.summaryDivider} />

                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>गन्ना मालिक का नाम:</Text>
                    <Text style={[styles.summaryValue, { color: '#22c55e' }]}>
                      {formData.caneOwner || 'मेरा गन्ना'}
                    </Text>
                  </View>
                  <View style={styles.summaryDivider} />

                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>तारीख:</Text>
                    <Text style={[styles.summaryValue, { color: '#f0a500' }]}>{formData.date}</Text>
                  </View>
                  <View style={styles.summaryDivider} />

                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>मात्रा (क्विंटल):</Text>
                    <Text style={[styles.summaryValue, { color: '#06b6d4', fontSize: 16 }]}>
                      {parseFloat(formData.quantity || '0').toFixed(2)} क्विंटल
                    </Text>
                  </View>

                  {!!formData.comment && (
                    <>
                      <View style={styles.summaryDivider} />
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>टिप्पणी:</Text>
                        <Text style={styles.summaryValue}>{formData.comment}</Text>
                      </View>
                    </>
                  )}
                </View>

                {/* Final Actions */}
                <View style={styles.completionActions}>
                  {/* Primary Button */}
                  <TouchableOpacity
                    style={[styles.primaryActionBtn, styles.savePerchiBtn]}
                    onPress={handleSaveTicket}
                    disabled={isLoading}
                    activeOpacity={0.85}
                  >
                    {isLoading ? (
                      <ActivityIndicator color="#0f172a" />
                    ) : (
                      <>
                        <Ionicons name="checkmark-done" size={20} color="#0f172a" />
                        <Text style={styles.primaryActionBtnText}>✓ पर्ची सेव करें</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  {/* Secondary Button */}
                  <TouchableOpacity
                    style={styles.secondaryActionBtn}
                    onPress={() => setCurrentStep(0)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="pencil" size={17} color="#f0a500" />
                    <Text style={styles.secondaryActionBtnText}>✎ जानकारी बदलें</Text>
                  </TouchableOpacity>

                  {/* Reset Button */}
                  <TouchableOpacity
                    style={styles.restartBtn}
                    onPress={resetForm}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="refresh-outline" size={15} color="#ef4444" />
                    <Text style={styles.restartBtnText}>🔄 फिर से शुरू करें</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              /* ── 6. ACTIVE FORM INPUT CARD (Steps 0 to 6) ── */
              currentStepDef && (
                <View style={styles.focusedCard}>
                  {/* Step Header with Speaker */}
                  <View style={styles.cardHeader}>
                    <View style={styles.cardHeaderLeft}>
                      <View style={styles.stepBadge}>
                        <Text style={styles.stepBadgeText}>चरण {currentStep + 1}</Text>
                      </View>
                      <Text style={styles.stepTitleHindi}>{currentStepDef.labelHindi}</Text>
                      <Text style={styles.stepSubtitleEn}>/ {currentStepDef.label}</Text>
                    </View>

                    {/* Speaker Pulse / Enable-Disable Toggle */}
                    <TouchableOpacity
                      style={styles.speakerTrigger}
                      onPress={toggleSpeaker}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Animated.View style={[
                        styles.speakerCircle,
                        !isSpeakerEnabled && styles.speakerCircleDisabled,
                        isSpeaking && { transform: [{ scale: speaker.anim }] }
                      ]}>
                        <Ionicons
                          name={!isSpeakerEnabled ? 'volume-mute' : (isSpeaking ? 'volume-high' : 'volume-medium')}
                          size={20}
                          color={!isSpeakerEnabled ? '#ef4444' : '#f0a500'}
                        />
                      </Animated.View>
                    </TouchableOpacity>
                  </View>

                  {/* Prompt Instructions */}
                  <View style={styles.promptBox}>
                    <Text style={styles.promptHindi}>{currentStepDef.promptHindi}</Text>
                    <Text style={styles.promptEn}>{currentStepDef.promptEn}</Text>
                  </View>

                  {/* ── STEP-SPECIFIC INPUTS ── */}

                  {/* Step 3: Cane Owner Radio */}
                  {currentStepDef.key === 'caneOwner' ? (
                    <View style={styles.ownerSection}>
                      <TouchableOpacity
                        style={[styles.ownerCard, ownerType === 'self' && styles.ownerCardActiveSelf]}
                        onPress={() => {
                          setOwnerType('self');
                          setInputValue('मेरा गन्ना');
                        }}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.radioCircle, ownerType === 'self' && styles.radioCircleActiveSelf]}>
                          {ownerType === 'self' && <View style={styles.radioDotSelf} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.ownerOptionTitle, ownerType === 'self' && { color: '#22c55e' }]}>
                            🌿 मेरा खुद का गन्ना है
                          </Text>
                          <Text style={styles.ownerOptionSub}>&quot;मेरा गन्ना&quot; दर्ज होगा</Text>
                        </View>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.ownerCard, ownerType === 'other' && styles.ownerCardActiveOther]}
                        onPress={() => {
                          setOwnerType('other');
                          setInputValue('');
                        }}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.radioCircle, ownerType === 'other' && styles.radioCircleActiveOther]}>
                          {ownerType === 'other' && <View style={styles.radioDotOther} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.ownerOptionTitle, ownerType === 'other' && { color: '#f0a500' }]}>
                            👤 दूसरे का गन्ना है
                          </Text>
                          <Text style={styles.ownerOptionSub}>मालिक का नाम नीचे दर्ज करें</Text>
                        </View>
                      </TouchableOpacity>

                      {ownerType === 'other' && (
                        <View style={styles.inputWithMicRow}>
                          <TextInput
                            style={styles.mainInput}
                            value={inputValue}
                            onChangeText={setInputValue}
                            onFocus={() => {
                              setTimeout(() => mainScrollRef.current?.scrollToEnd({ animated: true }), 120);
                            }}
                            placeholder="मालिक का नाम लिखें या बोलें..."
                            placeholderTextColor="#475569"
                            autoFocus
                            returnKeyType="done"
                            onSubmitEditing={handleNext}
                          />
                          <Animated.View style={{ transform: [{ scale: mic.anim }] }}>
                            <View
                              {...micPanResponder.panHandlers}
                              style={[styles.micButton, isListening && styles.micButtonListening]}
                            >
                              <Ionicons
                                name={isListening ? 'mic' : 'mic-outline'}
                                size={22}
                                color={isListening ? '#fff' : '#f0a500'}
                              />
                            </View>
                          </Animated.View>
                        </View>
                      )}
                    </View>
                  ) : currentStepDef.key === 'date' ? (
                    /* Step 4: Date Input */
                    <View style={styles.dateSection}>
                      <View style={styles.dateShortcutRow}>
                        <TouchableOpacity
                          style={[styles.dateShortcutBtn, inputValue === todayFormatted() && styles.dateShortcutBtnActive]}
                          onPress={() => setInputValue(todayFormatted())}
                        >
                          <Text style={[styles.dateShortcutText, inputValue === todayFormatted() && styles.dateShortcutTextActive]}>
                            📅 आज ({todayFormatted()})
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.dateShortcutBtn, inputValue === yesterdayFormatted() && styles.dateShortcutBtnActive]}
                          onPress={() => setInputValue(yesterdayFormatted())}
                        >
                          <Text style={[styles.dateShortcutText, inputValue === yesterdayFormatted() && styles.dateShortcutTextActive]}>
                            कल ({yesterdayFormatted()})
                          </Text>
                        </TouchableOpacity>
                      </View>

                      <View style={styles.inputWithMicRow}>
                        <TextInput
                          style={[styles.mainInput, { letterSpacing: 2, fontSize: 18, textAlign: 'center' }]}
                          value={inputValue}
                          onChangeText={handleInputChange}
                          onFocus={() => {
                            setTimeout(() => mainScrollRef.current?.scrollToEnd({ animated: true }), 120);
                          }}
                          placeholder="DD/MM/YYYY"
                          placeholderTextColor="#475569"
                          keyboardType="numeric"
                          maxLength={10}
                          returnKeyType="done"
                          onSubmitEditing={handleNext}
                        />
                        <Animated.View style={{ transform: [{ scale: mic.anim }] }}>
                          <View
                            {...micPanResponder.panHandlers}
                            style={[styles.micButton, isListening && styles.micButtonListening]}
                          >
                            <Ionicons
                              name={isListening ? 'mic' : 'mic-outline'}
                              size={22}
                              color={isListening ? '#fff' : '#f0a500'}
                            />
                          </View>
                        </Animated.View>
                      </View>
                      <Text style={styles.dateValidationHint}>
                        {inputValue.length === 10
                          ? isValidDate(inputValue)
                            ? '✅ सही तारीख'
                            : '❌ गलत तारीख'
                          : 'अंक टाइप करें — / अपने आप जुड़ेगा'}
                      </Text>
                    </View>
                  ) : currentStepDef.key === 'comment' ? (
                    /* Step 6: Comment */
                    <View style={styles.commentSection}>
                      <View style={styles.inputWithMicRow}>
                        <TextInput
                          style={[styles.mainInput, styles.multilineInput]}
                          value={inputValue}
                          onChangeText={setInputValue}
                          onFocus={() => {
                            setTimeout(() => mainScrollRef.current?.scrollToEnd({ animated: true }), 120);
                          }}
                          placeholder="कोई टिप्पणी या नोट..."
                          placeholderTextColor="#475569"
                          multiline
                          numberOfLines={3}
                          textAlignVertical="top"
                        />
                        <Animated.View style={{ transform: [{ scale: mic.anim }] }}>
                          <View
                            {...micPanResponder.panHandlers}
                            style={[styles.micButton, isListening && styles.micButtonListening]}
                          >
                            <Ionicons
                              name={isListening ? 'mic' : 'mic-outline'}
                              size={22}
                              color={isListening ? '#fff' : '#f0a500'}
                            />
                          </View>
                        </Animated.View>
                      </View>
                      <TouchableOpacity
                        style={styles.skipCommentBtn}
                        onPress={() => {
                          setInputValue('');
                          handleNext();
                        }}
                      >
                        <Text style={styles.skipCommentText}>टिप्पणी छोड़ें (Skip)</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    /* General input (farmer_code, name, fatherName, quantity) */
                    <View style={styles.inputWithMicRow}>
                      <TextInput
                        style={styles.mainInput}
                        value={inputValue}
                        onChangeText={handleInputChange}
                        onFocus={() => {
                          setTimeout(() => mainScrollRef.current?.scrollToEnd({ animated: true }), 120);
                        }}
                        placeholder={currentStepDef.placeholder}
                        placeholderTextColor="#475569"
                        keyboardType={currentStepDef.keyboardType}
                        autoCorrect={false}
                        returnKeyType="done"
                        onSubmitEditing={handleNext}
                      />
                      <Animated.View style={{ transform: [{ scale: mic.anim }] }}>
                        <View
                          {...micPanResponder.panHandlers}
                          style={[styles.micButton, isListening && styles.micButtonListening]}
                        >
                          <Ionicons
                            name={isListening ? 'mic' : 'mic-outline'}
                            size={22}
                            color={isListening ? '#fff' : '#f0a500'}
                          />
                        </View>
                      </Animated.View>
                    </View>
                  )}

                  {/* Hold-to-speak helper */}
                  <View style={styles.micHelpRow}>
                    <Ionicons name="information-circle-outline" size={13} color="#64748b" />
                    <Text style={styles.micHelpText}>ⓘ माइक दबाकर रखें और बोलें</Text>
                  </View>

                  {/* Listening Active Bar */}
                  {isListening && (
                    <View style={styles.listeningActiveBar}>
                      <View style={styles.listeningDot} />
                      <Text style={styles.listeningLabel}>🎙️ सुन रहा हूँ...</Text>
                      <TouchableOpacity onPress={stopListening}>
                        <Text style={styles.stopListeningLink}>रोकें</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Recognized text preview */}
                  {!!recognizedText && !isListening && (
                    <View style={styles.recognizedBox}>
                      <Text style={styles.recognizedLabel}>
                        ✓ पहचान लिया: <Text style={{ color: '#f0a500', fontWeight: '800' }}>{recognizedText}</Text>
                      </Text>
                      <TouchableOpacity
                        onPress={() => {
                          setInputValue('');
                          setRecognizedText('');
                          startListening();
                        }}
                      >
                        <Text style={styles.retrySpeechText}>दोबारा बोलें</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Error feedback */}
                  {!!micError && (
                    <Text style={styles.micErrorText}>⚠ {micError}</Text>
                  )}

                  {/* Action Buttons: आगे → and ← पीछे */}
                  <View style={styles.actionButtonsRow}>
                    {currentStep > 0 && (
                      <TouchableOpacity
                        style={styles.backStepBtn}
                        onPress={handleBack}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="arrow-back" size={16} color="#94a3b8" />
                        <Text style={styles.backStepBtnText}>पीछे</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={[styles.nextStepBtn, currentStep === 0 && { flex: 1 }]}
                      onPress={handleNext}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.nextStepBtnText}>
                        {currentStep === STEPS.length - 1 ? 'समीक्षा करें →' : 'आगे →'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Replay Question Button */}
                  <TouchableOpacity
                    style={styles.repeatQuestionBtn}
                    onPress={() => speakText(currentStepDef.speak, true)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="volume-medium-outline" size={16} color="#f0a500" />
                    <Text style={styles.repeatQuestionText}>🔊 प्रश्न दोहराएं</Text>
                  </TouchableOpacity>
                </View>
              )
            )}
          </ScrollView>
        )}

        {/* ══ Farmer Found Modal ══ */}
        <Modal visible={showFarmerModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.foundFarmerCard}>
              <View style={styles.foundHeader}>
                <View style={styles.foundIconCircle}>
                  <Ionicons name="person" size={26} color="#f0a500" />
                </View>
                <Text style={styles.foundTitle}>किसान मिला!</Text>
                <Text style={styles.foundSubtitle}>कोड: {formData.farmer_code}</Text>
              </View>

              <View style={styles.foundDetailsBox}>
                <View style={styles.foundDetailRow}>
                  <Text style={styles.foundDetailKey}>नाम:</Text>
                  <Text style={styles.foundDetailVal}>{foundPerson?.name}</Text>
                </View>
                <View style={styles.foundDetailRow}>
                  <Text style={styles.foundDetailKey}>पिता का नाम:</Text>
                  <Text style={styles.foundDetailVal}>{foundPerson?.fatherName}</Text>
                </View>
              </View>

              <Text style={styles.foundQuestion}>क्या यह वही किसान हैं?</Text>

              <View style={styles.foundModalActions}>
                <TouchableOpacity
                  style={[styles.foundModalBtn, styles.foundBtnNo]}
                  onPress={() => {
                    setShowFarmerModal(false);
                    setFoundPerson(null);
                    setCurrentStep(1);
                    setTimeout(() => speakText(STEPS[1].speak), 350);
                  }}
                >
                  <Text style={styles.foundBtnNoText}>नहीं, नया है</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.foundModalBtn, styles.foundBtnYes]}
                  onPress={() => {
                    if (!foundPerson) return;
                    setFormData(prev => ({
                      ...prev,
                      name: foundPerson.name,
                      fatherName: foundPerson.fatherName,
                    }));
                    setShowFarmerModal(false);
                    setFoundPerson(null);
                    setCurrentStep(3); // Jump straight to caneOwner
                    setTimeout(() => speakText(`${foundPerson.name} की पुष्टि हुई। ${STEPS[3].speak}`), 350);
                  }}
                >
                  <Text style={styles.foundBtnYesText}>हाँ, यही हैं ✓</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0d0d1a',
  },
  header: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 6,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.3,
  },

  // ── Segmented Control ──
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#16162a',
    borderRadius: 14,
    padding: 4,
    borderWidth: 1,
    borderColor: '#23233c',
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 9,
    borderRadius: 10,
  },
  segmentBtnActive: {
    backgroundColor: '#f0a500',
  },
  segmentBtnText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700',
  },
  segmentBtnTextActive: {
    color: '#0f172a',
    fontWeight: '900',
  },

  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 40,
  },

  // Success Banner
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#22c55e',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  successText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
  },

  // Recent Farmers
  recentBox: {
    backgroundColor: '#16162a',
    borderRadius: 14,
    padding: 11,
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.25)',
    marginBottom: 12,
  },
  recentTitle: {
    color: '#f0a500',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 8,
  },
  recentScroll: {
    flexDirection: 'row',
  },
  recentChip: {
    backgroundColor: '#0d0d1a',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.35)',
    alignItems: 'center',
    minWidth: 70,
  },
  recentChipCode: {
    color: '#f0a500',
    fontSize: 12,
    fontWeight: '800',
  },
  recentChipName: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 2,
    maxWidth: 75,
  },

  // ── Step Progress Indicator ──
  progressContainer: {
    marginBottom: 12,
  },
  progressBarWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressBarTrack: {
    flex: 1,
    height: 4,
    backgroundColor: '#23233c',
    borderRadius: 2,
    marginRight: 10,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 4,
    backgroundColor: '#f0a500',
    borderRadius: 2,
  },
  progressStepLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  stepChipsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  stepChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16162a',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#23233c',
  },
  stepChipCurrent: {
    backgroundColor: '#f0a500',
    borderColor: '#f0a500',
  },
  stepChipDone: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderColor: 'rgba(34,197,94,0.35)',
  },
  stepChipNum: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
    marginRight: 4,
  },
  stepChipNumActive: {
    color: '#0f172a',
  },
  stepChipText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
  },
  stepChipTextActive: {
    color: '#0f172a',
    fontWeight: '800',
  },
  stepChipTextDone: {
    color: '#22c55e',
    fontWeight: '700',
  },

  // ── Focused Card (Steps 0..6) ──
  focusedCard: {
    backgroundColor: '#16162a',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#23233c',
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  stepBadge: {
    backgroundColor: 'rgba(240,165,0,0.12)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.3)',
  },
  stepBadgeText: {
    color: '#f0a500',
    fontSize: 10,
    fontWeight: '800',
  },
  stepTitleHindi: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
  },
  stepSubtitleEn: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '500',
  },
  speakerTrigger: {
    padding: 2,
  },
  speakerCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0d0d1a',
    borderWidth: 1,
    borderColor: '#23233c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakerCircleDisabled: {
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  speakerToastBanner: {
    position: 'absolute',
    top: 64,
    alignSelf: 'center',
    zIndex: 9999,
    backgroundColor: '#16162a',
    borderWidth: 1,
    borderColor: '#f0a500',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
  },
  speakerToastBannerMuted: {
    borderColor: '#ef4444',
  },
  speakerToastText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '800',
  },

  // Prompt Box
  promptBox: {
    backgroundColor: '#0d0d1a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#23233c',
  },
  promptHindi: {
    color: '#f1f5f9',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 2,
  },
  promptEn: {
    color: '#64748b',
    fontSize: 11,
  },

  // Input Row with Mic
  inputWithMicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  mainInput: {
    flex: 1,
    backgroundColor: '#0d0d1a',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
    borderWidth: 1.5,
    borderColor: '#23233c',
  },
  multilineInput: {
    height: 75,
  },
  micButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0d0d1a',
    borderWidth: 1.5,
    borderColor: 'rgba(240,165,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonListening: {
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
  },
  micHelpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
    paddingLeft: 2,
  },
  micHelpText: {
    color: '#64748b',
    fontSize: 11,
  },

  // Listening Bar
  listeningActiveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  listeningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  listeningLabel: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  stopListeningLink: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },

  // Recognized text
  recognizedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(240,165,0,0.08)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.25)',
  },
  recognizedLabel: {
    color: '#94a3b8',
    fontSize: 12,
    flex: 1,
  },
  retrySpeechText: {
    color: '#f0a500',
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 6,
  },
  micErrorText: {
    color: '#ef4444',
    fontSize: 12,
    marginBottom: 10,
  },

  // Step 3 Owner Section
  ownerSection: {
    marginBottom: 8,
  },
  ownerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0d0d1a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: '#23233c',
  },
  ownerCardActiveSelf: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34,197,94,0.08)',
  },
  ownerCardActiveOther: {
    borderColor: '#f0a500',
    backgroundColor: 'rgba(240,165,0,0.08)',
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleActiveSelf: {
    borderColor: '#22c55e',
  },
  radioCircleActiveOther: {
    borderColor: '#f0a500',
  },
  radioDotSelf: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22c55e',
  },
  radioDotOther: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#f0a500',
  },
  ownerOptionTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
  },
  ownerOptionSub: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 1,
  },

  // Step 4 Date Section
  dateSection: {
    marginBottom: 8,
  },
  dateShortcutRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  dateShortcutBtn: {
    flex: 1,
    backgroundColor: '#0d0d1a',
    borderRadius: 18,
    paddingVertical: 7,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#23233c',
  },
  dateShortcutBtnActive: {
    borderColor: '#f0a500',
    backgroundColor: 'rgba(240,165,0,0.12)',
  },
  dateShortcutText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  dateShortcutTextActive: {
    color: '#f0a500',
  },
  dateValidationHint: {
    color: '#64748b',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 8,
  },

  // Step 6 Comment Section
  commentSection: {
    marginBottom: 8,
  },
  skipCommentBtn: {
    alignSelf: 'center',
    paddingVertical: 4,
    marginBottom: 6,
  },
  skipCommentText: {
    color: '#f0a500',
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },

  // Action Buttons (आगे / पीछे)
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  backStepBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#23233c',
    borderRadius: 12,
    paddingVertical: 14,
  },
  backStepBtnText: {
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '700',
  },
  nextStepBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0a500',
    borderRadius: 12,
    paddingVertical: 14,
  },
  nextStepBtnText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '900',
  },
  repeatQuestionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: 6,
  },
  repeatQuestionText: {
    color: '#f0a500',
    fontSize: 13,
    fontWeight: '700',
  },

  // ── COMPLETION / REVIEW SCREEN (Step 7) ──
  completionContainer: {
    marginBottom: 20,
  },
  completionHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  completionCheckCircle: {
    marginBottom: 6,
  },
  completionTitle: {
    color: '#22c55e',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  completionSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },

  // Summary Card (2-column layout)
  summaryCard: {
    backgroundColor: '#16162a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#23233c',
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  summaryLabel: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  summaryValue: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'right',
    flex: 1,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: '#23233c',
  },

  // Final Action Buttons
  completionActions: {
    gap: 10,
  },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 15,
  },
  savePerchiBtn: {
    backgroundColor: '#22c55e',
  },
  primaryActionBtnText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '900',
  },
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(240,165,0,0.1)',
    borderRadius: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.3)',
  },
  secondaryActionBtnText: {
    color: '#f0a500',
    fontSize: 14,
    fontWeight: '800',
  },
  restartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  restartBtnText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '700',
  },

  // ── Found Farmer Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  foundFarmerCard: {
    backgroundColor: '#16162a',
    borderRadius: 20,
    padding: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: '#23233c',
  },
  foundHeader: {
    alignItems: 'center',
    marginBottom: 14,
  },
  foundIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(240,165,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  foundTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
  },
  foundSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  foundDetailsBox: {
    backgroundColor: '#0d0d1a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#23233c',
  },
  foundDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  foundDetailKey: {
    color: '#94a3b8',
    fontSize: 13,
  },
  foundDetailVal: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '800',
  },
  foundQuestion: {
    color: '#cbd5e1',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  foundModalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  foundModalBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  foundBtnNo: {
    backgroundColor: '#23233c',
  },
  foundBtnNoText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '700',
  },
  foundBtnYes: {
    backgroundColor: '#22c55e',
  },
  foundBtnYesText: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '900',
  },
});