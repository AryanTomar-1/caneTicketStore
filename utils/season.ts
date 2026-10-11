import AsyncStorage from '@react-native-async-storage/async-storage';

const SELECTED_SEASON_KEY = 'cane_selected_season';

import { Season } from '../types';

// ─── Core helpers ─────────────────────────────────────────────────────────────

/** Season starts October(10), ends September(9) */
export const getCurrentStartYear = (): number => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 10 ? year : year - 1;
};

export const makeSeasonId = (startYear: number): string =>
  `${startYear}-${startYear + 1}`;

export const getCurrentSeasonId = (): string =>
  makeSeasonId(getCurrentStartYear());

const makeSeason = (startYear: number): Season => {
  const id = makeSeasonId(startYear);
  return {
    id,
    label: id,
    startYear,
    endYear: startYear + 1,
    isCurrent: id === getCurrentSeasonId(),
  };
};

// ─── Get last 4 seasons only ──────────────────────────────────────────────────

export const getAllSeasons = (): Season[] => {
  const currentStartYear = getCurrentStartYear();
  const seasons: Season[] = [];
  // current + 3 previous = 4 total
  for (let y = currentStartYear; y >= currentStartYear - 3; y--) {
    seasons.push(makeSeason(y));
  }
  return seasons; // newest first
};

// ─── Selected season ──────────────────────────────────────────────────────────

export const getSelectedSeason = async (): Promise<string> => {
  try {
    const stored = await AsyncStorage.getItem(SELECTED_SEASON_KEY);
    if (stored) return stored;
  } catch {}
  return getCurrentSeasonId();
};

export const setSelectedSeason = async (seasonId: string): Promise<void> => {
  await AsyncStorage.setItem(SELECTED_SEASON_KEY, seasonId);
};

export const resetToCurrentSeason = async (): Promise<void> => {
  await AsyncStorage.removeItem(SELECTED_SEASON_KEY);
};