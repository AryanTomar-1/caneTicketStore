import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StatusBar, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';

import { useSeason } from '../../context/SeasonContext';
import SeasonSelector from '../../components/SeasonSelector';
import { BarChart, LineChart, EmptyChart } from '../../components/charts/ChartComponents';
import { getTicketsBySeason } from '../../utils/storage';
import {
  getWeeklyTimeline,
  getFarmerBreakdown,
  getAllSeasonsComparison,
  ChartDataPoint,
  AnalyticsSummary,
  GannaType,
  MERA_GANNA,
} from '../../utils/analyticsHelpers';

// ─── Types ────────────────────────────────────────────────────────────────────

type GraphType = 'bar' | 'line';
type DataView  = 'season' | 'farmer' | 'allSeasons';

const EMPTY_SUMMARY: AnalyticsSummary = {
  totalSlips: 0, totalQuintals: 0, topLabel: '—', topValue: 0,
};

// ─── Ganna type pill ──────────────────────────────────────────────────────────

interface GannaPillProps {
  value: GannaType;
  onChange: (v: GannaType) => void;
}

function GannaPills({ value, onChange }: GannaPillProps) {
  const opts: { key: GannaType; icon: string; label: string; color: string; bg: string; border: string }[] = [
    {
      key: 'mera',
      icon: '🌾',
      label: 'मेरा गन्ना',
      color: '#2ecc71',
      bg: 'rgba(46,204,113,0.15)',
      border: 'rgba(46,204,113,0.45)',
    },
    {
      key: 'durso',
      icon: '👥',
      label: 'दूसरों का गन्ना',
      color: '#7c3aed',
      bg: 'rgba(124,58,237,0.15)',
      border: 'rgba(124,58,237,0.45)',
    },
  ];

  return (
    <View style={gannaStyles.row}>
      {opts.map(o => {
        const active = value === o.key;
        return (
          <TouchableOpacity
            key={o.key}
            onPress={() => onChange(o.key)}
            activeOpacity={0.8}
            style={[
              gannaStyles.pill,
              active && { backgroundColor: o.bg, borderColor: o.border },
            ]}
          >
            <Text style={gannaStyles.pillIcon}>{o.icon}</Text>
            <Text style={[gannaStyles.pillText, active && { color: o.color, fontWeight: '900' }]}>
              {o.label}
            </Text>
            {active && (
              <View style={[gannaStyles.dot, { backgroundColor: o.color }]} />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const gannaStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: '#0d0d1a',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  pillIcon: { fontSize: 15 },
  pillText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '700',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon, label, value, accent, delay,
}: { icon: string; label: string; value: string; accent: string; delay: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 400, delay, useNativeDriver: true }).start();
  }, [value]);

  return (
    <Animated.View
      style={[
        kpiStyles.card,
        { borderColor: accent + '44', opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
      ]}
    >
      <Text style={kpiStyles.icon}>{icon}</Text>
      <Text style={[kpiStyles.value, { color: accent }]}>{value}</Text>
      <Text style={kpiStyles.label}>{label}</Text>
    </Animated.View>
  );
}

const kpiStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#0d0d1a',
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    gap: 4,
  },
  icon: { fontSize: 20 },
  value: { fontSize: 18, fontWeight: '900', letterSpacing: -0.5, color: '#fff' },
  label: { color: '#666', fontSize: 10, textAlign: 'center', fontWeight: '700' },
});

// ─── Data Row ─────────────────────────────────────────────────────────────────

function DataRow({
  rank, label, value, count, total, accent,
}: { rank: number; label: string; value: number; count?: number; total: number; accent: string }) {
  const pct  = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
  const barW = total > 0 ? (value / total) * 100 : 0;

  return (
    <View style={rowStyles.row}>
      <View style={rowStyles.rankBox}>
        <Text style={rowStyles.rank}>#{rank}</Text>
      </View>
      <View style={rowStyles.info}>
        <View style={rowStyles.topRow}>
          <Text style={rowStyles.label} numberOfLines={1}>{label}</Text>
          <Text style={[rowStyles.value, { color: accent }]}>{value} कुंतल</Text>
        </View>
        <View style={rowStyles.barTrack}>
          <View style={[rowStyles.barFill, { width: `${barW}%` as any, backgroundColor: accent }]} />
        </View>
        <View style={rowStyles.bottomRow}>
          {count != null && <Text style={rowStyles.sub}>🎫 {count} पर्ची</Text>}
          <Text style={rowStyles.pct}>{pct}%</Text>
        </View>
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  rankBox: {
    width: 32, height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center', justifyContent: 'center',
  },
  rank: { color: '#666', fontSize: 11, fontWeight: '800' },
  info: { flex: 1, gap: 4 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: '#ffffff', fontSize: 13, fontWeight: '700', flex: 1 },
  value: { fontSize: 13, fontWeight: '900', marginLeft: 6 },
  barTrack: {
    height: 4, backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 2, overflow: 'hidden',
  },
  barFill: { height: 4, borderRadius: 2 },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sub: { color: '#555', fontSize: 10, fontWeight: '600' },
  pct: { color: '#555', fontSize: 10, fontWeight: '800' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const { selectedSeason } = useSeason();

  const [graphType,   setGraphType]   = useState<GraphType>('bar');
  const [dataView,    setDataView]    = useState<DataView>('season');
  const [gannaType,   setGannaType]   = useState<GannaType>('mera');
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  const [seasonData,    setSeasonData]    = useState<ChartDataPoint[]>([]);
  const [seasonSum,     setSeasonSum]     = useState<AnalyticsSummary>(EMPTY_SUMMARY);
  const [farmerData,    setFarmerData]    = useState<ChartDataPoint[]>([]);
  const [farmerSum,     setFarmerSum]     = useState<AnalyticsSummary>(EMPTY_SUMMARY);
  const [allSsnData,    setAllSsnData]    = useState<ChartDataPoint[]>([]);
  const [allSsnSum,     setAllSsnSum]     = useState<AnalyticsSummary>(EMPTY_SUMMARY);

  const headerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const tickets = await getTicketsBySeason(selectedSeason);

      const { chartData: sd, summary: ss } = getWeeklyTimeline(tickets, gannaType);
      setSeasonData(sd);
      setSeasonSum(ss);

      const { chartData: fd, summary: fs } = getFarmerBreakdown(tickets, gannaType);
      setFarmerData(fd);
      setFarmerSum(fs);

      const { chartData: asd, summary: ass } = await getAllSeasonsComparison(gannaType);
      setAllSsnData(asd);
      setAllSsnSum(ass);
    } finally {
      setLoading(false);
    }
  }, [selectedSeason, gannaType]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // ── Active data set ──
  const activeData    = dataView === 'season' ? seasonData   : dataView === 'farmer' ? farmerData    : allSsnData;
  const activeSummary = dataView === 'season' ? seasonSum    : dataView === 'farmer' ? farmerSum     : allSsnSum;

  const accentColor = gannaType === 'mera' ? '#f0a500' : '#7c3aed';
  const accentGlow  = gannaType === 'mera' ? 'rgba(240,165,0,0.4)' : 'rgba(124,58,237,0.4)';
  const gannaLabel  = gannaType === 'mera' ? MERA_GANNA : 'दूसरों का गन्ना';

  const viewMeta: Record<DataView, { icon: string; short: string }> = {
    season:     { icon: '📅', short: 'सीजन पर्ची' },
    farmer:     { icon: '👨‍🌾', short: 'किसान अनुसार' },
    allSeasons: { icon: '🗓️', short: 'सभी सीजन' },
  };

  const kpiTopLabel =
    dataView === 'season'     ? 'सर्वाधिक सप्ताह'
    : dataView === 'farmer'   ? 'शीर्ष किसान'
    : 'सर्वाधिक सीजन';

  const emptyMsg = gannaType === 'mera'
    ? `सीजन ${selectedSeason} में "मेरा गन्ना" पर्ची नहीं मिली`
    : `सीजन ${selectedSeason} में "दूसरों का गन्ना" पर्ची नहीं मिली`;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      {/* ── Header ── */}
      <Animated.View style={[styles.header, { opacity: headerAnim }]}>
        <View>
          <Text style={styles.title}>📊 विश्लेषण</Text>
          <Text style={styles.subtitle}>Analytics Dashboard</Text>
        </View>
        <SeasonSelector showIcon />
      </Animated.View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accentColor} />
        }
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
      >
        {/* ── Ganna type toggle ── */}
        <GannaPills value={gannaType} onChange={v => setGannaType(v)} />

        {/* ── Graph type toggle ── */}
        <View style={styles.graphToggle}>
          {(['bar', 'line'] as GraphType[]).map(type => (
            <TouchableOpacity
              key={type}
              style={[styles.graphBtn, graphType === type && styles.graphBtnActive]}
              onPress={() => setGraphType(type)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={type === 'bar' ? 'bar-chart' : 'trending-up'}
                size={15}
                color={graphType === type ? '#121224' : '#64748b'}
              />
              <Text style={[styles.graphBtnText, graphType === type && styles.graphBtnTextActive]}>
                {type === 'bar' ? 'Bar Graph' : 'Line Graph'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Data view tabs ── */}
        <View style={styles.viewRow}>
          {(Object.keys(viewMeta) as DataView[]).map(v => (
            <TouchableOpacity
              key={v}
              style={[styles.viewTab, dataView === v && { borderColor: accentColor + '66', backgroundColor: accentColor + '18' }]}
              onPress={() => setDataView(v)}
              activeOpacity={0.8}
            >
              <Text style={styles.viewTabIcon}>{viewMeta[v].icon}</Text>
              <Text style={[styles.viewTabText, dataView === v && { color: accentColor, fontWeight: '900' }]}>
                {viewMeta[v].short}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Ganna type + season banner ── */}
        <View style={styles.banner}>
          <View style={[styles.gannaBadge, { borderColor: accentColor + '55', backgroundColor: accentColor + '18' }]}>
            <Text style={[styles.gannaBadgeText, { color: accentColor }]}>{gannaLabel}</Text>
          </View>
          <Text style={styles.bannerArrow}>›</Text>
          <Text style={styles.bannerSeason}>{selectedSeason}</Text>
        </View>

        {/* ── KPI Cards ── */}
        {!loading && (
          <View style={styles.kpiRow}>
            <KpiCard icon="🎫" label="कुल पर्चियां" value={String(activeSummary.totalSlips)} accent="#2ecc71" delay={0} />
            <KpiCard icon="⚖️" label="कुल कुंतल"   value={String(activeSummary.totalQuintals)} accent={accentColor} delay={80} />
            <KpiCard
              icon="🏆"
              label={kpiTopLabel}
              value={
                activeSummary.topLabel.length > 9
                  ? activeSummary.topLabel.slice(0, 8) + '…'
                  : activeSummary.topLabel || '—'
              }
              accent="#e040fb"
              delay={160}
            />
          </View>
        )}

        {/* ── Chart section ── */}
        <View style={styles.chartSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {graphType === 'bar' ? '📊 Bar Graph' : '📈 Line Graph'}
            </Text>
            {!loading && (
              <Text style={styles.entryCount}>{activeData.length} entries</Text>
            )}
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={accentColor} size="large" />
              <Text style={styles.loadingText}>डेटा लोड हो रहा है…</Text>
            </View>
          ) : activeData.length === 0 ? (
            <EmptyChart message={emptyMsg} />
          ) : graphType === 'bar' ? (
            <BarChart data={activeData} accentColor={accentColor} accentGlow={accentGlow} />
          ) : (
            <LineChart data={activeData} accentColor={accentColor} accentGlow={accentGlow} />
          )}
        </View>

        {/* ── Breakdown list ── */}
        {!loading && activeData.length > 0 && (
          <View style={styles.listSection}>
            <Text style={styles.sectionTitle}>📋 विस्तृत सूची</Text>
            {activeData.map((item, idx) => (
              <DataRow
                key={idx}
                rank={idx + 1}
                label={item.label}
                value={item.value}
                count={item.count}
                total={activeSummary.totalQuintals}
                accent={accentColor}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080812' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: '#33334a',
    fontSize: 11,
    fontWeight: '700',
  },

  scroll: {
    paddingHorizontal: 14,
    paddingTop: 14,
    gap: 12,
  },

  // Graph type
  graphToggle: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#0d0d1a',
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  graphBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 9,
  },
  graphBtnActive: {
    backgroundColor: '#f0a500',
    elevation: 3,
  },
  graphBtnText: { color: '#64748b', fontSize: 13, fontWeight: '700' },
  graphBtnTextActive: { color: '#121224', fontWeight: '900' },

  // Data view tabs
  viewRow: { flexDirection: 'row', gap: 8 },
  viewTab: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#0d0d1a',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  viewTabIcon: { fontSize: 18 },
  viewTabText: { color: '#555', fontSize: 10, fontWeight: '700', textAlign: 'center' },

  // Banner
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  gannaBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  gannaBadgeText: { fontSize: 12, fontWeight: '900' },
  bannerArrow: { color: '#333', fontSize: 16 },
  bannerSeason: {
    color: '#2ecc71',
    fontSize: 12,
    fontWeight: '800',
    backgroundColor: 'rgba(46,204,113,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(46,204,113,0.3)',
  },

  // KPI
  kpiRow: { flexDirection: 'row', gap: 8 },

  // Chart
  chartSection: {
    backgroundColor: '#0d0d1a',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  entryCount: { color: '#333', fontSize: 11, fontWeight: '700' },

  loadingBox: { height: 180, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: '#444', fontSize: 12 },

  // List
  listSection: {
    backgroundColor: '#0d0d1a',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 2,
  },
});
