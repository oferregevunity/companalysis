import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { FetchLog } from '../types';

export function useFetchLogs(maxLogs = 10) {
  const [logs, setLogs] = useState<FetchLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'fetchLogs'),
      orderBy('startedAt', 'desc'),
      limit(maxLogs)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        startedAt: doc.data().startedAt?.toDate() || new Date(),
        completedAt: doc.data().completedAt?.toDate() || null,
      })) as FetchLog[];
      setLogs(data);
      setLoading(false);
    });
    return unsubscribe;
  }, [maxLogs]);

  return { logs, loading };
}
