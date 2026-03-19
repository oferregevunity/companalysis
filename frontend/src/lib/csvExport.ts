import type { ComparisonRow } from '../types';
import { formatMonth } from './dataProcessing';

export function exportToCsv(
  data: ComparisonRow[],
  months: string[],
  metricView: string,
  filename: string
) {
  const rows: string[][] = [];
  const hasMultipleGenres = new Set(data.map(r => r.genreName)).size > 1;
  const isRevenue = metricView !== 'downloads';

  const header = ['#', 'App Name', 'Publisher'];
  if (hasMultipleGenres) header.push('Genre');
  header.push('Rising (Rev)', 'Rising (DL)');

  for (let i = 0; i < months.length; i++) {
    const label = formatMonth(months[i]);
    if (isRevenue) {
      header.push(`${label} Revenue`);
      if (i > 0) header.push(`${label} Rev %`);
    } else {
      header.push(`${label} Downloads`);
      if (i > 0) header.push(`${label} DL %`);
    }
  }
  header.push(
    isRevenue ? 'Daily Revenue' : 'Daily Downloads',
    'App Store ID',
    'Google Play ID'
  );
  rows.push(header);

  data.forEach((row, idx) => {
    const csvRow: string[] = [
      String(idx + 1),
      row.appName,
      row.publisherName,
    ];

    if (hasMultipleGenres) csvRow.push(row.genreName);
    csvRow.push(row.risingStatus, row.risingStatusDownloads);

    for (let i = 0; i < months.length; i++) {
      if (isRevenue) {
        csvRow.push(String(row.revenueByMonth[months[i]]?.toFixed(2) ?? '0'));
        if (i > 0) {
          const val = row.percentChanges[months[i]];
          csvRow.push(val !== null && val !== undefined ? val.toFixed(1) + '%' : '');
        }
      } else {
        csvRow.push(String(row.downloadsByMonth[months[i]]?.toFixed(0) ?? '0'));
        if (i > 0) {
          const val = row.downloadPercentChanges[months[i]];
          csvRow.push(val !== null && val !== undefined ? val.toFixed(1) + '%' : '');
        }
      }
    }

    csvRow.push(
      isRevenue ? String(row.dailyRevenue.toFixed(2)) : String(row.dailyDownloads.toFixed(0)),
      row.iosAppId || '',
      row.androidAppId || '',
    );
    rows.push(csvRow);
  });

  const csvContent = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
