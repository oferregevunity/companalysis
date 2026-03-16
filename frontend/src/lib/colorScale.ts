/**
 * Google Sheets-inspired conditional formatting.
 * Subtle pastel backgrounds with strong colored text.
 */

export function getHeatmapBg(percent: number | null): string {
  if (percent === null || percent === undefined || isNaN(percent)) return 'transparent';

  if (percent >= 50) return '#b7e1cd';
  if (percent >= 30) return '#ceead6';
  if (percent >= 15) return '#e6f4ea';
  if (percent >= 5) return '#f0faf3';
  if (percent > -5) return 'transparent';
  if (percent >= -15) return '#fce8e6';
  if (percent >= -30) return '#f4c7c3';
  if (percent >= -50) return '#eea29e';
  return '#e67c73';
}

export function getHeatmapText(percent: number | null): string {
  if (percent === null || percent === undefined || isNaN(percent)) return '#5f6368';

  if (percent >= 5) return '#137333';
  if (percent > -5) return '#5f6368';
  if (percent >= -30) return '#c5221f';
  return '#a50e0e';
}

export function getColorForPercent(percent: number | null): string {
  return getHeatmapBg(percent);
}

export function getTextColorForPercent(percent: number | null): string {
  return getHeatmapText(percent);
}
