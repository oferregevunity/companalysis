import { describe, it, expect } from 'vitest';
import { mergeAppsWithWatchlist } from './watchlist';

describe('mergeAppsWithWatchlist', () => {
  it('returns top-N apps when no watchlist', () => {
    expect(mergeAppsWithWatchlist(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
  });

  it('appends watchlist apps that are not already in top-N, preserving order', () => {
    expect(mergeAppsWithWatchlist(['a', 'b'], ['c', 'a', 'd'])).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('deduplicates', () => {
    expect(mergeAppsWithWatchlist(['a', 'a'], ['a', 'b', 'b'])).toEqual(['a', 'b']);
  });

  it('returns empty array when both inputs are empty', () => {
    expect(mergeAppsWithWatchlist([], [])).toEqual([]);
  });
});
