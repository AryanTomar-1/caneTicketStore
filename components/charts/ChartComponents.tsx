import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions,
} from 'react-native';
import { ChartDataPoint } from '../../utils/analyticsHelpers';

// ─── Theme ────────────────────────────────────────────────────────────────────

export const CHART_COLORS = {
  bar: '#f0a500',
  barGlow: 'rgba(240,165,0,0.4)',
  barSelected: '#2ecc71',
  barSelectedGlow: 'rgba(46,204,113,0.4)',
  line: '#f0a500',
  dot: '#f0a500',
  dotSelected: '#2ecc71',
  grid: 'rgba(255,255,255,0.06)',
  label: '#aaaacc',
  value: '#ffffff',
  bg: '#0d0d1a',
};

// ─── Layout constants ─────────────────────────────────────────────────────────

// ─── Layout constants ─────────────────────────────────────────────────────────

const CHART_HEIGHT  = 165;   // drawable area height (bars / line)
const TOP_PAD       = 48;    // guaranteed space above chart for value labels + top dot
const X_LABEL_H     = 26;    // space below chart for x-axis labels
const TOTAL_H       = TOP_PAD + CHART_HEIGHT + X_LABEL_H;   // 239 px

const BAR_MIN_WIDTH = 40;
const BAR_GAP       = 10;
const SCREEN_WIDTH  = Dimensions.get('window').width;

// ─── Shared types ─────────────────────────────────────────────────────────────

interface ChartProps {
  data: ChartDataPoint[];
  accentColor?: string;
  accentGlow?: string;
}

// ─── Grid lines ───────────────────────────────────────────────────────────────

function GridLines({ maxVal }: { maxVal: number }) {
  const steps = 4;
  return (
    <>
      {Array.from({ length: steps + 1 }).map((_, i) => {
        const ratio = i / steps;
        // top is relative to CHART_HEIGHT only — parent view already handles TOP_PAD offset
        const top = CHART_HEIGHT * (1 - ratio);
        const val = maxVal * ratio;
        const label = val >= 1000
          ? `${(val / 1000).toFixed(1)}k`
          : val.toFixed(val < 10 && val > 0 ? 1 : 0);
        return (
          <View key={i} style={[styles.gridRow, { top }]} pointerEvents="none">
            <Text style={styles.gridLabel}>{label}</Text>
            <View style={styles.gridLine} />
          </View>
        );
      })}
    </>
  );
}


// ─── Tooltip ─────────────────────────────────────────────────────────────────

function Tooltip({ item }: { item: ChartDataPoint }) {
  return (
    <View style={styles.tooltip}>
      <Text style={styles.tooltipTitle} numberOfLines={1}>{item.label}</Text>
      {item.subLabel ? <Text style={styles.tooltipSub}>{item.subLabel}</Text> : null}
      <Text style={styles.tooltipValue}>⚖️ {item.value} कुंतल</Text>
      {item.count != null && (
        <Text style={styles.tooltipSecondary}>🎫 {item.count} पर्ची</Text>
      )}
    </View>
  );
}

// ─── Bar Chart ────────────────────────────────────────────────────────────────

