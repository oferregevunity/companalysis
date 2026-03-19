import { useSyncExternalStore } from 'react';
import { fetchStore } from '../lib/fetchStore';

export function useFetchProgress() {
  return useSyncExternalStore(fetchStore.subscribe, fetchStore.getState);
}
