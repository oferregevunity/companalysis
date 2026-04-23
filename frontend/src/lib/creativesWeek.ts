/**
 * ISO week keys aligned with `weekKeyFromStart` in `functions/src/adIntel/fetchCreativesForGenre.ts`.
 * Week start is Monday (`YYYY-MM-DD` in UTC).
 */

/** ISO week key from a week start date (`YYYY-MM-DD`). */
export function weekKeyFromStart(weekStart: string): string {
  const d = new Date(weekStart);
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function formatUtcYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday (UTC) of the ISO week that contains `d`. */
export function mondayOfWeekContaining(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  x.setUTCDate(x.getUTCDate() + offset);
  return x;
}

/**
 * Latest creative week key: the most recently *completed* Mon–Sun week in UTC.
 *
 * We target the week containing (today − 7 days) so the week boundary is
 * always in the past. Sensor Tower only indexes creatives for completed
 * weeks; defaulting to the current in-progress week returned zero results.
 */
export function getLatestCreativeWeek(): string {
  const now = new Date();
  const lastWeekAnchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7));
  const monday = mondayOfWeekContaining(lastWeekAnchor);
  return weekKeyFromStart(formatUtcYmd(monday));
}

function parseWeekKey(week: string): { year: number; weekNum: number } | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(week.trim());
  if (!m) return null;
  return { year: Number(m[1]), weekNum: Number(m[2]) };
}

/** Monday of ISO week `weekNum` in `year` (UTC). */
function mondayOfIsoWeek(year: number, weekNum: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Dow + 1);
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (weekNum - 1) * 7);
  return monday;
}

export function getCreativeWeekBounds(week?: string): { week: string; startDate: string; endDate: string } {
  const wk = week?.trim() ? week.trim() : getLatestCreativeWeek();
  const parsed = parseWeekKey(wk);
  if (!parsed) {
    const mon = mondayOfWeekContaining(new Date());
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    const start = formatUtcYmd(mon);
    return { week: weekKeyFromStart(start), startDate: start, endDate: formatUtcYmd(sun) };
  }
  const mon = mondayOfIsoWeek(parsed.year, parsed.weekNum);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const canonical = weekKeyFromStart(formatUtcYmd(mon));
  return { week: canonical, startDate: formatUtcYmd(mon), endDate: formatUtcYmd(sun) };
}
