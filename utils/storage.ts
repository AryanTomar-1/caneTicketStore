import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSelectedSeason, getCurrentStartYear, makeSeasonId, getAllSeasons } from './season';
import { Ticket, TicketInput, Season } from '../types';

// ─── Season key ───────────────────────────────────────────────────────────────
// Key format: cane_tickets_2024-2025

const seasonKey = (seasonId: string) => `cane_tickets_${seasonId}`;

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

/** Get tickets by farmer code in selected season */
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

// ─── Create ───────────────────────────────────────────────────────────────────

/** Save ticket → stored under selected season key */
export const saveTicket = async (ticket: TicketInput): Promise<Ticket> => {
  const seasonId = await getSelectedSeason(); // e.g. "2024-2025"
  const existing = await getTicketsBySeason(seasonId);

  const newTicket: Ticket = {
    ...ticket,
    id: generateId(),
    seasonId,                              // attach season to ticket
    createdAt: new Date().toISOString(),
  };

  // Save under: cane_tickets_2024-2025
  await AsyncStorage.setItem(
    seasonKey(seasonId),
    JSON.stringify([newTicket, ...existing])
  );
  return newTicket;
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
  if (idx === -1) throw new Error('Ticket not found');

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

// ─── Auto cleanup: remove season data older than 4 years ─────────────────────

export const cleanupOldSeasons = async (): Promise<void> => {
  try {
    const currentStart = getCurrentStartYear();
    const oldestAllowedStart = currentStart - 3; // keep 4 seasons: current + 3 previous

    const allKeys = await AsyncStorage.getAllKeys();
    const seasonPrefix = 'cane_tickets_';

    const keysToDelete = allKeys.filter(key => {
      if (!key.startsWith(seasonPrefix)) return false;
      const id = key.slice(seasonPrefix.length); // e.g. "2020-2021"
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