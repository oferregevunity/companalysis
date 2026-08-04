/**
 * AppBird app-details shapes, mirroring `functions/src/appbird/client.ts`.
 * Served by the `appbird/app` route (Firestore-cached), not read from Firestore.
 */

export interface AppbirdCategory {
  name: string;
  slug: string;
}

export interface AppbirdAppDeveloper {
  storeId: string;
  name: string;
  legalName: string | null;
  storePageUrl: string | null;
  website: string | null;
  email: string | null;
  iconUrl: string | null;
  isStarred: boolean | null;
  isPublisher: boolean | null;
}

export interface AppbirdLinkedApp {
  store: string;
  storeId: string;
  name: string;
}

export interface AppbirdCategoryRanking {
  categoryName: string;
  categorySlug: string;
  rank: number;
  isGames: boolean;
  /** "TopFree" | "TopGrossing" | "TopPaid" | … */
  collection: string;
  /** "android" | "iphone" | "ipad" | … */
  device: string;
}

export interface AppbirdVideo {
  previewUrl: string | null;
  videoUrl: string | null;
}

export interface AppbirdPermissionGroup {
  label: string;
  permissions: string[];
}

export interface AppbirdIapItem {
  title: string;
  price: string;
}

export interface AppbirdStorefront {
  country: string | null;
  language: string | null;
  pageUrl: string | null;
}

export interface AppbirdApp {
  storeId: string;
  store: string; // "GooglePlay" | "AppStore"
  isGame: boolean;
  bundleId: string | null;
  name: string;
  releasedAt: string | null;
  updatedAt: string | null;
  deletedAt: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  categories: AppbirdCategory[];
  tags: string[];
  storeTags: string[];
  iconUrl: string | null;
  coverUrl: string | null;
  developer: AppbirdAppDeveloper | null;
  storefront: AppbirdStorefront | null;
  summary: string | null;
  description: string | null;
  recentChanges: string | null;
  appVersion: string | null;
  filesize: string | null;
  screenshots: string[];
  ipadScreenshots: string[];
  videos: AppbirdVideo[];
  requiredOsVersion: string | null;
  contentRating: string | null;
  privacyPolicyUrl: string | null;
  emailSupport: string | null;
  website: string | null;
  permissions: AppbirdPermissionGroup[];
  free: boolean;
  hasIap: boolean | null;
  comingSoon: boolean | null;
  iapItems: AppbirdIapItem[];
  iapPriceRange: string | null;
  price: number;
  currency: string | null;
  rating: number;
  histogram: Record<string, number>;
  numberVoters: number;
  numberReviews: number;
  installs: number;
  linkedApps: AppbirdLinkedApp[];
  categoryRankings: AppbirdCategoryRanking[];
}

export interface AppbirdAppDetails {
  app: AppbirdApp;
  /** ISO time the listing was pulled from AppBird. */
  fetchedAt: string;
  fromCache: boolean;
}
