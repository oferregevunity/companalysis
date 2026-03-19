import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../lib/firebase';

export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const favRef = useRef(favorites);
  favRef.current = favorites;

  useEffect(() => {
    let unsubFirestore: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubFirestore) {
        unsubFirestore();
        unsubFirestore = null;
      }

      if (!user) {
        setFavorites(new Set());
        setLoading(false);
        return;
      }

      const q = query(collection(db, 'favorites'), where('userId', '==', user.uid));
      unsubFirestore = onSnapshot(q, (snap) => {
        const ids = new Set<string>();
        snap.docs.forEach((d) => ids.add(d.data().appId as string));
        setFavorites(ids);
        setLoading(false);
      });
    });

    return () => {
      unsubAuth();
      if (unsubFirestore) unsubFirestore();
    };
  }, []);

  const toggleFavorite = useCallback(async (appId: string) => {
    const user = auth.currentUser;
    if (!user) return;

    const docId = `${user.uid}_${appId}`;
    const ref = doc(db, 'favorites', docId);

    if (favRef.current.has(appId)) {
      setFavorites((prev) => { const next = new Set(prev); next.delete(appId); return next; });
      await deleteDoc(ref);
    } else {
      setFavorites((prev) => new Set(prev).add(appId));
      await setDoc(ref, {
        userId: user.uid,
        appId,
        createdAt: new Date(),
      });
    }
  }, []);

  return { favorites, toggleFavorite, loading };
}
