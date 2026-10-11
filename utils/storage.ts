import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSelectedSeason, getCurrentStartYear, makeSeasonId, getAllSeasons } from './season';
import { Ticket, TicketInput, Season, RecentFarmer, MillPaymentSettings, BackupPayload } from '../types';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const seasonKey = (seasonId: string) => `cane_tickets_${seasonId}`;
const RECENT_FARMERS_KEY = 'cane_recent_farmers';
const millPaymentKey = (seasonId: string) => `cane_mill_payment_${seasonId}`;
const caneRateKey = (seasonId: string) => `cane_rate_${seasonId}`;

// ─── ID generator ─────────────────────────────────────────────────────────────

export const generateId = (): string =>
  Date.now().toString(36) + Math.random().toString(36).substring(2);

// ─── Format helper ────────────────────────────────────────────────────────────

export const formatDateTime = (isoString?: string): string => {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    const hrs = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${year}, ${hrs}:${min}`;
  } catch { return isoString; }
};

// ─── Read ─────────────────────────────────────────────────────────────────────

/** Get all tickets for a specific season by seasonId */
export const getTicketsBySeason = async (seasonId: string): Promise<Ticket[]> => {
  try {
    const data = await AsyncStorage.getItem(seasonKey(seasonId));
    return data ? JSON.parse(data) : [];
  } catch { return []; }
};

/** Get tickets for the currently SELECTED season */
export const getAllTickets = async (): Promise<Ticket[]> => {
  const seasonId = await getSelectedSeason();
  return getTicketsBySeason(seasonId);
};

/** Get tickets by farmer code across all seasons */
export const getTicketByFarmer_code = async (farmer_code: string): Promise<Ticket[]> => {
  const allSeasons: Season[] = getAllSeasons();
  const tickets: Ticket[] = [];
  for (const season of allSeasons) {
    const seasonId = makeSeasonId(season.startYear);
    const seasonTickets = await getTicketsBySeason(seasonId);
    tickets.push(...seasonTickets);
  }
  return tickets.filter(t =>
    t.farmer_code?.toLowerCase() === farmer_code.toLowerCase()
  );
};

/** Get unique names in selected season */
export const getUniqueNames = async (): Promise<string[]> => {
  const tickets = await getAllTickets();
  return [...new Set(tickets.map(t => t.name))].sort();
};

// ─── Recent Farmers ───────────────────────────────────────────────────────────

/** Return up to `limit` most recently used unique farmers */
export const getRecentFarmers = async (limit = 5): Promise<RecentFarmer[]> => {
  try {
    const raw = await AsyncStorage.getItem(RECENT_FARMERS_KEY);
    const farmers: RecentFarmer[] = raw ? JSON.parse(raw) : [];
    return farmers.slice(0, limit);
  } catch { return []; }
};

/** Upsert a farmer in the recent list — keeps list deduped and newest-first */
const upsertRecentFarmer = async (farmer: RecentFarmer): Promise<void> => {
  try {
    const raw = await AsyncStorage.getItem(RECENT_FARMERS_KEY);
    let farmers: RecentFarmer[] = raw ? JSON.parse(raw) : [];
    // Remove existing entry for same code
    farmers = farmers.filter(f => f.farmer_code !== farmer.farmer_code);
    // Add to front
    farmers.unshift(farmer);
    // Keep max 10 in storage (we return 5 to UI, keep 10 as buffer)
    await AsyncStorage.setItem(RECENT_FARMERS_KEY, JSON.stringify(farmers.slice(0, 10)));
  } catch { /* silent */ }
};

// ─── Duplicate check ──────────────────────────────────────────────────────────

export const checkDuplicate = async (
  name: string,
  date: string,
  excludeId?: string
): Promise<Ticket | null> => {
  const tickets = await getAllTickets();
  return tickets.find(t =>
    t.name.trim().toLowerCase() === name.trim().toLowerCase() &&
    t.date === date &&
    t.id !== excludeId
  ) ?? null;
};

// ─── Create (single) ──────────────────────────────────────────────────────────

/** Save ticket → stored under selected season key, also updates recent farmers */
export const saveTicket = async (ticket: TicketInput): Promise<Ticket> => {
  const seasonId = await getSelectedSeason();
  const existing = await getTicketsBySeason(seasonId);

  const newTicket: Ticket = {
    ...ticket,
    id: generateId(),
    seasonId,
    createdAt: new Date().toISOString(),
  };

  await AsyncStorage.setItem(
    seasonKey(seasonId),
    JSON.stringify([newTicket, ...existing])
  );

  // Update recent farmers
  await upsertRecentFarmer({
    farmer_code: ticket.farmer_code,
    name: ticket.name,
    fatherName: ticket.fatherName,
    lastUsedAt: new Date().toISOString(),
  });

  return newTicket;
};

// ─── Create (batch) ───────────────────────────────────────────────────────────

export interface BatchSaveInput {
  farmer_code: string;
  name: string;
  fatherName: string;
  slips: {
    date: string;
    caneOwner: string;
    quantity: number;
    comment: string;
  }[];
}

/**
 * Save multiple slips for a single farmer atomically.
 * Returns array of saved Ticket objects.
 * Throws on storage error so caller can show a proper message.
 */
export const saveBatchTickets = async (input: BatchSaveInput): Promise<Ticket[]> => {
  if (!input.slips.length) throw new Error('कोई पर्ची नहीं जोड़ी गई।');

  const seasonId = await getSelectedSeason();
  const existing = await getTicketsBySeason(seasonId);
  const now = new Date().toISOString();

  const newTickets: Ticket[] = input.slips.map(slip => ({
    id: generateId(),
    farmer_code: input.farmer_code,
    name: input.name,
    fatherName: input.fatherName,
    caneOwner: slip.caneOwner,
    date: slip.date,
    quantity: slip.quantity,
    comment: slip.comment,
    seasonId,
    createdAt: now,
  }));

  // Atomic write — prepend all new tickets at once
  await AsyncStorage.setItem(
    seasonKey(seasonId),
    JSON.stringify([...newTickets, ...existing])
  );

  // Update recent farmers once (latest slip's timestamp)
  await upsertRecentFarmer({
    farmer_code: input.farmer_code,
    name: input.name,
    fatherName: input.fatherName,
    lastUsedAt: now,
  });

  return newTickets;
};

// ─── Update ───────────────────────────────────────────────────────────────────

/** Update ticket in selected season */
export const updateTicket = async (
  id: string,
  updates: Partial<TicketInput>
): Promise<Ticket> => {
  const seasonId = await getSelectedSeason();
  const existing = await getTicketsBySeason(seasonId);
  const idx = existing.findIndex(t => t.id === id);
  if (idx === -1) throw new Error('टिकट नहीं मिला। कृपया पुनः प्रयास करें।');

  const updated: Ticket = {
    ...existing[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  existing[idx] = updated;
  await AsyncStorage.setItem(seasonKey(seasonId), JSON.stringify(existing));
  return updated;
};

// ─── Delete ───────────────────────────────────────────────────────────────────

/** Delete ticket from selected season */
export const deleteTicket = async (id: string): Promise<void> => {
  const seasonId = await getSelectedSeason();
  const existing = await getTicketsBySeason(seasonId);
  await AsyncStorage.setItem(
    seasonKey(seasonId),
    JSON.stringify(existing.filter(t => t.id !== id))
  );
};

// ─── Stats ────────────────────────────────────────────────────────────────────

export const getSeasonStats = async (seasonId: string) => {
  const tickets = await getTicketsBySeason(seasonId);
  return {
    totalTickets: tickets.length,
    totalQuantity: tickets.reduce((s, t) => s + (t.quantity || 0), 0),
    uniqueFarmers: new Set(tickets.map(t => t.farmer_code)).size,
  };
};

// ─── Mill Payment Date ─────────────────────────────────────────────────────────

/** Get the mill payment cutoff date for a season (returns null if not set) */
export const getMillPaymentSettings = async (seasonId: string): Promise<MillPaymentSettings | null> => {
  try {
    const raw = await AsyncStorage.getItem(millPaymentKey(seasonId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

/** Persist the mill payment cutoff date for a season */
export const setMillPaymentSettings = async (
  seasonId: string,
  settings: MillPaymentSettings
): Promise<void> => {
  await AsyncStorage.setItem(millPaymentKey(seasonId), JSON.stringify(settings));
};

/** Remove the mill payment date for a season */
export const clearMillPaymentSettings = async (seasonId: string): Promise<void> => {
  await AsyncStorage.removeItem(millPaymentKey(seasonId));
};

// ─── Cane Rate ───────────────────────────────────────────────────────────────

/** Get the configured cane rate for a season */
export const getCaneRate = async (seasonId: string): Promise<string> => {
  try {
    const raw = await AsyncStorage.getItem(caneRateKey(seasonId));
    return raw || '';
  } catch { return ''; }
};

/** Persist the configured cane rate for a season */
export const setCaneRate = async (seasonId: string, rate: string): Promise<void> => {
  try {
    if (!rate || !rate.trim()) {
      await AsyncStorage.removeItem(caneRateKey(seasonId));
    } else {
      await AsyncStorage.setItem(caneRateKey(seasonId), rate.trim());
    }
  } catch { /* silent */ }
};

// ─── Backup & Restore ─────────────────────────────────────────────────────────

/** Export ALL seasons' data + mill payment settings as a single JSON payload */
export const exportFullDatabase = async (): Promise<BackupPayload> => {
  const seasons = getAllSeasons();
  const payload: BackupPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    appName: 'SmartKissan',
    seasons: [],
    millPaymentSettings: {},
  };

  for (const season of seasons) {
    const tickets = await getTicketsBySeason(season.id);
    payload.seasons.push({ seasonId: season.id, tickets });
    payload.millPaymentSettings[season.id] = await getMillPaymentSettings(season.id);
  }

  return payload;
};

/** Validate and restore a backup JSON payload */
export type RestoreMode = 'merge' | 'replace';

export interface RestoreResult {
  addedCount: number;
  skippedCount: number;
  seasonCount: number;
}

export const importDatabase = async (
  raw: string,
  mode: RestoreMode
): Promise<RestoreResult> => {
  let payload: BackupPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error('बैकअप फ़ाइल पढ़ने में त्रुटि। कृपया सही JSON फ़ाइल चुनें।');
  }

  // Basic schema validation
  if (
    payload.appName !== 'SmartKissan' ||
    payload.version !== 1 ||
    !Array.isArray(payload.seasons)
  ) {
    throw new Error('यह SmartKissan बैकअप फ़ाइल नहीं है या फ़ाइल खराब है।');
  }

  let addedCount = 0;
  let skippedCount = 0;

  for (const seasonData of payload.seasons) {
    const { seasonId, tickets } = seasonData;
    if (!seasonId || !Array.isArray(tickets)) continue;

    let existing: Ticket[] = [];
    if (mode === 'merge') {
      existing = await getTicketsBySeason(seasonId);
    }

    const existingIds = new Set(existing.map(t => t.id));
    const toAdd: Ticket[] = [];

    for (const ticket of tickets) {
      // Validate essential fields
      if (!ticket.id || !ticket.name || !ticket.date || !ticket.farmer_code) {
        skippedCount++;
        continue;
      }
      if (mode === 'merge' && existingIds.has(ticket.id)) {
        skippedCount++;
        continue;
      }
      toAdd.push(ticket);
    }

    const merged = mode === 'merge' ? [...toAdd, ...existing] : toAdd;
    await AsyncStorage.setItem(seasonKey(seasonId), JSON.stringify(merged));
    addedCount += toAdd.length;
  }

  // Restore mill payment settings
  if (payload.millPaymentSettings && typeof payload.millPaymentSettings === 'object') {
    for (const [seasonId, settings] of Object.entries(payload.millPaymentSettings)) {
      if (settings) {
        await setMillPaymentSettings(seasonId, settings);
      }
    }
  }

  return { addedCount, skippedCount, seasonCount: payload.seasons.length };
};

// ─── Auto cleanup: remove season data older than 4 years ─────────────────────

export const cleanupOldSeasons = async (): Promise<void> => {
  try {
    const currentStart = getCurrentStartYear();
    const oldestAllowedStart = currentStart - 3;

    const allKeys = await AsyncStorage.getAllKeys();
    const seasonPrefix = 'cane_tickets_';

    const keysToDelete = allKeys.filter(key => {
      if (!key.startsWith(seasonPrefix)) return false;
      const id = key.slice(seasonPrefix.length);
      const parts = id.split('-');
      if (parts.length !== 2) return false;
      const startYear = parseInt(parts[0], 10);
      return !isNaN(startYear) && startYear < oldestAllowedStart;
    });

    if (keysToDelete.length > 0) {
      await AsyncStorage.multiRemove(keysToDelete);
    }
  } catch (err) {
    console.error('Cleanup error:', err);
  }
};