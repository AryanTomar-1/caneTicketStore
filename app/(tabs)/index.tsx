import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  Animated,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { STEPS } from '../../constants/steps';
import { useMicPulse, useSpeakerPulse } from '../../hooks/useMicPulse';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { saveTicket, getTicketByFarmer_code, checkDuplicate } from '../../utils/storage';
import { FormData, ConfirmedValues } from '../../types';
import SeasonSelector from '../../components/SeasonSelector';
import { useSeason } from '../../context/SeasonContext';

// ─── Date helpers ─────────────────────────────────────────────────────────────

const formatDateInput = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

const isValidDate = (value: string): boolean => {
  if (value.length !== 10) return false;
  const parts = value.split('/');
  if (parts.length !== 3) return false;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  if (y < 1900 || y > 2100) return false;
  return d <= new Date(y, m, 0).getDate();
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function VoiceInputScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();

  const [currentStep, setCurrentStep] = useState<number>(0);
  const [formData, setFormData] = useState<FormData>({ farmer_code: '', name: '', fatherName: '', caneOwner: '', date: '', quantity: '', comment: '' });
  const [inputValue, setInputValue] = useState<string>('');
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [showFarmerModal, setShowFarmerModal] = useState(false);
  const [foundPerson, setFoundPerson] = useState<{ name: string; fatherName: string } | null>(null);
  const [showSummaryModal, setShowSummaryModal] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [confirmedValues, setConfirmedValues] = useState<ConfirmedValues>({});
  const [micError, setMicError] = useState<string>('');
  const [ownerType, setOwnerType] = useState<'self' | 'other' | null>(null);
  const { selectedSeason } = useSeason();

  const mic = useMicPulse();
  const speaker = useSpeakerPulse();

  // ── STT listeners (gated by focus so Dashboard STT doesn't bleed in) ─────
  useSpeechRecognitionEvent('start', () => {
    if (!isFocused) return;
    setIsListening(true);
    setMicError('');
  });
  useSpeechRecognitionEvent('end', () => {
    if (!isFocused) return;
    setIsListening(false);
    mic.stop();
  });
  useSpeechRecognitionEvent('result', (event) => {
    if (!isFocused) return;
    const result = event.results[0]?.transcript ?? '';
    if (result) setInputValue(cleanForStep(result, currentStep));
  });
  useSpeechRecognitionEvent('error', (event) => {
    if (!isFocused) return;
    setIsListening(false);
    mic.stop();
    if (event.error !== 'no-speech') setMicError('माइक त्रुटि। पुनः प्रयास करें।');
  });

  useEffect(() => {
    if (isFocused) {
      setTimeout(() => speakText(STEPS[0].speak), 600);
    }
    return () => {
      speaker.stop();
      mic.stop();
      Speech.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);


  const cleanForStep = (text: string, stepIndex: number): string => {
    const key = STEPS[stepIndex].key;
    if (key === 'date') return formatDateInput(text.replace(/\D/g, ''));
    if (key === 'quantity') return text.replace(/[^0-9.]/g, '');
    return text;
  };

  const handleConfirmWithValue = (value: string): void => {
    const step = STEPS[currentStep];
    setFormData(prev => ({ ...prev, [step.key]: value }));
    setConfirmedValues(prev => ({ ...prev, [step.key]: value }));
    setInputValue('');
    setShowConfirmModal(false);
    if (currentStep < STEPS.length - 1) {
      const next = currentStep + 1;
      setCurrentStep(next);
      setTimeout(() => speakText(STEPS[next].speak), 400);
    } else {
      setTimeout(() => setShowSummaryModal(true), 300);
    }
  };

  // ── TTS ───────────────────────────────────────────────────────────────────
  const speakText = (text: string): void => {
    Speech.stop();
    setIsSpeaking(true);
    speaker.start();
    Speech.speak(text, {
      language: 'hi-IN', pitch: 1.0, rate: 0.85,
      onDone: () => { setIsSpeaking(false); speaker.stop(); },
      onError: () => { setIsSpeaking(false); speaker.stop(); },
      onStopped: () => { setIsSpeaking(false); speaker.stop(); },
    });
  };

  // ── STT ───────────────────────────────────────────────────────────────────
  const startListening = async (): Promise<void> => {
    // Stop TTS first so mic doesn't record the app's own voice
    Speech.stop();
    setIsSpeaking(false);
    speaker.stop();

    setMicError('');
    setInputValue('');
    try {
      const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!granted) return;
      ExpoSpeechRecognitionModule.start({ lang: 'hi-IN', interimResults: true });
      mic.start();
    } catch {
      setMicError('माइक शुरू नहीं हो सका।');
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

  // ── Farmer lookup from previous seasons ──────────────────────────────────
  const findFarmer = async (farmer_code: string) => {
    if (!farmer_code.trim()) return;

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
  };

  // ── Date input handler ────────────────────────────────────────────────────
  const handleDateChange = (text: string): void => {
    if (text.length < inputValue.length) {
      const stripped = text.endsWith('/') ? text.slice(0, -1) : text;
      setInputValue(stripped);
      return;
    }
    setInputValue(formatDateInput(text));
  };

  const handleInputChange = (text: string): void => {
    if (STEPS[currentStep].key === 'date') {
      handleDateChange(text);
    } else {
      setInputValue(text);
    }
  };

  // ── Back / Next ───────────────────────────────────────────────────────────
  const handleBack = (): void => {
    const pre = currentStep - 1;
    setCurrentStep(pre);
  };

  const handleNext = (): void => {
    const step = STEPS[currentStep];
    const value = inputValue.trim();
    if (step.key === 'caneOwner') {
      if (!ownerType) {
        Alert.alert('आवश्यक', 'कृपया एक विकल्प चुनें।');
        return;
      }
      if (ownerType === 'other' && !value) {
        Alert.alert('आवश्यक', 'मालिक का नाम दर्ज करें।');
        return;
      }
    }
    if (!value) { Alert.alert('आवश्यक', `कृपया ${step.labelHindi} दर्ज करें।`); return; }
    if (step.key === 'date') {
      if (value.length < 10) { Alert.alert('अधूरी तारीख', 'कृपया पूरी तारीख दर्ज करें: DD/MM/YYYY'); return; }
      if (!isValidDate(value)) { Alert.alert('गलत तारीख', `"${value}" सही तारीख नहीं है।\nकृपया सही तारीख दर्ज करें।`); return; }

      const selectedYear: string[] = selectedSeason.split('-');
      const fullDate: string[] = value.split('/');
      if (selectedYear[0] !== fullDate[2] && selectedYear[1] !== fullDate[2]) {
        speakText('यह टिकट इस सीजन में दर्ज नहीं हो सकता, क्योंकि वर्ष मेल नहीं खाता।');
        Alert.alert('गलत वर्ष', `"${value}" इस सीजन के लिए सही नहीं है।\nकृपया पहले सही सत्र चुनें।`);
        return;
      } else if (selectedYear[0] === fullDate[2] && parseInt(fullDate[1], 10) < 10) {
        speakText('यह महीना पिछले सीजन में आता है, इस सीजन में नहीं।');
        Alert.alert('गलत महीना', `"${value}" इस सीजन के लिए सही नहीं है।\nयह महीना पिछले सीजन में आता है।`);
        return;
      } else if (selectedYear[1] === fullDate[2] && parseInt(fullDate[1], 10) >= 10) {
        speakText('यह महीना अगले सीजन में आता है, इस सीजन में नहीं।');
        Alert.alert('गलत महीना', `"${value}" इस सीजन के लिए सही नहीं है।\nयह महीना अगले सीजन में आता है।`);
        return;
      }
    }
    if (step.key === 'quantity' && isNaN(parseFloat(value))) {
      Alert.alert('गलत मात्रा', 'कृपया एक सही संख्या दर्ज करें।'); return;
    }
    if (isListening) stopListening();
    setShowConfirmModal(true);
    speakText(`आपने दर्ज किया: ${value}। क्या यह सही है?`);
  };

  const handleConfirmYes = (): void => {
    const step = STEPS[currentStep];
    const value = inputValue.trim();
    setFormData(prev => ({ ...prev, [step.key]: value }));
    setConfirmedValues(prev => ({ ...prev, [step.key]: value }));
    setInputValue('');
    setShowConfirmModal(false);

    if (step.key === 'farmer_code') {
      findFarmer(value);
      return;
    }
    setOwnerType(null);
    if (currentStep < STEPS.length - 1) {
      const next = currentStep + 1;
      setCurrentStep(next);
      setTimeout(() => speakText(STEPS[next].speak), 400);
    } else {
      setTimeout(() => setShowSummaryModal(true), 300);
    }
  };

  const handleConfirmNo = (): void => {
    setShowConfirmModal(false);
    setInputValue('');
    setOwnerType(null);
    speakText('पुनः प्रयास करें। ' + STEPS[currentStep].speak);
  };

  const handleSave = async (): Promise<void> => {
    setIsLoading(true);
    try {
      // Duplicate check before saving
      const dup = await checkDuplicate(formData.name, formData.date);
      if (dup) {
        Alert.alert(
          'डुप्लीकेट रिकॉर्ड',
          `"${formData.name}" का ${formData.date} को रिकॉर्ड पहले से मौजूद है।\nक्या आप फिर भी सहेजना चाहते हैं?`,
          [
            { text: 'रद्द करें', style: 'cancel', onPress: () => setIsLoading(false) },
            {
              text: 'फिर भी सहेजें',
              style: 'destructive',
              onPress: async () => {
                await performSave();
              },
            },
          ]
        );
        return;
      }
      await performSave();
    } catch {
      Alert.alert('त्रुटि', 'सहेजने में समस्या। कृपया पुनः प्रयास करें।');
    } finally {
      setIsLoading(false);
    }
  };

  const performSave = async () => {
    await saveTicket({
      farmer_code: formData.farmer_code,
      name: formData.name,
      fatherName: formData.fatherName,
      caneOwner: formData.caneOwner,
      date: formData.date,
      quantity: parseFloat(formData.quantity),
      comment: formData.comment,
    });
    setShowSummaryModal(false);
    setSavedSuccess(true);
    speakText('रिकॉर्ड सफलतापूर्वक सहेजा गया!');
    setTimeout(() => { setSavedSuccess(false); resetForm(); }, 2500);
    setIsLoading(false);
  };

  const resetForm = (): void => {
    setCurrentStep(0);
    setFormData({ farmer_code: '', name: '', fatherName: '', caneOwner: '', date: '', quantity: '', comment: '' });
    setInputValue('');
    setConfirmedValues({});
    setMicError('');
    setTimeout(() => speakText(STEPS[0].speak), 300);
  };

  const step = STEPS[currentStep];
  const progress = (currentStep / STEPS.length) * 100;
  const isDateStep = step.key === 'date';
  const isCommentStep = step.key === 'comment';
  const isOwnerStep = step.key === 'caneOwner';
  const dateComplete = inputValue.length === 10;
  const dateValid = dateComplete && isValidDate(inputValue);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <View style={[styles.safe, { paddingTop: insets.top || 20 }]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {savedSuccess && (
            <View style={styles.successBanner}>
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={styles.successText}>✅ रिकॉर्ड सफलतापूर्वक सहेजा गया!</Text>
            </View>
          )}

          <View style={styles.seasonRow}>
            <SeasonSelector />
          </View>

          {/* Progress */}
          <View style={styles.progressWrap}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
            <Text style={styles.progressText}>चरण {currentStep + 1} / {STEPS.length}</Text>
          </View>

          {/* Step Dots */}
          <View style={styles.stepsRow}>
            {STEPS.map((s, i) => (
              <View key={s.key} style={styles.stepItem}>
                <View style={[styles.dot, i < currentStep && styles.dotDone, i === currentStep && styles.dotActive]}>
                  {i < currentStep
                    ? <Ionicons name="checkmark" size={12} color="#fff" />
                    : <Text style={[styles.dotNum, i === currentStep && { color: '#f0a500' }]}>{i + 1}</Text>}
                </View>
                <Text style={[styles.dotLabel, i === currentStep && { color: '#f0a500' }]}>{s.labelHindi}</Text>
              </View>
            ))}
          </View>

          {/* Card */}
          <View style={styles.card}>

            {/* TTS speaker */}
            <View style={styles.speakerRow}>
              <Animated.View style={[styles.speakerCircle, {
                transform: [{ scale: speaker.anim }],
                borderColor: isSpeaking ? '#f0a500' : '#2d2d4e',
                backgroundColor: isSpeaking ? 'rgba(240,165,0,0.15)' : '#0f0f1e',
              }]}>
                <Ionicons name={isSpeaking ? 'volume-high' : 'volume-medium-outline'} size={24} color={isSpeaking ? '#f0a500' : '#666'} />
              </Animated.View>
              <View style={{ flex: 1 }}>
                <Text style={styles.micLabel}>{step.labelHindi} / {step.label}</Text>
                <Text style={styles.micHindi}>{step.promptHindi}</Text>
                <Text style={styles.micEn}>{step.promptEn}</Text>
              </View>
            </View>

            {/* ── DATE STEP ── */}
            {isDateStep ? (
              <View style={styles.dateWrapper}>
                <View style={styles.segmentRow}>
                  <View style={[styles.segment, inputValue.length >= 2 && styles.segmentFilled]}>
                    <Text style={styles.segLabel}>DD</Text>
                    <Text style={styles.segValue}>{inputValue.slice(0, 2) || '--'}</Text>
                  </View>
                  <Text style={styles.segSep}>/</Text>
                  <View style={[styles.segment, inputValue.length >= 5 && styles.segmentFilled]}>
                    <Text style={styles.segLabel}>MM</Text>
                    <Text style={styles.segValue}>{inputValue.slice(3, 5) || '--'}</Text>
                  </View>
                  <Text style={styles.segSep}>/</Text>
                  <View style={[styles.segment, styles.segmentWide, dateComplete && styles.segmentFilled]}>
                    <Text style={styles.segLabel}>YYYY</Text>
                    <Text style={styles.segValue}>{inputValue.slice(6, 10) || '----'}</Text>
                  </View>
                  {dateComplete && (
                    <Ionicons
                      name={dateValid ? 'checkmark-circle' : 'close-circle'}
                      size={24}
                      color={dateValid ? '#2ecc71' : '#e74c3c'}
                      style={{ marginLeft: 8 }}
                    />
                  )}
                </View>

                <View style={styles.inputRow}>
                  <TextInput
                    style={[styles.input, isListening && styles.inputListening]}
                    value={inputValue}
                    onChangeText={handleInputChange}
                    placeholder="DD/MM/YYYY"
                    placeholderTextColor="#555"
                    keyboardType="numeric"
                    maxLength={10}
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={handleNext}
                  />
                  <Animated.View style={{ transform: [{ scale: mic.anim }] }}>
                    <View
                      {...micPanResponder.panHandlers}
                      style={[styles.sttBtn, isListening && styles.sttBtnActive]}
                    >
                      <Ionicons name={isListening ? 'mic' : 'mic-outline'} size={22} color={isListening ? '#fff' : '#f0a500'} />
                    </View>
                  </Animated.View>
                </View>

                <Text style={[styles.dateHint, dateComplete && !dateValid && { color: '#e74c3c' }]}>
                  {!inputValue
                    ? '📅 अंक टाइप करें — / अपने आप जुड़ेगा'
                    : dateComplete
                      ? dateValid ? '✅ सही तारीख' : '❌ गलत तारीख'
                      : `${10 - inputValue.length} अंक और चाहिए`}
                </Text>
              </View>

            ) : isCommentStep ? (
              /* ── COMMENT STEP ── */
              <View style={styles.commentWrapper}>
                <View style={styles.inputRow}>
                  <TextInput
                    style={[styles.input, styles.commentInput, isListening && styles.inputListening]}
                    value={inputValue} onChangeText={setInputValue}
                    placeholder={step.placeholder} placeholderTextColor="#555"
                    keyboardType="default" multiline numberOfLines={4}
                    autoCorrect={false} textAlignVertical="top"
                  />
                </View>
                <View style={styles.commentMicRow}>
                  <Animated.View style={{ transform: [{ scale: mic.anim }] }}>
                    <View {...micPanResponder.panHandlers}
                      style={[styles.sttBtnLarge, isListening && styles.sttBtnActive]}>
                      <Ionicons name={isListening ? 'mic' : 'mic-outline'} size={28} color={isListening ? '#fff' : '#f0a500'} />
                      <Text style={[styles.holdText, isListening && { color: '#fff' }]}>
                        {isListening ? 'रिकॉर्ड हो रहा है...' : 'माइक दबाएं'}
                      </Text>
                    </View>
                  </Animated.View>
                </View>
                <Text style={styles.optionalHint}>⬆ वैकल्पिक — यह चरण छोड़ सकते हैं</Text>
              </View>

            ) : isOwnerStep ? (
              /* ── OWNER STEP ── */
              <View>
                <TouchableOpacity
                  style={[styles.ownerOption, ownerType === 'self' && styles.ownerOptionSelected]}
                  onPress={() => { setOwnerType('self'); setInputValue('मेरा गन्ना'); }}
                >
                  <View style={[styles.radioCircle, ownerType === 'self' && styles.radioSelected]}>
                    {ownerType === 'self' && <View style={styles.radioDot} />}
                  </View>
                  <Text style={[styles.ownerOptionTitle, ownerType === 'self' && { color: '#2ecc71' }]}>
                    मेरा खुद का गन्ना है
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.ownerOption, ownerType === 'other' && styles.ownerOptionOtherSelected]}
                  onPress={() => { setOwnerType('other'); setInputValue(''); }}
                >
                  <View style={[styles.radioCircle, ownerType === 'other' && styles.radioOtherSelected]}>
                    {ownerType === 'other' && <View style={styles.radioDotOther} />}
                  </View>
                  <Text style={[styles.ownerOptionTitle, ownerType === 'other' && { color: '#f0a500' }]}>
                    दूसरे का गन्ना है
                  </Text>
                </TouchableOpacity>

                {ownerType === 'other' && (
                  <View style={styles.inputRow}>
                    <TextInput
                      style={styles.input}
                      value={inputValue}
                      onChangeText={setInputValue}
                      placeholder="मालिक का नाम / Owner Name"
                      placeholderTextColor="#555"
                      autoCorrect={false}
                      autoFocus
                      returnKeyType="done"
                      onSubmitEditing={handleNext}
                    />
                    <Animated.View style={{ transform: [{ scale: mic.anim }] }}>
                      <View
                        {...micPanResponder.panHandlers}
                        style={[styles.sttBtn, isListening && styles.sttBtnActive]}
                      >
                        <Ionicons name={isListening ? 'mic' : 'mic-outline'} size={22} color={isListening ? '#fff' : '#f0a500'} />
                      </View>
                    </Animated.View>
                  </View>
                )}
              </View>
            ) : (
              /* ── OTHER STEPS ── */
              <View style={styles.inputRow}>
                <TextInput
                  style={[styles.input, isListening && styles.inputListening]}
                  value={inputValue}
                  onChangeText={handleInputChange}
                  placeholder={step.placeholder}
                  placeholderTextColor="#555"
                  keyboardType={step.keyboardType}
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleNext}
                />
                <Animated.View style={{ transform: [{ scale: mic.anim }] }}>
                  <View
                    {...micPanResponder.panHandlers}
                    style={[styles.sttBtn, isListening && styles.sttBtnActive]}
                  >
                    <Ionicons name={isListening ? 'mic' : 'mic-outline'} size={22} color={isListening ? '#fff' : '#f0a500'} />
                  </View>
                </Animated.View>
              </View>
            )}

            {/* Hold-to-record hint */}
            {!isCommentStep && (
              <View style={styles.holdHintRow}>
                <Ionicons name="information-circle-outline" size={13} color="#555" />
                <Text style={styles.holdHintText}>माइक दबाकर रखें और बोलें</Text>
              </View>
            )}

            {/* Listening bar */}
            {isListening && (
              <View style={styles.listeningBar}>
                <View style={styles.listeningDot} />
                <Text style={styles.listeningText}>सुन रहा है...</Text>
                <TouchableOpacity onPress={stopListening}>
                  <Text style={styles.stopText}>रोकें</Text>
                </TouchableOpacity>
              </View>
            )}

            {!!micError && <Text style={styles.micErrorText}>⚠ {micError}</Text>}

            <TouchableOpacity style={styles.replayBtn} onPress={() => speakText(step.speak)}>
              <Ionicons name="volume-medium-outline" size={16} color="#f0a500" />
              <Text style={styles.replayText}>प्रश्न दोहराएं</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.nextBtn} onPress={handleNext} activeOpacity={0.8}>
              <Text style={styles.nextBtnText}>
                {isCommentStep ? 'समाप्त करें →'
                  : currentStep < STEPS.length - 1 ? 'आगे →'
                    : 'समीक्षा करें'}
              </Text>
            </TouchableOpacity>
            {currentStep > 0 && (<TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.8}>
              <Text style={styles.backBtnText}>
                ↲ पीछे
              </Text>
            </TouchableOpacity>)}

            {isCommentStep && (
              <TouchableOpacity style={styles.skipBtn} onPress={() => handleConfirmWithValue('')}>
                <Text style={styles.skipBtnText}>टिप्पणी छोड़ें</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Confirmed values */}
          {Object.keys(confirmedValues).length > 0 && (
            <View style={styles.confirmedCard}>
              <Text style={styles.confirmedTitle}>✔ पुष्टि की गई</Text>
              {(Object.entries(confirmedValues) as [keyof FormData, string][]).map(([key, val]) => {
                const s = STEPS.find(x => x.key === key);
                return (
                  <View key={key} style={styles.confirmedRow}>
                    <Text style={styles.confirmedKey}>{s?.labelHindi}:</Text>
                    <Text style={styles.confirmedVal}>{val}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {currentStep > 0 && (
            <TouchableOpacity style={styles.resetBtn} onPress={resetForm}>
              <Ionicons name="refresh" size={14} color="#e74c3c" />
              <Text style={styles.resetText}>फिर से शुरू करें</Text>
            </TouchableOpacity>
          )}

          {/* Confirm Modal */}
          <Modal visible={showConfirmModal} transparent animationType="fade">
            <View style={styles.overlay}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>पुष्टि करें</Text>
                <Text style={styles.modalSubtitle}>{step?.labelHindi} / {step?.label}</Text>
                <View style={styles.modalValueBox}><Text style={styles.modalValue}>{inputValue}</Text></View>
                <Text style={styles.modalQuestion}>क्या यह सही है?</Text>
                <View style={styles.modalBtns}>
                  <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#e74c3c' }]} onPress={handleConfirmNo}>
                    <Ionicons name="close" size={18} color="#fff" /><Text style={styles.modalBtnText}>नहीं</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#2ecc71' }]} onPress={handleConfirmYes}>
                    <Ionicons name="checkmark" size={18} color="#fff" /><Text style={styles.modalBtnText}>हाँ</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* ── Farmer Found Modal ── */}
          <Modal visible={showFarmerModal} transparent animationType="fade">
            <View style={styles.overlay}>
              <View style={styles.modalCard}>
                <View style={styles.farmerModalHeader}>
                  <Ionicons name="person-circle-outline" size={48} color="#f0a500" />
                  <Text style={styles.farmerModalTitle}>किसान मिला</Text>
                </View>

                <View style={styles.farmerInfoCard}>
                  <View style={styles.farmerInfoRow}>
                    <View style={styles.farmerInfoIcon}>
                      <Ionicons name="person-outline" size={16} color="#f0a500" />
                    </View>
                    <View>
                      <Text style={styles.farmerInfoLabel}>नाम</Text>
                      <Text style={styles.farmerInfoValue}>{foundPerson?.name}</Text>
                    </View>
                  </View>

                  <View style={styles.farmerDivider} />

                  <View style={styles.farmerInfoRow}>
                    <View style={styles.farmerInfoIcon}>
                      <Ionicons name="people-outline" size={16} color="#f0a500" />
                    </View>
                    <View>
                      <Text style={styles.farmerInfoLabel}>पिता का नाम</Text>
                      <Text style={styles.farmerInfoValue}>{foundPerson?.fatherName}</Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.farmerModalQuestion}>क्या यह सही है?</Text>

                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: '#e74c3c' }]}
                    onPress={() => {
                      setShowFarmerModal(false);
                      setFoundPerson(null);
                      setCurrentStep(1);
                      setTimeout(() => speakText(STEPS[1].speak), 400);
                    }}
                  >
                    <Ionicons name="close" size={18} color="#fff" />
                    <Text style={styles.modalBtnText}>नहीं</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: '#2ecc71' }]}
                    onPress={() => {
                      if (!foundPerson) return;
                      setFormData(prev => ({
                        ...prev,
                        name: foundPerson.name,
                        fatherName: foundPerson.fatherName,
                      }));
                      setConfirmedValues(prev => ({
                        ...prev,
                        name: foundPerson.name,
                        fatherName: foundPerson.fatherName,
                      }));
                      setShowFarmerModal(false);
                      setFoundPerson(null);
                      setCurrentStep(3);
                      setTimeout(() => speakText(`${foundPerson.name} की पुष्टि हुई। ${STEPS[3].speak}`), 400);
                    }}
                  >
                    <Ionicons name="checkmark" size={18} color="#fff" />
                    <Text style={styles.modalBtnText}>हाँ</Text>
                  </TouchableOpacity>
                </View>

              </View>
            </View>
          </Modal>

          {/* Summary Modal */}
          <Modal visible={showSummaryModal} transparent animationType="slide">
            <View style={styles.overlay}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>📋 समीक्षा</Text>
                <View style={{ marginTop: 12, marginBottom: 16 }}>
                  {STEPS.map(s => (
                    <View key={s.key} style={styles.summaryRow}>
                      <Text style={styles.summaryKey}>{s.labelHindi}:</Text>
                      <Text style={styles.summaryVal}>{formData[s.key]}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.modalBtns}>
                  <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#e74c3c' }]} onPress={() => { setShowSummaryModal(false); resetForm(); }}>
                    <Ionicons name="close" size={18} color="#fff" /><Text style={styles.modalBtnText}>रद्द करें</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#2ecc71' }]} onPress={handleSave} disabled={isLoading}>
                    {isLoading
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <><Ionicons name="save" size={18} color="#fff" /><Text style={styles.modalBtnText}>सहेजें</Text></>}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f1e' },
  content: { padding: 16, paddingBottom: 5 },

  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },

  successBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#2ecc71', borderRadius: 10, padding: 12, marginBottom: 14 },
  successText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  progressWrap: { marginBottom: 14 },
  progressTrack: { height: 5, backgroundColor: '#2d2d4e', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 5, backgroundColor: '#f0a500', borderRadius: 3 },
  progressText: { color: '#666', fontSize: 11, marginTop: 5, textAlign: 'right' },

  stepsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 18 },
  stepItem: { alignItems: 'center', gap: 4 },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: '#2d2d4e', backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center' },
  dotActive: { borderColor: '#f0a500', backgroundColor: 'rgba(240,165,0,0.1)' },
  dotDone: { backgroundColor: '#2ecc71', borderColor: '#2ecc71' },
  dotNum: { color: '#666', fontSize: 11, fontWeight: '700' },
  dotLabel: { color: '#555', fontSize: 9, fontWeight: '600' },

  card: { backgroundColor: '#1a1a2e', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#2d2d4e', marginBottom: 14 },

  speakerRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 16 },
  speakerCircle: { width: 50, height: 50, borderRadius: 25, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  micLabel: { color: '#f0a500', fontSize: 16, fontWeight: '700', marginBottom: 3 },
  micHindi: { color: '#ccc', fontSize: 12, marginBottom: 2 },
  micEn: { color: '#888', fontSize: 11 },

  // ── Date ──
  dateWrapper: { marginBottom: 10 },
  segmentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 12 },
  segment: { backgroundColor: '#0f0f1e', borderRadius: 10, borderWidth: 1.5, borderColor: '#2d2d4e', paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', minWidth: 58 },
  segmentWide: { minWidth: 78 },
  segmentFilled: { borderColor: '#f0a500', backgroundColor: 'rgba(240,165,0,0.08)' },
  segLabel: { color: '#555', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  segValue: { color: '#f0f0f0', fontSize: 20, fontWeight: '800' },
  segSep: { color: '#f0a500', fontSize: 24, fontWeight: '900', marginBottom: 4 },
  dateHint: { color: '#666', fontSize: 11, textAlign: 'center', marginTop: 4, marginBottom: 6 },

  // Comment
  commentWrapper: { marginBottom: 10 },
  commentInput: { height: 100, textAlignVertical: 'top', paddingTop: 12 },
  commentMicRow: { alignItems: 'center', marginTop: 12, marginBottom: 6 },
  sttBtnLarge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 24, borderRadius: 30,
    backgroundColor: '#1a1a2e', borderWidth: 1.5,
    borderColor: 'rgba(240,165,0,0.5)',
  },
  holdText: { color: '#f0a500', fontSize: 13, fontWeight: '600' },
  optionalHint: { color: '#555', fontSize: 11, textAlign: 'center' },

  holdHintRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  holdHintText: { color: '#555', fontSize: 11 },

  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  input: { flex: 1, backgroundColor: '#0f0f1e', borderRadius: 10, padding: 13, color: '#f0f0f0', fontSize: 16, fontWeight: '600', borderWidth: 1.5, borderColor: '#2d2d4e' },
  inputListening: { borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.06)' },

  sttBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#1a1a2e', borderWidth: 1.5, borderColor: 'rgba(240,165,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  sttBtnActive: { backgroundColor: '#e74c3c', borderColor: '#e74c3c' },

  listeningBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(231,76,60,0.1)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(231,76,60,0.3)' },
  listeningDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#e74c3c' },
  listeningText: { flex: 1, color: '#e74c3c', fontSize: 12, fontWeight: '600' },
  stopText: { color: '#e74c3c', fontSize: 12, fontWeight: '800', textDecorationLine: 'underline' },
  micErrorText: { color: '#e74c3c', fontSize: 11, marginBottom: 8 },

  replayBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  replayText: { color: '#f0a500', fontSize: 12 },

  backBtn: { backgroundColor: '#000000', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 5 },
  nextBtn: { backgroundColor: '#f0a500', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 5 },
  backBtnText: { color: '#f0a500', fontSize: 16, fontWeight: '800' },
  nextBtnText: { color: '#1a1a2e', fontSize: 16, fontWeight: '800' },

  skipBtn: { alignItems: 'center', paddingVertical: 8 },
  skipBtnText: { color: '#666', fontSize: 13, textDecorationLine: 'underline' },

  confirmedCard: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(46,204,113,0.3)', marginBottom: 12 },
  confirmedTitle: { color: '#2ecc71', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  confirmedRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  confirmedKey: { color: '#888', fontSize: 12 },
  confirmedVal: { color: '#f0f0f0', fontSize: 12, fontWeight: '700', maxWidth: '55%', textAlign: 'right' },

  resetBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: 4 },
  resetText: { color: '#e74c3c', fontSize: 12 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#1a1a2e', borderRadius: 20, padding: 22, width: '100%', borderWidth: 1, borderColor: '#2d2d4e' },
  modalTitle: { color: '#f0a500', fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: 4 },
  modalSubtitle: { color: '#888', fontSize: 12, textAlign: 'center', marginBottom: 14 },
  modalValueBox: { backgroundColor: '#0f0f1e', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: 'rgba(240,165,0,0.4)', marginBottom: 10 },
  modalValue: { color: '#f0a500', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  modalQuestion: { color: '#ccc', fontSize: 13, textAlign: 'center', marginBottom: 18 },
  modalBtns: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  modalBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  ownerOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#0f0f1e', borderRadius: 10, padding: 14,
    marginBottom: 10, borderWidth: 1.5, borderColor: '#2d2d4e',
  },
  ownerOptionSelected: {
    borderColor: '#2ecc71', backgroundColor: 'rgba(46,204,113,0.08)',
  },
  ownerOptionOtherSelected: {
    borderColor: '#f0a500', backgroundColor: 'rgba(240,165,0,0.08)',
  },
  ownerOptionTitle: {
    color: '#f0f0f0', fontSize: 15, fontWeight: '700', flex: 1,
  },
  radioCircle: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: '#2d2d4e',
    alignItems: 'center', justifyContent: 'center',
  },
  radioSelected: { borderColor: '#2ecc71' },
  radioOtherSelected: { borderColor: '#f0a500' },
  radioDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: '#2ecc71',
  },
  radioDotOther: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: '#f0a500',
  },

  farmerModalHeader: {
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  farmerModalTitle: {
    color: '#f0a500',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  farmerInfoCard: {
    backgroundColor: '#0f0f1e',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(240,165,0,0.3)',
    marginBottom: 16,
  },
  farmerInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  farmerInfoIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(240,165,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  farmerInfoLabel: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  farmerInfoValue: {
    color: '#f0f0f0',
    fontSize: 17,
    fontWeight: '800',
  },
  farmerDivider: {
    height: 1,
    backgroundColor: '#2d2d4e',
    marginVertical: 12,
  },
  farmerModalQuestion: {
    color: '#ccc',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 18,
  },

  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  summaryKey: { color: '#888', fontSize: 13 },
  summaryVal: { color: '#f0f0f0', fontSize: 14, fontWeight: '700', maxWidth: '55%', textAlign: 'right' },
});