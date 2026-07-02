const NY = 'America/New_York';

/**
 * Stable Firestore doc id for the Monday scheduled pair (apps + creatives).
 * Both jobs use the NY calendar date of the Monday they run on.
 */
export function weeklyScheduledRunDocId(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `weekly-${y}-${m}-${d}`;
}
