import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Modal, ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {getAllSeasons, getCurrentSeasonId } from '../utils/season';
import {Season} from '../types';
import { getSeasonStats } from '../utils/storage';
import { useSeason } from '../context/SeasonContext';

export default function SeasonSelector() {
  const { selectedSeason, isCurrentSeason, changeSeason, resetSeason } = useSeason();

  const [showModal, setShowModal] = useState(false);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<Record<string, { totalTickets: number; totalQuantity: number }>>({});

  const currentSeasonId = getCurrentSeasonId();
  const displayId = selectedSeason || currentSeasonId;

  const openModal = async () => {
    setShowModal(true);
    setIsLoading(true);
    try {
      const all = getAllSeasons();
      setSeasons(all);
      const statsMap: Record<string, any> = {};
      await Promise.all(all.map(async (s) => {
        statsMap[s.id] = await getSeasonStats(s.id);
      }));
      setStats(statsMap);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = async (seasonId: string) => {
    if (seasonId === currentSeasonId) {
      await resetSeason();
    } else {
      await changeSeason(seasonId);
    }
    setShowModal(false);
    // No need to call onSeasonChange — context updates both screens automatically
  };

  return (
    <>
      <TouchableOpacity style={styles.chip} onPress={openModal}>
        <Ionicons name="leaf-outline" size={13} color="#2ecc71" />
        <Text style={styles.chipText}>{displayId}</Text>
        {!isCurrentSeason && (
          <View style={styles.prevBadge}>
            <Text style={styles.prevBadgeText}>पुराना</Text>
          </View>
        )}
        <Ionicons name="chevron-down" size={12} color="#2ecc71" />
      </TouchableOpacity>

      <Modal visible={showModal} transparent animationType="slide">
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowModal(false)}>
          <View style={styles.sheet}>

            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>🌾 सीजन चुनें / Select Season</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={22} color="#888" />
              </TouchableOpacity>
            </View>
            <Text style={styles.sheetSubtitle}>दोनों स्क्रीन अपने आप अपडेट होंगी</Text>

            {isLoading ? (
              <ActivityIndicator color="#f0a500" style={{ marginVertical: 30 }} />
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {seasons.map((s) => {
                  const isSelected = s.id === displayId;
                  const isCurrent = s.id === currentSeasonId;
                  const seasonStats = stats[s.id];

                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[
                        styles.seasonItem,
                        isSelected && styles.seasonItemSelected,
                        isCurrent && styles.seasonItemCurrent,
                      ]}
                      onPress={() => handleSelect(s.id)}
                    >
                      <View style={styles.seasonLeft}>
                        <View style={[styles.dot, isSelected && styles.dotSelected, isCurrent && !isSelected && styles.dotCurrent]} />
                        <View>
                          <View style={styles.seasonTitleRow}>
                            <Text style={[styles.seasonId, isSelected && { color: '#2ecc71' }]}>{s.id}</Text>
                            {isCurrent && (
                              <View style={styles.currentBadge}>
                                <Text style={styles.currentBadgeText}>चालू</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.seasonRange}>Oct {s.startYear} – Sep {s.endYear}</Text>
                        </View>
                      </View>

                      <View style={styles.seasonRight}>
                        {(seasonStats?.totalTickets ?? 0) > 0 ? (
                          <View style={styles.statsBox}>
                            <Text style={styles.statLine}>🎫 {seasonStats.totalTickets}</Text>
                            <Text style={styles.statLine}>⚖️ {seasonStats.totalQuantity.toFixed(1)}</Text>
                          </View>
                        ) : (
                          <Text style={styles.noDataText}>कोई डेटा नहीं</Text>
                        )}
                        {isSelected && <Ionicons name="checkmark-circle" size={20} color="#2ecc71" />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {!isCurrentSeason && (
              <TouchableOpacity style={styles.currentBtn} onPress={() => handleSelect(currentSeasonId)}>
                <Ionicons name="refresh-outline" size={16} color="#f0a500" />
                <Text style={styles.currentBtnText}>वर्तमान सीजन पर वापस जाएं</Text>
              </TouchableOpacity>
            )}

          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(46,204,113,0.1)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(46,204,113,0.35)' },
  chipText: { color: '#2ecc71', fontSize: 12, fontWeight: '800' },
  prevBadge: { backgroundColor: 'rgba(240,165,0,0.2)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  prevBadgeText: { color: '#f0a500', fontSize: 9, fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '80%', borderTopWidth: 1, borderColor: '#2d2d4e' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  sheetTitle: { color: '#f0f0f0', fontSize: 16, fontWeight: '700' },
  sheetSubtitle: { color: '#555', fontSize: 11, marginBottom: 16 },

  seasonItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 12, marginBottom: 8, backgroundColor: '#0f0f1e', borderWidth: 1, borderColor: '#2d2d4e' },
  seasonItemSelected: { borderColor: 'rgba(46,204,113,0.5)', backgroundColor: 'rgba(46,204,113,0.06)' },
  seasonItemCurrent: { borderColor: 'rgba(46,204,113,0.25)' },

  seasonLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2d2d4e' },
  dotSelected: { backgroundColor: '#2ecc71' },
  dotCurrent: { backgroundColor: 'rgba(46,204,113,0.5)' },

  seasonTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  seasonId: { color: '#f0f0f0', fontSize: 16, fontWeight: '800' },
  seasonRange: { color: '#555', fontSize: 10, marginTop: 2 },

  currentBadge: { backgroundColor: 'rgba(46,204,113,0.2)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(46,204,113,0.4)' },
  currentBadgeText: { color: '#2ecc71', fontSize: 9, fontWeight: '800' },

  seasonRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statsBox: { alignItems: 'flex-end' },
  statLine: { color: '#666', fontSize: 10 },
  noDataText: { color: '#333', fontSize: 10 },

  currentBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: 14, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(240,165,0,0.4)', backgroundColor: 'rgba(240,165,0,0.06)' },
  currentBtnText: { color: '#f0a500', fontSize: 13, fontWeight: '700' },
});