export function BarChart({
  data,
  accentColor = CHART_COLORS.bar,
  accentGlow  = CHART_COLORS.barGlow,
}: ChartProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  if (data.length === 0) return <EmptyChart />;

  const values   = data.map(d => d.value);
  const maxVal   = Math.max(...values, 1);
  const barWidth = Math.max(
    BAR_MIN_WIDTH,
    (SCREEN_WIDTH - 72) / Math.max(data.length, 1) - BAR_GAP,
  );

  return (
    <View style={styles.chartWrapper}>
      {/* Tooltip */}
      {selectedIdx !== null && (
        <View style={styles.tooltipContainer}>
          <Tooltip item={data[selectedIdx]} />
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 8 }}
      >
        {/*
          LAYOUT (height = TOTAL_H):
            [TOP_PAD px]   ← value labels float here, never clipped
            [CHART_HEIGHT] ← bars grow upward from bottom of this zone
            [X_LABEL_H px] ← x-axis text below
        */}
        <View style={{ height: TOTAL_H, position: 'relative' }}>

          {/* Grid lines sit in the chart zone (offset by TOP_PAD) */}
          <View
            style={{
              position: 'absolute',
              top: TOP_PAD,
              height: CHART_HEIGHT,
              left: 36,
              right: 0,
            }}
            pointerEvents="none"
          >
            <GridLines maxVal={maxVal} />
          </View>

          {/* Bars row — aligned to the BOTTOM of the chart zone */}
          <View
            style={{
              position: 'absolute',
              top: TOP_PAD,
              left: 36,
              right: 0,
              height: CHART_HEIGHT,
              flexDirection: 'row',
              alignItems: 'flex-end',
            }}
          >
            {data.map((item, idx) => {
              const val       = values[idx];
              const ratio     = maxVal > 0 ? val / maxVal : 0;
              const barH      = Math.max(4, ratio * CHART_HEIGHT);
              const isSelected = selectedIdx === idx;
              const color     = isSelected ? CHART_COLORS.barSelected : accentColor;
              const glow      = isSelected ? CHART_COLORS.barSelectedGlow : accentGlow;

              return (
                <TouchableOpacity
                  key={idx}
                  onPress={() => setSelectedIdx(isSelected ? null : idx)}
                  activeOpacity={0.8}
                  style={{ width: barWidth, marginRight: BAR_GAP, alignItems: 'center' }}
                >
                  {/* Value label — lives ABOVE the bar; since parent is flex-end,
                      this naturally floats above the bar without touching TOP_PAD */}
                  <Text style={[styles.barValueLabel, { color }]}>
                    {val}
                  </Text>

                  {/* Bar block */}
                  <View
                    style={[
                      styles.bar,
                      {
                        height: barH,
                        width: barWidth - 6,
                        backgroundColor: color,
                        shadowColor: glow,
                        shadowRadius: isSelected ? 12 : 6,
                        shadowOpacity: 1,
                        elevation: isSelected ? 8 : 3,
                      },
                    ]}
                  />
                </TouchableOpacity>
              );
            })}
          </View>

          {/* X-axis labels — absolute row at the very bottom */}
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              left: 36,
              right: 0,
              height: X_LABEL_H,
              flexDirection: 'row',
              alignItems: 'center',
            }}
            pointerEvents="none"
          >
            {data.map((item, idx) => (
              <View key={idx} style={{ width: barWidth, marginRight: BAR_GAP, alignItems: 'center' }}>
                <Text
                  style={[
                    styles.xLabel,
                    selectedIdx === idx && styles.xLabelActive,
                  ]}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
              </View>
            ))}
          </View>

        </View>
      </ScrollView>

      <Text style={styles.hintText}>⚖️ कुंतल (Quintals) — बार दबाएं</Text>
    </View>
  );
}

