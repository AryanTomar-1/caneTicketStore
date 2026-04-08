import React, { useState, useRef, useEffect } from 'react';
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
  KeyboardTypeOptions,
  PanResponder,
} from 'react-native';
import { STEPS } from '../../constants/steps';
import { useMicPulse, useSpeakerPulse } from '../../hooks/useMicPulse';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { saveTicket } from '../../utils/storage';
import { FormData, ConfirmedValues } from '../../types';


// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Convert raw digits (or partial DD/MM/YYYY string) into formatted DD/MM/YYYY */
const formatDateInput = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

/** Full DD/MM/YYYY validation */
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
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [formData, setFormData] = useState<FormData>({ farmer_code: '', name: '', fatherName: '', date: '', quantity: '', comment: '' });
  const [inputValue, setInputValue] = useState<string>('');
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [showSummaryModal, setShowSummaryModal] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [confirmedValues, setConfirmedValues] = useState<ConfirmedValues>({});
  const [micError, setMicError] = useState<string>('');

  const pulseAnim = useRef<Animated.Value>(new Animated.Value(1)).current;
  const micPulseAnim = useRef<Animated.Value>(new Animated.Value(1)).current;

  const mic = useMicPulse();
  const speaker = useSpeakerPulse();

  // ── STT listeners ─────────────────────────────────────────────────────────
  useSpeechRecognitionEvent('start', () => { setIsListening(true); setMicError(''); });
  useSpeechRecognitionEvent('end', () => { setIsListening(false); mic.stop(); });
  useSpeechRecognitionEvent('result', (event) => {
    const result = event.results[0]?.transcript ?? '';
    if (result) setInputValue(cleanForStep(result, currentStep));
  });
  useSpeechRecognitionEvent('error', (event) => {
    setIsListening(false); mic.stop();
    if (event.error !== 'no-speech') setMicError('Mic error. Try again / माइक त्रुटि।');
  });

  useEffect(() => {
    setTimeout(() => speakText(STEPS[0].speak), 600);
    return () => { speaker.stop(); mic.stop(); };
  }, []);

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
    Speech.stop(); setIsSpeaking(true); speaker.start();
    Speech.speak(text, {
      language: 'hi-IN', pitch: 1.0, rate: 0.85,
      onDone: () => { setIsSpeaking(false); speaker.stop(); },
      onError: () => { setIsSpeaking(false); speaker.stop(); },
      onStopped: () => { setIsSpeaking(false); speaker.stop(); },
    });
  };

  // ── STT ───────────────────────────────────────────────────────────────────
  const startListening = async (): Promise<void> => {
    setMicError(''); setInputValue('');
    try {
      const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!granted) return;
      ExpoSpeechRecognitionModule.start({ lang: 'hi-IN', interimResults: true });
      mic.start();
      mic.start();
    } catch (e) {
      setMicError('Could not start mic / माइक शुरू नहीं हो सका');
    }
  };

  const stopListening = async (): Promise<void> => {
    ExpoSpeechRecognitionModule.stop();
    setIsListening(false); mic.stop();
  };

  const micPanResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { startListening(); },
    onPanResponderRelease: () => { stopListening(); },
    onPanResponderTerminate: () => { stopListening(); },
  });

  // ── Date input handler ────────────────────────────────────────────────────
  const handleDateChange = (text: string): void => {
    // Backspace: allow deletion cleanly
    if (text.length < inputValue.length) {
      const stripped = text.endsWith('/') ? text.slice(0, -1) : text;
      setInputValue(stripped);
      return;
    }
    setInputValue(formatDateInput(text));
  };

  const handleInputChange = (text: string): void => {
    STEPS[currentStep].key === 'date' ? handleDateChange(text) : setInputValue(text);
  };

  // ── Form handlers ─────────────────────────────────────────────────────────
  const handleNext = (): void => {
    const step = STEPS[currentStep];
    const value = inputValue.trim();
    if (!value) { Alert.alert('Required / आवश्यक', `Please enter ${step.labelHindi} / ${step.label}`); return; }
    if (step.key === 'date') {
      if (value.length < 10) { Alert.alert('Incomplete Date', 'Please enter a complete date: DD/MM/YYYY'); return; }
      if (!isValidDate(value)) { Alert.alert('Invalid Date / गलत तारीख', `"${value}" is not valid.\nकृपया सही तारीख दर्ज करें।`); return; }
    }
    if (step.key === 'quantity' && isNaN(parseFloat(value))) {
      Alert.alert('Invalid', 'Please enter a valid number.\nकृपया एक सही संख्या दर्ज करें।'); return;
    }
    if (isListening) stopListening();
    setShowConfirmModal(true);
    speakText(`You entered ${value}. Is this correct?`);
  };

  const handleConfirmYes = (): void => {
    const step = STEPS[currentStep];
    const value = inputValue.trim();
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

  const handleConfirmNo = (): void => {
    setShowConfirmModal(false); setInputValue('');
    speakText('Let us try again. ' + STEPS[currentStep].speak);
  };

  const handleSave = async (): Promise<void> => {
    setIsLoading(true);
    try {
      await saveTicket({ farmer_code: formData.farmer_code, name: formData.name, fatherName: formData.fatherName, date: formData.date, quantity: parseFloat(formData.quantity), comment: formData.comment });
      setShowSummaryModal(false); setSavedSuccess(true);
      speakText('Record saved successfully!');
      setTimeout(() => { setSavedSuccess(false); resetForm(); }, 2500);
    } catch { Alert.alert('Error', 'Failed to save. Please try again.'); }
    finally { setIsLoading(false); }
  };

  const resetForm = (): void => {
    setCurrentStep(0);
    setFormData({ farmer_code: '', name: '', fatherName: '', date: '', quantity: '', comment: '' });
    setInputValue(''); setConfirmedValues({}); setMicError('');
    setTimeout(() => speakText(STEPS[0].speak), 300);
  };

  const step = STEPS[currentStep];
  const progress = (currentStep / STEPS.length) * 100;
  const isDateStep = step.key === 'date';
  const isCommentStep = step.key === 'comment';
  const dateComplete = inputValue.length === 10;
  const dateValid = dateComplete && isValidDate(inputValue);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {savedSuccess && (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
            <Text style={styles.successText}>✅ रिकॉर्ड सफलतापूर्वक सहेजा गया!</Text>
          </View>
        )}

        {/* Progress */}
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.progressText}>Step {currentStep + 1} of {STEPS.length}</Text>
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
            <Animated.View style={[styles.speakerCircle, { transform: [{ scale: pulseAnim }], borderColor: isSpeaking ? '#f0a500' : '#2d2d4e', backgroundColor: isSpeaking ? 'rgba(240,165,0,0.15)' : '#0f0f1e' }]}>
              <Ionicons name={isSpeaking ? 'volume-high' : 'volume-medium-outline'} size={24} color={isSpeaking ? '#f0a500' : '#666'} />
            </Animated.View>
            <View style={{ flex: 1 }}>
              <Text style={styles.micLabel}>{step.labelHindi} / {step.label}</Text>
              <Text style={styles.micHindi}>{step.promptHindi}</Text>
              <Text style={styles.micEn}>{step.promptEn}</Text>
            </View>
          </View>

          {/* ── DATE STEP: segmented display + numeric input ── */}
          {isDateStep ? (
            <View style={styles.dateWrapper}>

              {/* DD / MM / YYYY visual segments */}
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

              {/* Input + mic */}
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
                <Animated.View style={{ transform: [{ scale: micPulseAnim }] }}>
                  <View
                    {...micPanResponder.panHandlers}
                    style={[styles.sttBtn, isListening && styles.sttBtnActive]}
                  >
                    <Ionicons name={isListening ? 'mic' : 'mic-outline'} size={22} color={isListening ? '#fff' : '#f0a500'} />
                  </View>
                </Animated.View>
              </View>

              {/* Hint text */}
              <Text style={[styles.dateHint, dateComplete && !dateValid && { color: '#e74c3c' }]}>
                {!inputValue
                  ? '📅 Type digits — / added automatically'
                  : dateComplete
                    ? dateValid ? '✅ Valid date / सही तारीख' : '❌ Invalid date / गलत तारीख'
                    : `${10 - inputValue.length} more digit${10 - inputValue.length !== 1 ? 's' : ''} needed`}
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
              {/* Mic button below for comment (larger target) */}
              <View style={styles.commentMicRow}>
                <Animated.View style={{ transform: [{ scale: micPulseAnim }] }}>
                  <View {...micPanResponder.panHandlers} style={[styles.sttBtnLarge, isListening && styles.sttBtnActive]}>
                    <Ionicons name={isListening ? 'mic' : 'mic-outline'} size={28} color={isListening ? '#fff' : '#f0a500'} />
                    <Text style={[styles.holdText, isListening && { color: '#fff' }]}>
                      {isListening ? 'Recording...' : 'Hold to speak'}
                    </Text>
                  </View>
                </Animated.View>
              </View>
              <Text style={styles.optionalHint}>⬆ Optional / वैकल्पिक — you can skip this step</Text>
            </View>

          ) : (
            /* ── OTHER STEPS: normal input + mic ── */
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
              <Animated.View style={{ transform: [{ scale: micPulseAnim }] }}>
                <View
                  {...micPanResponder.panHandlers}
                  style={[styles.sttBtn, isListening && styles.sttBtnActive]}
                >
                  <Ionicons name={isListening ? 'mic' : 'mic-outline'} size={22} color={isListening ? '#fff' : '#f0a500'} />
                </View>
              </Animated.View>
            </View>
          )}

          {/* Hold-to-record hint (not shown on comment step — it has its own) */}
          {!isCommentStep && (
            <View style={styles.holdHintRow}>
              <Ionicons name="information-circle-outline" size={13} color="#555" />
              <Text style={styles.holdHintText}>Hold mic button to record / माइक दबाकर रखें</Text>
            </View>
          )}

          {/* Listening bar */}
          {isListening && (
            <View style={styles.listeningBar}>
              <View style={styles.listeningDot} />
              <Text style={styles.listeningText}>सुन रहा है... / Listening...</Text>
              <TouchableOpacity onPress={stopListening}><Text style={styles.stopText}>Stop</Text></TouchableOpacity>
            </View>
          )}

          {!!micError && <Text style={styles.micErrorText}>⚠ {micError}</Text>}

          <TouchableOpacity style={styles.replayBtn} onPress={() => speakText(step.speak)}>
            <Ionicons name="volume-medium-outline" size={16} color="#f0a500" />
            <Text style={styles.replayText}>Repeat Question / प्रश्न दोहराएं</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.nextBtn} onPress={handleNext} activeOpacity={0.8}>
            <Text style={styles.nextBtnText}>
              {isCommentStep ? 'Finish / समाप्त करें →'
                : currentStep < STEPS.length - 1 ? 'Next / आगे →'
                  : 'Review / समीक्षा करें'}
            </Text>
          </TouchableOpacity>

          {isCommentStep && (
            <TouchableOpacity style={styles.skipBtn} onPress={() => handleConfirmWithValue('')}>
              <Text style={styles.skipBtnText}>Skip Comment / टिप्पणी छोड़ें</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Confirmed values */}
        {Object.keys(confirmedValues).length > 0 && (
          <View style={styles.confirmedCard}>
            <Text style={styles.confirmedTitle}>✔ Confirmed / पुष्टि की गई</Text>
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
            <Text style={styles.resetText}>Start Over / फिर से शुरू करें</Text>
          </TouchableOpacity>
        )}

        {/* Confirm Modal */}
        <Modal visible={showConfirmModal} transparent animationType="fade">
          <View style={styles.overlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Confirm / पुष्टि करें</Text>
              <Text style={styles.modalSubtitle}>{step?.labelHindi} / {step?.label}</Text>
              <View style={styles.modalValueBox}><Text style={styles.modalValue}>{inputValue}</Text></View>
              <Text style={styles.modalQuestion}>Is this correct? / क्या यह सही है?</Text>
              <View style={styles.modalBtns}>
                <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#e74c3c' }]} onPress={handleConfirmNo}>
                  <Ionicons name="close" size={18} color="#fff" /><Text style={styles.modalBtnText}>No / नहीं</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#2ecc71' }]} onPress={handleConfirmYes}>
                  <Ionicons name="checkmark" size={18} color="#fff" /><Text style={styles.modalBtnText}>Yes / हाँ</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Summary Modal */}
        <Modal visible={showSummaryModal} transparent animationType="slide">
          <View style={styles.overlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>📋 Review Record / समीक्षा</Text>
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
                  <Ionicons name="close" size={18} color="#fff" /><Text style={styles.modalBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#2ecc71' }]} onPress={handleSave} disabled={isLoading}>
                  {isLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Ionicons name="save" size={18} color="#fff" /><Text style={styles.modalBtnText}>Save / सहेजें</Text></>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f1e' },
  content: { padding: 16, paddingBottom: 40 },

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

  // Hold hint
  holdHintRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  holdHintText: { color: '#555', fontSize: 11 },

  // ── Input row ──
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

  nextBtn: { backgroundColor: '#f0a500', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
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

  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  summaryKey: { color: '#888', fontSize: 13 },
  summaryVal: { color: '#f0f0f0', fontSize: 14, fontWeight: '700', maxWidth: '55%', textAlign: 'right' },
});