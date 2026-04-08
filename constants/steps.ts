import { KeyboardTypeOptions } from 'react-native';
import { FormData } from '../types';

export interface Step {
  key: keyof FormData;
  label: string;
  labelHindi: string;
  promptHindi: string;
  promptEn: string;
  speak: string;
  placeholder: string;
  keyboardType: KeyboardTypeOptions;
  multiline?: boolean;
}

export const STEPS: Step[] = [
  {
    key: 'farmer_code',
    label: 'Farmer Code',
    labelHindi: 'किसान कोड',
    promptHindi: 'कृपया व्यक्ति का किसान कोड दर्ज करें।',
    promptEn: "Please say the farmer code of person (Hindi or English).",
    speak: 'कृपया व्यक्ति का किसान कोड बोलें।',
    placeholder: 'किसान कोड / Farmer Code',
    keyboardType: 'default',
  },
  {
    key: 'name',
    label: 'Name',
    labelHindi: 'नाम',
    promptHindi: 'कृपया व्यक्ति का नाम दर्ज करें।',
    promptEn: "Please say the person's name (Hindi or English).",
    speak: 'कृपया व्यक्ति का नाम बोलें।',
    placeholder: 'नाम / Name',
    keyboardType: 'default',
  },
  {
    key: 'fatherName',
    label: 'Father Name',
    labelHindi: 'पिता का नाम',
    promptHindi: 'कृपया पिता का नाम दर्ज करें।',
    promptEn: "Please say the father's name.",
    speak: 'कृपया पिता का नाम बोलें।',
    placeholder: 'पिता का नाम / Father Name',
    keyboardType: 'default',
  },
  {
    key: 'date',
    label: 'Date',
    labelHindi: 'तारीख',
    promptHindi: 'तारीख दर्ज करें (DD/MM/YYYY)',
    promptEn: 'Enter date in DD/MM/YYYY format.',
    speak: 'कृपया तारीख दर्ज करें।',
    placeholder: 'DD/MM/YYYY',
    keyboardType: 'numeric',
  },
  {
    key: 'quantity',
    label: 'Quantity',
    labelHindi: 'मात्रा (क्विंटल)',
    promptHindi: 'मात्रा दर्ज करें (दशमलव मान्य है)',
    promptEn: 'Say the quantity. Decimal numbers allowed, e.g. 12.5',
    speak: 'कृपया मात्रा बोलें।',
    placeholder: 'मात्रा / Quantity (e.g. 12.5)',
    keyboardType: 'numeric',
  },
  {
    key: 'comment',
    label: 'Comment',
    labelHindi: 'टिप्पणी',
    promptHindi: 'कोई टिप्पणी दर्ज करें (वैकल्पिक)',
    promptEn: 'Add any comment or note (optional).',
    speak: 'कोई टिप्पणी या नोट जोड़ें। यह वैकल्पिक है।',
    placeholder: 'टिप्पणी / Comment (optional)',
    keyboardType: 'default',
    multiline: true,
  },
];