export function LineChart({
  data,
  accentColor = CHART_COLORS.line,
  accentGlow  = CHART_COLORS.barGlow,
}: ChartProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  if (data.length === 0) return <EmptyChart />;

  const values  = data.map(d => d.value);
  const maxVal  = Math.max(...values, 1);
  const PX_LEFT = 24;           // left padding inside scroll container
  const PX_PER  = 80;           // horizontal pixels per data point
  const innerW  = Math.max(SCREEN_WIDTH - 80, (data.length - 1) * PX_PER + PX_LEFT * 2);
  const stepX   = (data.length > 1)
    ? (innerW - PX_LEFT * 2) / (data.length - 1)
    : 0;

  /**
   * Absolute Y within TOTAL_H container.
   * maxVal → TOP_PAD (top of chart area)
   * 0      → TOP_PAD + CHART_HEIGHT (bottom)
   */
  const absY = (val: number) => {
    const ratio = maxVal > 0 ? val / maxVal : 0;
    return TOP_PAD + CHART_HEIGHT * (1 - ratio);
  };

  /** X of dot centre within the container View (no extra offset needed) */
  const absX = (i: number) => PX_LEFT + i * stepX;

  const points = values.map((v, i) => ({ x: absX(i), y: absY(v), val: v }));

  const DOT     = 10;
  const DOT_SEL = 14;

  return (
    <View style={styles.chartWrapper}>
      {/* Tooltip */}
      {selectedIdx !== null && (
        <View style={styles.tooltipContainer}>
          <Tooltip item={data[selectedIdx]} />
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 0 }}
      >
        <View style={{ width: innerW, height: TOTAL_H, position: 'relative' }}>

          {/* ── Grid lines ── */}
          <View
            style={{
              position: 'absolute', top: TOP_PAD,
              height: CHART_HEIGHT, left: 0, right: 0,
            }}
            pointerEvents="none"
          >
            <GridLines maxVal={maxVal} />
          </View>

          {/* ── Line segments (MIDPOINT approach) ──
               React Native has NO transform-origin support.
               The only reliable way to draw an angled line between two points:
                 1. Find the midpoint (mx, my)
                 2. Place a View of width=length centred on the midpoint
                 3. rotate() around the element's own centre = the midpoint ✓
          */}
          {points.map((pt, i) => {
            if (i === 0) return null;
            const prev  = points[i - 1];
            const dx    = pt.x - prev.x;
            const dy    = pt.y - prev.y;
            const len   = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            const mx    = (prev.x + pt.x) / 2;
            const my    = (prev.y + pt.y) / 2;

            return (
              <View
                key={`seg-${i}`}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  // Centred on midpoint; rotate around element's own centre = midpoint ✓
                  left: mx - len / 2,
                  top:  my - 1.5,
                  width: len,
                  height: 3,
                  backgroundColor: accentColor,
                  borderRadius: 1.5,
                  opacity: 0.85,
                  transform: [{ rotate: `${angle}deg` }],
                }}
              />
            );
          })}

          {/* ── Dots + value labels + x-labels ── */}
          {points.map((pt, i) => {
            const isSelected = selectedIdx === i;
            const dotColor   = isSelected ? CHART_COLORS.dotSelected : accentColor;
            const dotSize    = isSelected ? DOT_SEL : DOT;
            const item       = data[i];

            // Clamp label left so first label is never clipped at left edge
            const valLabelLeft = Math.max(4, pt.x - 22);
            const xLabelLeft   = Math.max(0, pt.x - 28);

            return (
              <React.Fragment key={`pt-${i}`}>

                {/* Value label — always above the dot */}
                <Text
                  style={[
                    styles.dotValueLabel,
                    {
                      color: isSelected ? '#2ecc71' : '#ffffff',
                      left: valLabelLeft,
                      top:  pt.y - dotSize / 2 - 22,
                    },
                  ]}
                  pointerEvents="none"
                >
                  {pt.val}
                </Text>

                {/* Dot (touch target slightly larger than visual dot) */}
                <TouchableOpacity
                  onPress={() => setSelectedIdx(isSelected ? null : i)}
                  style={{
                    position: 'absolute',
                    left: pt.x - dotSize / 2 - 5,
                    top:  pt.y - dotSize / 2 - 5,
                    width:  dotSize + 10,
                    height: dotSize + 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  activeOpacity={0.8}
                >
                  <View
                    style={{
                      width:  dotSize,
                      height: dotSize,
                      borderRadius: dotSize / 2,
                      backgroundColor: dotColor,
                      borderWidth: isSelected ? 2.5 : 0,
                      borderColor: '#fff',
                      shadowColor: accentGlow,
                      shadowRadius: isSelected ? 10 : 4,
                      shadowOpacity: 1,
                      elevation: isSelected ? 6 : 2,
                    }}
                  />
                </TouchableOpacity>

                {/* X-axis label pinned to bottom zone */}
                <Text
                  style={[
                    styles.lineXLabel,
                    isSelected && styles.xLabelActive,
                    {
                      position: 'absolute',
                      left: xLabelLeft,
                      top:  TOP_PAD + CHART_HEIGHT + 5,
                      width: 56,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>

              </React.Fragment>
            );
          })}

        </View>
      </ScrollView>

      <Text style={styles.hintText}>⚖️ कुंतल (Quintals) — बिंदु दबाएं</Text>
    </View>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────


export function EmptyChart({ message }: { message?: string }) {
  return (
    <View style={styles.emptyChart}>
      <Text style={styles.emptyIcon}>📭</Text>
      <Text style={styles.emptyText}>
        {message ?? 'इस सीजन में कोई डेटा नहीं मिला'}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  chartWrapper: {
    backgroundColor: CHART_COLORS.bg,
    borderRadius: 14,
    paddingTop: 10,
    paddingBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden',
  },

  // Tooltip
  tooltipContainer: {
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  tooltip: {
    backgroundColor: '#1a1a30',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(240,165,0,0.35)',
    alignItems: 'center',
    gap: 2,
  },
  tooltipTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  tooltipSub: {
    color: '#6666aa',
    fontSize: 10,
    fontWeight: '600',
  },
  tooltipValue: {
    color: '#f0a500',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
  },
  tooltipSecondary: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
  },

  // Grid
  gridRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    height: 1,
  },
  gridLabel: {
    color: '#44446a',
    fontSize: 9,
    fontWeight: '700',
    width: 32,
    textAlign: 'right',
    marginRight: 4,
  },
  gridLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },

  // Bar chart
  barValueLabel: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
    marginBottom: 4,
    textAlign: 'center',
  },
  bar: {
    borderRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  xLabel: {
    color: CHART_COLORS.label,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 5,
    textAlign: 'center',
    width: '100%',
  },
  xLabelActive: {
    color: '#ffffff',
    fontWeight: '900',
  },

  // Line chart
  dotValueLabel: {
    position: 'absolute',
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
    width: 40,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  lineXLabel: {
    color: CHART_COLORS.label,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },

  // Hint
  hintText: {
    color: '#44446a',
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 2,
  },

  // Empty
  emptyChart: {
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  emptyIcon: { fontSize: 36 },
  emptyText: {
    color: '#555',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: 240,
    lineHeight: 18,
  },
});
