import type { AppData, ComparisonRow, RisingStatus } from '../types';

function daysInPeriod(periodStr: string): number {
  if (periodStr.includes('W')) return 7;
  const [year, month] = periodStr.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

function computePercentChanges(
  values: Record<string, number>,
  months: string[]
): Record<string, number | null> {
  const changes: Record<string, number | null> = {};
  for (let i = 1; i < months.length; i++) {
    const prev = values[months[i - 1]];
    const curr = values[months[i]];
    if (prev > 0) {
      changes[months[i]] = ((curr - prev) / prev) * 100;
    } else if (curr > 0) {
      changes[months[i]] = 100;
    } else {
      changes[months[i]] = null;
    }
  }
  return changes;
}

export function computeRisingStatus(
  percentChanges: Record<string, number | null>,
  months: string[],
  threshold: number = 20
): RisingStatus {
  const sorted = [...months].sort();
  for (const level of [3, 2, 1] as const) {
    if (sorted.length < level + 1) continue;
    let match = true;
    for (let i = 0; i < level; i++) {
      const month = sorted[sorted.length - 1 - i];
      const pct = percentChanges[month];
      if (pct === null || pct === undefined || pct < threshold) {
        match = false;
        break;
      }
    }
    if (match) return `Rising ${level}` as RisingStatus;
  }
  return 'NOT';
}

export function buildComparisonData(
  months: string[],
  appsByMonth: Record<string, AppData[]>,
  genreName: string = '',
  genreId: string = '',
  risingThreshold: number = 20
): ComparisonRow[] {
  if (months.length === 0) return [];

  const latestMonth = months[months.length - 1];
  const latestApps = appsByMonth[latestMonth] || [];

  const monthMaps = new Map<string, Map<string, AppData>>();
  for (const month of months) {
    const apps = appsByMonth[month] || [];
    const map = new Map<string, AppData>();
    for (const app of apps) {
      map.set(app.unifiedAppId, app);
    }
    monthMaps.set(month, map);
  }

  const latestDays = daysInPeriod(latestMonth);

  return latestApps.map((app) => {
    const revenueByMonth: Record<string, number> = {};
    const downloadsByMonth: Record<string, number> = {};

    for (const month of months) {
      const found = monthMaps.get(month)!.get(app.unifiedAppId);
      revenueByMonth[month] = found ? found.storeRevenue : 0;
      downloadsByMonth[month] = found ? found.downloads : 0;
    }

    const percentChanges = computePercentChanges(revenueByMonth, months);
    const downloadPercentChanges = computePercentChanges(downloadsByMonth, months);

    const latestRevenue = revenueByMonth[latestMonth] || 0;
    const latestDownloads = downloadsByMonth[latestMonth] || 0;
    const dailyRevenue = latestDays > 0 ? latestRevenue / latestDays : 0;
    const dailyDownloads = latestDays > 0 ? latestDownloads / latestDays : 0;

    return {
      appName: app.unifiedAppName,
      appId: app.unifiedAppId,
      publisherName: app.publisherName || '',
      genreName,
      genreId,
      allGenres: genreId ? [{ id: genreId, name: genreName }] : [],
      iosAppId: app.iosAppId || null,
      androidAppId: app.androidAppId || null,
      revenueByMonth,
      downloadsByMonth,
      percentChanges,
      downloadPercentChanges,
      dailyRevenue,
      dailyDownloads,
      risingStatus: computeRisingStatus(percentChanges, months, risingThreshold),
      risingStatusDownloads: computeRisingStatus(downloadPercentChanges, months, risingThreshold),
    };
  });
}

export function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

export function formatPercent(value: number | null): string {
  if (value === null || value === undefined || isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-');
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function formatWeek(weekStr: string): string {
  const match = weekStr.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return weekStr;
  const [, year, week] = match;
  const jan4 = new Date(Number(year), 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1 + (Number(week) - 1) * 7);
  return `W${week} ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}
