/**
 * The publishers whose game ownership-transfers we track. Each publisher is an
 * AppBird `Publisher`-tagged developer brand, with (usually) one developer id
 * per store. We fetch every developer id below via GET /v1/developers/{id} and
 * union their transfers into the feed.
 *
 * Resolved via AppBird `/v1/search?entity=developer&type=developer_name`, then
 * verified against `/v1/developers/{id}` (transfer count + isPublisher). Stale
 * / legacy accounts were intentionally dropped (see notes).
 */
export interface TrackedDeveloper {
  store: 'AppStore' | 'GooglePlay';
  storeId: string;
}

export interface TrackedPublisher {
  /** Display label for the feed's publisher filter. */
  label: string;
  /** ISO 3166-1 alpha-2 HQ country, for the flag. */
  country: string | null;
  developers: TrackedDeveloper[];
}

export const TRACKED_PUBLISHERS: TrackedPublisher[] = [
  {
    label: 'Voodoo',
    country: 'FR',
    developers: [
      { store: 'AppStore', storeId: '714804730' },
      { store: 'GooglePlay', storeId: 'VOODOO' },
    ],
  },
  {
    label: 'Rollic',
    country: 'TR',
    developers: [
      { store: 'AppStore', storeId: '1452111779' },
      { store: 'GooglePlay', storeId: '6018074114375198913' },
    ],
  },
  {
    label: 'Lion Studios',
    country: 'US',
    developers: [
      { store: 'AppStore', storeId: '1362220666' },
      { store: 'GooglePlay', storeId: '6990178528646658622' },
      // "Lion Studios Plus" — separate active AppLovin publishing label.
      { store: 'AppStore', storeId: '1610194568' },
      { store: 'GooglePlay', storeId: '6957694463935118175' },
    ],
  },
  {
    label: 'SayGames',
    country: 'CY',
    developers: [
      { store: 'AppStore', storeId: '1551847165' },
      { store: 'GooglePlay', storeId: '6392896734092635573' },
    ],
  },
  {
    label: 'Homa',
    country: 'FR',
    developers: [
      // Active App Store account (dropped legacy 1316437775, last transfer 2020).
      { store: 'AppStore', storeId: '1508492426' },
      { store: 'GooglePlay', storeId: '4656343638685426415' },
    ],
  },
  {
    label: 'Falcon',
    country: 'SG',
    developers: [
      { store: 'AppStore', storeId: '1439862247' },
      { store: 'GooglePlay', storeId: '5293766053124296887' },
    ],
  },
  {
    label: 'ABI',
    country: 'HK',
    developers: [
      // Google Play brand only — no App Store counterpart found.
      { store: 'GooglePlay', storeId: 'ABI GAME' },
    ],
  },
];

/** Flat list of every tracked developer id with its publisher label + country. */
export function trackedDevelopers(): {
  storeId: string;
  store: 'AppStore' | 'GooglePlay';
  publisherLabel: string;
  country: string | null;
}[] {
  return TRACKED_PUBLISHERS.flatMap((p) =>
    p.developers.map((d) => ({
      storeId: d.storeId,
      store: d.store,
      publisherLabel: p.label,
      country: p.country,
    })),
  );
}
