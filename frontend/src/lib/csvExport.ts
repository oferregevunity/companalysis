import type { ComparisonRow } from '../types';
import { formatMonth } from './dataProcessing';

export function exportToCsv(
  data: ComparisonRow[],
  months: string[],
  _mode: string,
  filename: string
) {
  const rows: string[][] = [];
  const hasMultipleGenres = new Set(data.map(r => r.genreName)).size > 1;

  const header = ['#', 'App Name', 'Publisher'];
  if (hasMultipleGenres) header.push('Genre');
  for (let i = 0; i < months.length; i++) {
    const label = formatMonth(months[i]);
    header.push(`${label} Revenue`);
    if (i > 0) header.push(`${label} % Change`);
  }
  header.push('Daily Revenue', 'App Store ID', 'Google Play ID');
  rows.push(header);

  data.forEach((row, idx) => {
    const csvRow: string[] = [
      String(idx + 1),
      row.appName,
      row.publisherName,
    ];

    if (hasMultipleGenres) csvRow.push(row.genreName);

    for (let i = 0; i < months.length; i++) {
      csvRow.push(String(row.revenueByMonth[months[i]]?.toFixed(2) ?? '0'));
      if (i > 0) {
        const val = row.percentChanges[months[i]];
        csvRow.push(val !== null && val !== undefined ? val.toFixed(1) + '%' : '');
      }
    }

    csvRow.push(
      String(row.dailyRevenue.toFixed(2)),
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
