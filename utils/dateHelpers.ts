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
