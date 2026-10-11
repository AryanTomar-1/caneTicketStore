import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  getSelectedSeason,
  setSelectedSeason,
  resetToCurrentSeason,
  getCurrentSeasonId,
} from '../utils/season';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SeasonContextType {
  selectedSeason: string;
  isCurrentSeason: boolean;
  changeSeason: (seasonId: string) => Promise<void>;
  resetSeason: () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const SeasonContext = createContext<SeasonContextType>({
  selectedSeason: getCurrentSeasonId(),
  isCurrentSeason: true,
  changeSeason: async () => {},
  resetSeason: async () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function SeasonProvider({ children }: { children: ReactNode }) {
  const [selectedSeason, setSelectedSeasonState] = useState<string>(getCurrentSeasonId());

  useEffect(() => {
    // Load persisted season on app start
    getSelectedSeason().then(id => setSelectedSeasonState(id));
  }, []);

  const changeSeason = async (seasonId: string): Promise<void> => {
    await setSelectedSeason(seasonId);
    setSelectedSeasonState(seasonId); // ← updates ALL screens instantly
  };

  const resetSeason = async (): Promise<void> => {
    await resetToCurrentSeason();
    setSelectedSeasonState(getCurrentSeasonId());
  };

  return (
    <SeasonContext.Provider value={{
      selectedSeason,
      isCurrentSeason: selectedSeason === getCurrentSeasonId(),
      changeSeason,
      resetSeason,
    }}>
      {children}
    </SeasonContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useSeason = () => useContext(SeasonContext);