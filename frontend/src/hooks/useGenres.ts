import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Genre } from '../types';

export function useGenres() {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'genres'), orderBy('name'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          name: d.name || '',
          categoryIds: d.categoryIds || { ios: '', android: '' },
          country: d.country || 'US',
          monthsBack: d.monthsBack || 6,
          active: d.active ?? true,
          createdAt: d.createdAt?.toDate() || new Date(),
        } as Genre;
      });
      setGenres(data);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return { genres, loading };
}
