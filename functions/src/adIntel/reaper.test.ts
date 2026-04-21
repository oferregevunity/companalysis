import { describe, it, expect } from 'vitest';
import { selectStaleCreatives } from './reaper';

describe('selectStaleCreatives', () => {
  it('returns creatives whose lastSeen is older than the threshold', () => {
    const now = new Date('2026-04-21T00:00:00Z');
    const fresh = { id: 'app-1__fresh', lastSeen: '2026-04-01' };
    const stale = { id: 'app-1__stale', lastSeen: '2026-01-01' };
    const result = selectStaleCreatives([fresh, stale], now, 60);
    expect(result.map(c => c.id)).toEqual(['app-1__stale']);
  });

  it('treats the boundary as inclusive of "still fresh" (strictly older only)', () => {
    const now = new Date('2026-04-21T00:00:00Z');
    const exactlyAtCutoff = { id: 'app-1__boundary', lastSeen: '2026-02-20' };
    const oneDayPastCutoff = { id: 'app-1__past', lastSeen: '2026-02-19' };
    const result = selectStaleCreatives([exactlyAtCutoff, oneDayPastCutoff], now, 60);
    expect(result.map(c => c.id)).toEqual(['app-1__past']);
  });

  it('excludes creatives within the window', () => {
    const now = new Date('2026-04-21T00:00:00Z');
    const within = { id: 'app-1__within', lastSeen: '2026-03-15' };
    const result = selectStaleCreatives([within], now, 60);
    expect(result).toEqual([]);
  });

  it('skips rows with missing or unparseable lastSeen', () => {
    const now = new Date('2026-04-21T00:00:00Z');
    const rows = [
      { id: 'app-1__empty', lastSeen: '' },
      { id: 'app-1__bad', lastSeen: 'not-a-date' },
      { id: 'app-1__null' as string, lastSeen: null as unknown as string },
    ];
    const result = selectStaleCreatives(rows, now, 60);
    expect(result).toEqual([]);
  });
});
