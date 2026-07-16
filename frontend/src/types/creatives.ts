import type { Timestamp } from 'firebase/firestore';

export type QueryableAdNetwork =
  | 'Instagram'
  | 'Facebook'
  | 'Meta Audience Network'
  | 'TikTok'
  | 'Youtube'
  | 'Admob'
  | 'Applovin'
  | 'Unity'
  | 'Vungle'
  | 'Mintegral'
  | 'Supersonic'
  | 'Chartboost';

/** Mirrors `functions/src/adIntel/types.ts`. */
export type CreativeFormat = 'video' | 'image' | 'playable' | 'unknown';

/**
 * One date-bucket from Sensor Tower `ad_units[].breakdown` (stored on `StoredCreative`).
 * Mirrors `BreakdownBucket` in `functions/src/adIntel/types.ts`.
 */
export interface BreakdownBucket {
  start: string;
  end: string;
  share: number;
}

export interface StoredCreative {
  creativeKey: string;
  sampleId: string;
  phashionGroup: string | null;
  appId: string;
  networks: QueryableAdNetwork[];
  format: CreativeFormat;
  country: string;
  firstSeen: string;
  lastSeen: string;
  durationDays: number;
  maxShare: number | null;
  mediaUrl: string | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  videoDurationSec: number | null;
  width: number | null;
  height: number | null;
  title: string | null;
  message: string | null;
  buttonText: string | null;
  variantCount: number;
  adFormats: string[];
  breakdown: BreakdownBucket[];
  genreId: string;
  capturedWeek: string;
}

/** docId is `${appId}__${creativeKey}`. Frontend treats it as an opaque string. */
export type CreativeDocId = string;

export function makeCreativeDocId(appId: string, creativeKey: string): CreativeDocId {
  return `${appId}__${creativeKey}`;
}

/** Mirrors `SubScores` in `functions/src/creativeInsights/scoringEngine.ts`. */
export interface CreativeSubScores {
  longevity: number;
  networkBreadth: number;
  impressionMomentum: number;
  freshnessAdjustedPersistence: number;
}

/**
 * Mirrors `CreativeScoreRow` in `functions/src/creativeInsights/scoringPipeline.ts`.
 * After Firestore write, `computedAt` is a server timestamp (not the ISO string used in tests).
 */
export interface CreativeScoreRow {
  docId: CreativeDocId;
  creativeKey: string;
  appId: string;
  genreId: string;
  week: string;
  score: number;
  subScores: CreativeSubScores;
  computedAt?: Timestamp | { seconds: number; nanoseconds: number } | string;
}

/** Mirrors `HOOK_TYPES` in `functions/src/creativeInsights/geminiClient.ts`. */
export const HOOK_TYPES = [
  'Fail & Frustration',
  'Satisfying / ASMR',
  'Challenge / Can You Beat',
  'Narrative / Story',
  'Tutorial / How-To',
  'UGC / Reaction',
  'Before & After',
  'Gameplay Showcase',
  'Reward / Progression',
  'Comparison / VS',
  'Other',
] as const;

export type HookType = (typeof HOOK_TYPES)[number];

/** Per-creative AI classification. `creativeId` is a docId (`appId__creativeKey`). */
export interface CreativeTag {
  creativeId: CreativeDocId;
  hookType: HookType;
  themes: string[];
}

/**
 * Mirrors `CreativeInsightDoc` in `functions/src/creativeInsights/pipeline.ts`.
 * `winners[].creativeId` / `watchList[].creativeId` are docIds (`appId__creativeKey`).
 */
export interface CreativeInsightDoc {
  genreId: string;
  week: string;
  generatedAt?: { seconds: number; nanoseconds: number } | Date;
  summary: string;
  winners: Array<{
    creativeId: CreativeDocId;
    appId: string;
    appName: string;
    rank: number;
    score: number;
    subScores: CreativeSubScores;
    explanation: string;
  }>;
  emergingConcepts: Array<{
    title: string;
    description: string;
    exampleCreativeIds: CreativeDocId[];
  }>;
  watchList: Array<{
    creativeId: CreativeDocId;
    appId: string;
    appName: string;
    score: number;
    reason: string;
  }>;
  /** Absent on docs generated before hook/theme classification shipped. */
  creativeTags?: CreativeTag[];
  geminiError?: string;
}

/** Cached display row in `appNames/{unifiedAppId}` (see backend upserts). */
export interface AppNameEntry {
  unifiedAppId?: string;
  name: string;
  publisherName?: string | null;
  iconUrl?: string | null;
}
