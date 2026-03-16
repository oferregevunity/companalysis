import type { AppData, ComparisonRow } from '../types';

function daysInMonth(monthStr: string): number {
  const [year, month] = monthStr.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

export function buildComparisonData(
  months: string[],
  appsByMonth: Record<string, AppData[]>,
  genreName: string = '',
  genreId: string = ''
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

  const latestDays = daysInMonth(latestMonth);

  return latestApps.map((app) => {
    const revenueByMonth: Record<string, number> = {};
    const downloadsByMonth: Record<string, number> = {};
    const percentChanges: Record<string, number | null> = {};

    for (const month of months) {
      const found = monthMaps.get(month)!.get(app.unifiedAppId);
      revenueByMonth[month] = found ? found.storeRevenue : 0;
      downloadsByMonth[month] = found ? found.downloads : 0;
    }

    for (let i = 1; i < months.length; i++) {
      const prev = revenueByMonth[months[i - 1]];
      const curr = revenueByMonth[months[i]];

      if (prev > 0) {
        percentChanges[months[i]] = ((curr - prev) / prev) * 100;
      } else if (curr > 0) {
        percentChanges[months[i]] = 100;
      } else {
        percentChanges[months[i]] = null;
      }
    }

    const latestRevenue = revenueByMonth[latestMonth] || 0;
    const dailyRevenue = latestDays > 0 ? latestRevenue / latestDays : 0;

    return {
      appName: app.unifiedAppName,
      appId: app.unifiedAppId,
      publisherName: app.publisherName || '',
      genreName,
      genreId,
      iosAppId: app.iosAppId || null,
      androidAppId: app.androidAppId || null,
      revenueByMonth,
      downloadsByMonth,
      percentChanges,
      dailyRevenue,
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
