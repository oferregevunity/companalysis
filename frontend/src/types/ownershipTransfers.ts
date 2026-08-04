/** A developer on one side of an ownership transfer. */
export interface TransferDeveloper {
  storeId: string;
  name: string;
  isPublisher: boolean | null;
  isStarred: boolean | null;
  /** ISO 3166-1 alpha-2 country, when known (only for tracked publishers). */
  country: string | null;
}

/** One ownership-transfer row (mirrors the `ownershipTransfers` Firestore doc). */
export interface OwnershipTransfer {
  key: string;
  app: {
    storeId: string;
    name: string;
    iconUrl: string | null;
    store: string; // "GooglePlay" | "AppStore"
  };
  from: TransferDeveloper;
  to: TransferDeveloper;
  /** ISO date-time the transfer was detected. */
  detectedAt: string;
  /** Tracked publisher labels that surfaced this transfer. */
  trackedPublishers: string[];
}
