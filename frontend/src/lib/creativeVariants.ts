import type { JoinedCreative } from '../hooks/useCreativesForGenre';
import type { QueryableAdNetwork } from '../types/creatives';

/**
 * Client-side variant grouping (#4). Sensor Tower's `phashionGroup` is a
 * perceptual-hash key that already collapses cross-network dupes WITHIN an
 * app+country server-side (see functions/src/adIntel/fetchCreativesForGenre.ts).
 * What's left in the gallery is the SAME concept run across MULTIPLE competitor
 * apps — the stock/templated ads several rivals ship. Collapsing those into one
 * representative tile declutters the gallery and, crucially, makes SoV/longevity
 * honest (a shared stock video isn't 5 independent winners).
 *
 * Pure: takes whatever list is being displayed and returns a collapsed view.
 * Creatives with a null `phashionGroup` are never merged (each keeps its own
 * key), so we only ever group things Sensor Tower says are the same asset.
 */

export interface VariantMeta {
  /** Members in the group (>= 2 for a real variant group). */
  count: number;
  /** Distinct apps (games) running this concept. */
  games: string[];
  /** Union of networks across members. */
  networks: QueryableAdNetwork[];
  /** Union of member countries. */
  countries: string[];
}

export interface VariantGrouped {
  /** One representative per group (best member, with aggregated stats), input order preserved. */
  representatives: JoinedCreative[];
  /** Variant metadata keyed by representative.docId — only for groups with count > 1. */
  meta: Map<string, VariantMeta>;
  /** How many tiles were removed by collapsing (input length − representatives length). */
  collapsed: number;
}

/** Grouping key: the phashion group when present, else the docId (never merges nulls). */
function keyOf(c: JoinedCreative): string {
  return c.phashionGroup ? `ph:${c.phashionGroup}` : `id:${c.docId}`;
}

/** The stronger of two members: higher score, then longer-lived, then higher SoV. */
function isBetter(a: JoinedCreative, b: JoinedCreative): boolean {
  const as = a.score ?? -Infinity;
  const bs = b.score ?? -Infinity;
  if (as !== bs) return as > bs;
  if (a.durationDays !== b.durationDays) return a.durationDays > b.durationDays;
  return (a.maxShare ?? -Infinity) > (b.maxShare ?? -Infinity);
}

export const NO_VARIANTS: Map<string, VariantMeta> = new Map();

export function groupVariants(creatives: JoinedCreative[]): VariantGrouped {
  interface Bucket {
    firstIndex: number;
    rep: JoinedCreative;
    members: JoinedCreative[];
    games: Set<string>;
    networks: Set<QueryableAdNetwork>;
    countries: Set<string>;
    maxShare: number | null;
    durationDays: number;
  }
  const buckets = new Map<string, Bucket>();

  creatives.forEach((c, i) => {
    const key = keyOf(c);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        firstIndex: i,
        rep: c,
        members: [c],
        games: new Set([c.appId]),
        networks: new Set(c.networks),
        countries: new Set([c.country]),
        maxShare: c.maxShare,
        durationDays: c.durationDays,
      });
      return;
    }
    existing.members.push(c);
    existing.games.add(c.appId);
    for (const n of c.networks) existing.networks.add(n);
    existing.countries.add(c.country);
    if (c.maxShare != null) existing.maxShare = Math.max(existing.maxShare ?? -Infinity, c.maxShare);
    existing.durationDays = Math.max(existing.durationDays, c.durationDays);
    if (isBetter(c, existing.rep)) existing.rep = c;
  });

  const ordered = [...buckets.values()].sort((a, b) => a.firstIndex - b.firstIndex);
  const representatives: JoinedCreative[] = [];
  const meta = new Map<string, VariantMeta>();

  for (const b of ordered) {
    // Aggregate the honest, concept-level stats onto the representative.
    const rep: JoinedCreative = {
      ...b.rep,
      networks: [...b.networks].sort() as QueryableAdNetwork[],
      maxShare: b.maxShare,
      durationDays: b.durationDays,
    };
    representatives.push(rep);
    if (b.members.length > 1) {
      meta.set(rep.docId, {
        count: b.members.length,
        games: [...b.games],
        networks: rep.networks,
        countries: [...b.countries].sort(),
      });
    }
  }

  return { representatives, meta, collapsed: creatives.length - representatives.length };
}
