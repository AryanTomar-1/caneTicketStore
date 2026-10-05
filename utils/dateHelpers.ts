/** Convert raw digits into DD/MM/YYYY as user types */
export const formatDateInput = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

/** Validate a complete DD/MM/YYYY date string */
export const isValidDate = (value: string): boolean => {
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

/** Return today's date as DD/MM/YYYY */
export const todayFormatted = (): string => {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

/** Return yesterday's date as DD/MM/YYYY */
export const yesterdayFormatted = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

/**
 * Compare two DD/MM/YYYY dates.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export const compareDDMMYYYY = (a: string, b: string): number => {
  const toTimestamp = (s: string) => {
    const parts = s.split('/');
    if (parts.length !== 3) return 0;
    const [dd, mm, yyyy] = parts.map(Number);
    return new Date(yyyy, mm - 1, dd).getTime();
  };
  return toTimestamp(a) - toTimestamp(b);
};

/**
 * Sanitize free-form date search strings (e.g. "2024", "03/2024", "15/03")
 * WITHOUT forcing the DD/MM/YYYY format. Used by the Dashboard date filter only.
 * Keeps only digits and slashes, strips leading/trailing spaces.
 */
export const sanitizeFilterDate = (raw: string): string =>
  raw.replace(/[^\d/]/g, '').slice(0, 10);

export interface DateFilterValidation {
  isValid: boolean;
  error?: string;
  hint?: string;
}

export const HINDI_MONTHS = [
  '',
  'जनवरी',
  'फ़रवरी',
  'मार्च',
  'अप्रैल',
  'मई',
  'जून',
  'जुलाई',
  'अगस्त',
  'सितंबर',
  'अक्टूबर',
  'नवंबर',
  'दिसंबर',
];

/**
 * Validate free-form date filter inputs.
 * Accepts:
 * - Empty: valid (no filter)
 * - YYYY (e.g. 2025): year between 1900 and 2100
 * - DD (e.g. 15): day between 1 and 31
 * - MM/YYYY (e.g. 03/2026): valid month 1-12 and year 1900-2100
 * - DD/MM (e.g. 01/12): valid day 1-31 and month 1-12
 * - DD/MM/YYYY (e.g. 15/03/2026): valid day, month, year with calendar checks
 */
export const validateFilterDate = (filter: string): DateFilterValidation => {
  const f = filter.trim();
  if (!f) return { isValid: true, hint: '' };

  if (/[^\d/]/.test(f)) {
    return { isValid: false, error: 'केवल अंक और स्लैश (/) दर्ज करें।' };
  }

  const parts = f.split('/');
  if (parts.length > 3) {
    return { isValid: false, error: 'अमान्य फ़ॉर्मेट (अधिकतम 2 स्लैश / ही हो सकते हैं)' };
  }

  // 1. Single part: YYYY or DD
  if (parts.length === 1) {
    if (f.length === 4) {
      const y = parseInt(f, 10);
      if (isNaN(y) || y < 1900 || y > 2100) {
        return { isValid: false, error: 'अमान्य साल (उदा. 2024 - 2030)' };
      }
      return { isValid: true, hint: `साल ${y} की सभी पर्चियां` };
    }
    if (f.length <= 2) {
      const d = parseInt(f, 10);
      if (isNaN(d) || d < 1 || d > 31) {
        return { isValid: false, error: 'अमान्य दिन (दिन 1 से 31 के बीच होना चाहिए)' };
      }
      return { isValid: true, hint: `तारीख ${d} की सभी पर्चियां` };
    }
    return {
      isValid: false,
      error: 'अमान्य फ़ॉर्मेट (दिन, महीना या 4 अंकों का साल दर्ज करें)',
    };
  }

  // 2. Two parts: MM/YYYY or DD/MM
  if (parts.length === 2) {
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);

    // If second part is 4 digits -> MM/YYYY (e.g. 03/2026)
    if (parts[1].length === 4) {
      if (isNaN(p0) || p0 < 1 || p0 > 12) {
        return { isValid: false, error: 'अमान्य महीना (महीना 1 से 12 के बीच होना चाहिए)' };
      }
      if (isNaN(p1) || p1 < 1900 || p1 > 2100) {
        return { isValid: false, error: 'अमान्य साल (उदा. 2024 - 2030)' };
      }
      return { isValid: true, hint: `${HINDI_MONTHS[p0]} ${p1} की सभी पर्चियां` };
    } else {
      // DD/MM (e.g. 01/12)
      if (isNaN(p0) || p0 < 1 || p0 > 31) {
        return { isValid: false, error: 'अमान्य दिन (दिन 1 से 31 के बीच होना चाहिए)' };
      }
      if (isNaN(p1) || p1 < 1 || p1 > 12) {
        return { isValid: false, error: 'अमान्य महीना (महीना 1 से 12 के बीच होना चाहिए)' };
      }
      if (p1 === 2 && p0 > 29) {
        return { isValid: false, error: 'फ़रवरी में 29 से अधिक दिन नहीं होते' };
      }
      if ([4, 6, 9, 11].includes(p1) && p0 > 30) {
        return { isValid: false, error: `${HINDI_MONTHS[p1]} में केवल 30 दिन होते हैं` };
      }
      return { isValid: true, hint: `${p0} ${HINDI_MONTHS[p1]} की सभी पर्चियां` };
    }
  }

  // 3. Three parts: DD/MM/YYYY
  if (parts.length === 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);

    if (isNaN(d) || d < 1 || d > 31) {
      return { isValid: false, error: 'अमान्य दिन (दिन 1 से 31 के बीच होना चाहिए)' };
    }
    if (isNaN(m) || m < 1 || m > 12) {
      return { isValid: false, error: 'अमान्य महीना (महीना 1 से 12 के बीच होना चाहिए)' };
    }
    if (isNaN(y) || parts[2].length !== 4 || y < 1900 || y > 2100) {
      return { isValid: false, error: 'अमान्य साल (4 अंकों का साल, उदा. 2025)' };
    }
    const maxDays = new Date(y, m, 0).getDate();
    if (d > maxDays) {
      return { isValid: false, error: `${HINDI_MONTHS[m]} ${y} में केवल ${maxDays} दिन होते हैं` };
    }
    return { isValid: true, hint: `${d} ${HINDI_MONTHS[m]} ${y} की पर्चियां` };
  }

  return { isValid: true, hint: '' };
};

