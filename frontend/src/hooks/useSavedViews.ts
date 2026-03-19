import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type { SavedViewPayload } from '../types/savedView';

export type SavedViewDoc = {
  id: string;
  name: string;
  payload: SavedViewPayload;
  ownerId: string;
  ownerEmail?: string;
  visibility: string;
  sharedWith?: string[];
};

function mapDoc(id: string, data: Record<string, unknown>): SavedViewDoc | null {
  if (typeof data.name !== 'string' || !data.payload || typeof data.payload !== 'object') return null;
  return {
    id,
    name: data.name,
    payload: data.payload as SavedViewPayload,
    ownerId: String(data.ownerId || ''),
    ownerEmail: typeof data.ownerEmail === 'string' ? data.ownerEmail : undefined,
    visibility: String(data.visibility || 'private'),
    sharedWith: Array.isArray(data.sharedWith) ? (data.sharedWith as string[]) : [],
  };
}

export function useSavedViews() {
  const [uid, setUid] = useState<string | null>(() => auth.currentUser?.uid ?? null);
  const [myViews, setMyViews] = useState<SavedViewDoc[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<SavedViewDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged((u) => {
      setUid(u?.uid ?? null);
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!uid) {
      setMyViews([]);
      setSharedWithMe([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const qMine = query(collection(db, 'savedViews'), where('ownerId', '==', uid));
    const qShared = query(collection(db, 'savedViews'), where('sharedWith', 'array-contains', uid));

    let mineReady = false;
    let sharedReady = false;
    const tryDone = () => {
      if (mineReady && sharedReady) setLoading(false);
    };

    const unsub1: Unsubscribe = onSnapshot(
      qMine,
      (snap) => {
        const list = snap.docs
          .map((d) => mapDoc(d.id, d.data() as Record<string, unknown>))
          .filter((x): x is SavedViewDoc => x !== null);
        setMyViews(list);
        mineReady = true;
        tryDone();
      },
      (err) => {
        setError(err.message);
        mineReady = true;
        tryDone();
      }
    );

    const unsub2: Unsubscribe = onSnapshot(
      qShared,
      (snap) => {
        const list = snap.docs
          .map((d) => mapDoc(d.id, d.data() as Record<string, unknown>))
          .filter((x): x is SavedViewDoc => x !== null);
        setSharedWithMe(list);
        sharedReady = true;
        tryDone();
      },
      (err) => {
        setError(err.message);
        sharedReady = true;
        tryDone();
      }
    );

    return () => {
      unsub1();
      unsub2();
    };
  }, [uid]);

  return useMemo(
    () => ({ myViews, sharedWithMe, loading, error }),
    [myViews, sharedWithMe, loading, error]
  );
}
