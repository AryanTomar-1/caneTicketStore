import { Ticket } from '../types';
import { getTicketsBySeason } from './storage';
import { getAllSeasons, makeSeasonId } from './season';

// ─── Constants ────────────────────────────────────────────────────────────────

export const MERA_GANNA = 'मेरा गन्ना';

/** Any caneOwner that is NOT "मेरा गन्ना" is treated as "दूसरों का गन्ना" */
export const isDursoKaGanna = (caneOwner: string): boolean =>
  caneOwner.trim() !== MERA_GANNA && caneOwner.trim() !== '';

export type GannaType = 'mera' | 'durso';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChartDataPoint {
  label: string;        // X-axis label
  value: number;        // Primary metric (e.g. quintals)
  count?: number;       // Secondary metric (e.g. slip count)
  subLabel?: string;    // Optional small subtitle
}

export interface AnalyticsSummary {
  totalSlips: number;
  totalQuintals: number;
  topLabel: string;
  topValue: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const parseDDMMYYYY = (ddmmyyyy: string): Date | null => {
  const parts = ddmmyyyy.split('/');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts.map(Number);
  if (!dd || !mm || !yyyy) return null;
  return new Date(yyyy, mm - 1, dd);
};

const getWeekStart = (date: Date): string => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

/**
 * Format a week start date "DD/MM/YYYY" to a month-relative label
 * like "Sep W1", "Oct W3". Week number = ceil(dayOfMonth / 7).
 */
const weekLabel = (weekStartDDMMYYYY: string): string => {
  const parts = weekStartDDMMYYYY.split('/');
  if (parts.length !== 3) return weekStartDDMMYYYY;
  const [dd, mm, yyyy] = parts.map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Week-of-month: 1=days 1-7, 2=days 8-14, 3=days 15-21, 4=days 22-28, 5=days 29-31
  const weekNum = Math.ceil(dd / 7);
  return `${months[mm - 1]} W${weekNum}`;
};

/** Filter tickets by ganna type */
const filterByGannaType = (tickets: Ticket[], gannaType: GannaType): Ticket[] => {
  if (gannaType === 'mera') {
    return tickets.filter(t => t.caneOwner === MERA_GANNA);
  }
  // 'durso': any ticket where caneOwner is NOT मेरा गन्ना and is non-empty
  return tickets.filter(t => isDursoKaGanna(t.caneOwner));
};

const roundQ = (v: number) => Math.round(v * 10) / 10;

// ─── View 1: Weekly timeline ──────────────────────────────────────────────────

/**
 * Aggregates tickets by ISO week for the given gannaType.
 * Returns sorted weekly data points (earliest week first).
 */
export const getWeeklyTimeline = (tickets: Ticket[], gannaType: GannaType = 'mera'): {
  chartData: ChartDataPoint[];
  summary: AnalyticsSummary;
} => {
  const filtered = filterByGannaType(tickets, gannaType);

  const weekMap: Record<string, { quintals: number; slips: number; weekStart: string }> = {};

  for (const t of filtered) {
    const date = parseDDMMYYYY(t.date);
    if (!date) continue;
    const weekStart = getWeekStart(date);
    if (!weekMap[weekStart]) {
      weekMap[weekStart] = { quintals: 0, slips: 0, weekStart };
    }
    weekMap[weekStart].quintals += parseFloat(String(t.quantity)) || 0;
    weekMap[weekStart].slips += 1;
  }

  const sorted = Object.values(weekMap).sort((a, b) => {
    const da = parseDDMMYYYY(a.weekStart);
    const db = parseDDMMYYYY(b.weekStart);
    if (!da || !db) return 0;
    return da.getTime() - db.getTime();
  });

  const chartData: ChartDataPoint[] = sorted.map(w => ({
    label: weekLabel(w.weekStart),
    value: roundQ(w.quintals),
    count: w.slips,
    subLabel: w.weekStart,
  }));

  const totalSlips = filtered.length;
  const totalQuintals = filtered.reduce((s, t) => s + (parseFloat(String(t.quantity)) || 0), 0);

  let topLabel = '—';
  let topValue = 0;
  if (sorted.length > 0) {
    const top = sorted.reduce((a, b) => (a.quintals >= b.quintals ? a : b));
    topLabel = weekLabel(top.weekStart);
    topValue = roundQ(top.quintals);
  }

  return {
    chartData,
    summary: { totalSlips, totalQuintals: roundQ(totalQuintals), topLabel, topValue },
  };
};

// Backward-compat alias
export const getMeraGannaWeeklyTimeline = (tickets: Ticket[]) => getWeeklyTimeline(tickets, 'mera');

// ─── View 2: Farmer breakdown ─────────────────────────────────────────────────

/**
 * Groups tickets by farmer, sorted by total quintals descending.
 * For 'durso': groups by actual caneOwner name (field owner), then by farmer.
 */
export const getFarmerBreakdown = (tickets: Ticket[], gannaType: GannaType = 'mera'): {
  chartData: ChartDataPoint[];
  summary: AnalyticsSummary;
} => {
  const filtered = filterByGannaType(tickets, gannaType);

  const farmerMap: Record<string, { name: string; farmer_code: string; owner: string; quintals: number; slips: number }> = {};

  for (const t of filtered) {
    const key = t.farmer_code || t.name;
    if (!farmerMap[key]) {
      farmerMap[key] = { name: t.name, farmer_code: t.farmer_code, owner: t.caneOwner, quintals: 0, slips: 0 };
    }
    farmerMap[key].quintals += parseFloat(String(t.quantity)) || 0;
    farmerMap[key].slips += 1;
  }

  const sorted = Object.values(farmerMap).sort((a, b) => b.quintals - a.quintals);

  const chartData: ChartDataPoint[] = sorted.map(f => ({
    label: f.name,
    value: roundQ(f.quintals),
    count: f.slips,
    // For durso: also show the field owner name
    subLabel: gannaType === 'durso' ? `खेत मालिक: ${f.owner}` : f.farmer_code,
  }));

  const totalSlips = filtered.length;
  const totalQuintals = filtered.reduce((s, t) => s + (parseFloat(String(t.quantity)) || 0), 0);
  const top = sorted[0];

  return {
    chartData,
    summary: {
      totalSlips,
      totalQuintals: roundQ(totalQuintals),
      topLabel: top ? top.name : '—',
      topValue: top ? roundQ(top.quintals) : 0,
    },
  };
};

// Backward-compat aliases
export const getMeraGannaFarmerBreakdown = (tickets: Ticket[]) => getFarmerBreakdown(tickets, 'mera');

// ─── View 3: All seasons comparison ──────────────────────────────────────────

/**
 * Fetches tickets across all available seasons (up to 4),
 * filters by gannaType and returns quintal + slip totals per season.
 */
export const getAllSeasonsComparison = async (gannaType: GannaType = 'mera'): Promise<{
  chartData: ChartDataPoint[];
  summary: AnalyticsSummary;
}> => {
  const seasons = getAllSeasons(); // newest first

  const results: { seasonId: string; quintals: number; slips: number }[] = [];

  for (const season of seasons) {
    const seasonId = makeSeasonId(season.startYear);
    const tickets = await getTicketsBySeason(seasonId);
    const filtered = filterByGannaType(tickets, gannaType);
    const quintals = filtered.reduce((s, t) => s + (parseFloat(String(t.quantity)) || 0), 0);
    results.push({ seasonId, quintals: roundQ(quintals), slips: filtered.length });
  }

  // Show oldest → newest for left-to-right timeline feel
  const sorted = [...results].reverse();

  const chartData: ChartDataPoint[] = sorted.map(r => ({
    label: r.seasonId,
    value: r.quintals,
    count: r.slips,
  }));

  const totalSlips = results.reduce((s, r) => s + r.slips, 0);
  const totalQuintals = results.reduce((s, r) => s + r.quintals, 0);
  const top = [...results].sort((a, b) => b.quintals - a.quintals)[0];

  return {
    chartData,
    summary: {
      totalSlips,
      totalQuintals: roundQ(totalQuintals),
      topLabel: top ? top.seasonId : '—',
      topValue: top ? top.quintals : 0,
    },
  };
};
