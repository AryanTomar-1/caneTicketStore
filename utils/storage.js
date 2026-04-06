import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'cane_tickets_v1';

export const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

export const saveTicket = async (ticket) => {
  try {
    const existing = await getAllTickets();
    const newTicket = {
      ...ticket,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
    const updated = [newTicket, ...existing];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return newTicket;
  } catch (error) {
    console.error('Save error:', error);
    throw error;
  }
};

export const getAllTickets = async () => {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    return [];
  }
};

export const deleteTicket = async (id) => {
  try {
    const existing = await getAllTickets();
    const updated = existing.filter((t) => t.id !== id);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    throw error;
  }
};

export const getUniqueNames = async () => {
  try {
    const tickets = await getAllTickets();
    const names = [...new Set(tickets.map((t) => t.name))];
    return names.sort();
  } catch {
    return [];
  }
};

export const formatDateTime = (isoString) => {
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
