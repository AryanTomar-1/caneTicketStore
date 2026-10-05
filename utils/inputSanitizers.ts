/**
 * Input sanitizers and validators for Smart Kissan.
 * Ensures data integrity across voice input, manual entry, batch entry, and edit modals.
 */

/**
 * Farmer Code:
 * - Max 20 characters
 * - Only alphanumeric and common code characters (letters, numbers, hyphens, slashes)
 * - No spaces
 */
export const sanitizeFarmerCode = (val: string): string => {
  return val.replace(/[^a-zA-Z0-9\/-]/g, '').slice(0, 20);
};

/**
 * Name (Farmer Name, Father Name, Cane Owner Name):
 * - Only alphabetic characters (English letters, Hindi/Devanagari characters) and single spaces
 * - Numbers and special symbols are strictly blocked
 * - Max 50 characters
 */
export const sanitizeName = (val: string): string => {
  // Allow English a-z, A-Z, Hindi/Devanagari unicode range \u0900-\u097F, and spaces
  return val.replace(/[^a-zA-Z\u0900-\u097F\s]/g, '').slice(0, 50);
};

/**
 * Quantity (Weight in Quintals):
 * - Max 5 digits for integer part (up to 99999)
 * - Max 2 decimal places (e.g., 75.50 or 12345.99)
 * - Only digits and a single decimal point allowed
 */
export const sanitizeQuantity = (val: string): string => {
  let clean = val.replace(/[^0-9.]/g, '');
  const parts = clean.split('.');
  if (parts.length > 2) {
    clean = parts[0] + '.' + parts.slice(1).join('');
  }
  const [intPart, decPart] = clean.split('.');
  const limitedInt = (intPart || '').slice(0, 5);
  if (decPart !== undefined) {
    return `${limitedInt}.${decPart.slice(0, 2)}`;
  }
  return limitedInt;
};

/**
 * Cane Rate (Price per Quintal in ₹):
 * - Max 4 digits for integer part (e.g., 400 or 9999)
 * - Max 2 decimal places
 */
export const sanitizeRate = (val: string): string => {
  let clean = val.replace(/[^0-9.]/g, '');
  const parts = clean.split('.');
  if (parts.length > 2) {
    clean = parts[0] + '.' + parts.slice(1).join('');
  }
  const [intPart, decPart] = clean.split('.');
  const limitedInt = (intPart || '').slice(0, 4);
  if (decPart !== undefined) {
    return `${limitedInt}.${decPart.slice(0, 2)}`;
  }
  return limitedInt;
};

/**
 * Comment / Note:
 * - Max 200 characters
 */
export const sanitizeComment = (val: string): string => {
  return val.slice(0, 200);
};

/**
 * Search Text:
 * - Max 50 characters
 */
export const sanitizeSearchText = (val: string): string => {
  return val.slice(0, 50);
};