/**
 * Matches a ticket date (DD/MM/YYYY) against the validated filter string.
 * Supports:
 * - "03/2026" or "3/2026" -> matches all records in March 2026
 * - "01/12" or "1/12" -> matches all records on 1st December
 * - "15/03/2026" -> matches exact date
 * - "2026" -> matches all records in year 2026
 * - "15" -> matches all records on the 15th
 */
export const matchFilterDate = (ticketDate: string, filter: string): boolean => {
  if (!ticketDate || !filter) return true;
  const f = filter.trim();
  if (!f) return true;

  const [tDStr, tMStr, tYStr] = ticketDate.split('/');
  if (!tDStr || !tMStr || !tYStr) return ticketDate.includes(f);

  const tD = parseInt(tDStr, 10);
  const tM = parseInt(tMStr, 10);
  const tY = parseInt(tYStr, 10);

  const parts = f.split('/').map(p => p.trim());

  if (parts.length === 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    return tD === d && tM === m && tY === y;
  }

  if (parts.length === 2) {
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    // If second part is 4 digits -> MM/YYYY
    if (parts[1].length === 4) {
      return tM === p0 && tY === p1;
    }
    // Else DD/MM
    return tD === p0 && tM === p1;
  }

  if (parts.length === 1) {
    if (f.length === 4) {
      return tY === parseInt(f, 10);
    }
    const d = parseInt(f, 10);
    if (!isNaN(d)) {
      return tD === d;
    }
  }

  return ticketDate.includes(f);
};
