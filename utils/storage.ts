import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ticket, TicketInput } from '../types';

const STORAGE_KEY = 'cane_tickets_v1';

// ─── ID generator ─────────────────────────────────────────────────────────────

export const generateId = (): string =>
  Date.now().toString(36) + Math.random().toString(36).substring(2);

// ─── Read ─────────────────────────────────────────────────────────────────────

export const getAllTickets = async (): Promise<Ticket[]> => {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

// ─── Duplicate check ──────────────────────────────────────────────────────────

export const checkDuplicate = async (
  name: string,
  date: string,
  excludeId?: string
): Promise<Ticket | null> => {
  const tickets = await getAllTickets();
  const found = tickets.find(
    (t) =>
      t.name.trim().toLowerCase() === name.trim().toLowerCase() &&
      t.date === date &&
      t.id !== excludeId
  );
  return found ?? null;
};

// ─── Create ───────────────────────────────────────────────────────────────────

export const saveTicket = async (ticket: TicketInput): Promise<Ticket> => {
  const existing = await getAllTickets();
  const newTicket: Ticket = {
    ...ticket,
    id: generateId(),
    createdAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([newTicket, ...existing]));
  return newTicket;
};

// ─── Update ───────────────────────────────────────────────────────────────────

export const updateTicket = async (
  id: string,
  updates: Partial<TicketInput>
): Promise<Ticket> => {
  const existing = await getAllTickets();
  const idx = existing.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error('Ticket not found');
  const updated: Ticket = {
    ...existing[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  existing[idx] = updated;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  return updated;
};

// ─── Delete ───────────────────────────────────────────────────────────────────

export const deleteTicket = async (id: string): Promise<void> => {
  const existing = await getAllTickets();
  const updated = existing.filter((t) => t.id !== id);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const getUniqueNames = async (): Promise<string[]> => {
  const tickets = await getAllTickets();
  return [...new Set(tickets.map((t) => t.name))].sort();
};

export const formatDateTime = (isoString?: string): string => {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    const hrs = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${year}, ${hrs}:${min}`;
  } catch {
    return isoString;
  }
};
