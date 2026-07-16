import type { Genre } from '../types';
import type { SearchedGame } from './creativesApi';

/**
 * Tracked genres a Sensor Tower game belongs to, matched by store category.
 * Genres whose iOS category equals the game's primary game category come
 * first, so `[0]` is the best genre to pivot the Creatives page to.
 */
export function matchGenresForGame(game: SearchedGame, genres: Genre[]): Genre[] {
  const matched = genres.filter(
    (g) =>
      (g.categoryIds.ios && game.iosCategories.includes(g.categoryIds.ios)) ||
      (g.categoryIds.android && game.androidCategories.includes(g.categoryIds.android.toUpperCase())),
  );
  return matched.sort((a, b) => {
    const aExact = a.categoryIds.ios === game.gameCategory ? 0 : 1;
    const bExact = b.categoryIds.ios === game.gameCategory ? 0 : 1;
    return aExact - bExact;
  });
}
