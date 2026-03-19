import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';

export type SavedViewPayload = {
  genres: string[];
  sorting: { id: string; desc: boolean }[];
  globalFilter: string;
  sortMetric: 'value' | 'percent';
  rising: string[];
  risingThreshold: number;
  favoritesOnly: boolean;
  dateFrom: string;
  dateTo: string;
  granularity: 'month' | 'week';
  metricView: 'revenue' | 'downloads';
  pageSize: number;
};

function isSortMetric(x: unknown): x is 'value' | 'percent' {
  return x === 'value' || x === 'percent';
}

function isGranularity(x: unknown): x is 'month' | 'week' {
  return x === 'month' || x === 'week';
}

function isMetricView(x: unknown): x is 'revenue' | 'downloads' {
  return x === 'revenue' || x === 'downloads';
}

export function parseSavedViewPayload(raw: unknown): SavedViewPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (!Array.isArray(p.genres) || !p.genres.every((g) => typeof g === 'string')) return null;
  if (!Array.isArray(p.sorting)) return null;
  for (const s of p.sorting) {
    if (!s || typeof s !== 'object') return null;
    const o = s as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.desc !== 'boolean') return null;
  }
  if (typeof p.globalFilter !== 'string') return null;
  if (!isSortMetric(p.sortMetric)) return null;
  if (!Array.isArray(p.rising) || !p.rising.every((r) => typeof r === 'string')) return null;
  if (typeof p.risingThreshold !== 'number' || Number.isNaN(p.risingThreshold)) return null;
  if (typeof p.favoritesOnly !== 'boolean') return null;
  if (typeof p.dateFrom !== 'string' || typeof p.dateTo !== 'string') return null;
  if (!isGranularity(p.granularity)) return null;
  if (!isMetricView(p.metricView)) return null;
  if (typeof p.pageSize !== 'number' || p.pageSize < 1 || p.pageSize > 500) return null;

  return {
    genres: p.genres as string[],
    sorting: p.sorting as { id: string; desc: boolean }[],
    globalFilter: p.globalFilter,
    sortMetric: p.sortMetric,
    rising: p.rising as string[],
    risingThreshold: p.risingThreshold,
    favoritesOnly: p.favoritesOnly,
    dateFrom: p.dateFrom,
    dateTo: p.dateTo,
    granularity: p.granularity,
    metricView: p.metricView,
    pageSize: p.pageSize,
  };
}

export type SavedViewVisibility = 'private' | 'shared' | 'anyone';

function isVisibility(x: unknown): x is SavedViewVisibility {
  return x === 'private' || x === 'shared' || x === 'anyone';
}

export async function createSavedView(
  db: Firestore,
  user: admin.auth.DecodedIdToken,
  body: {
    name?: string;
    payload?: unknown;
    visibility?: unknown;
    sharedWithEmails?: unknown;
  }
): Promise<{ id: string } | { error: string; status: number }> {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return { error: 'name is required', status: 400 };
  }
  if (!isVisibility(body.visibility)) {
    return { error: 'visibility must be private, shared, or anyone', status: 400 };
  }
  const payload = parseSavedViewPayload(body.payload);
  if (!payload) {
    return { error: 'Invalid payload', status: 400 };
  }

  const sharedWith: string[] = [];
  const emails = body.sharedWithEmails;
  if (Array.isArray(emails)) {
    for (const e of emails) {
      if (typeof e !== 'string' || !e.trim()) continue;
      try {
        const u = await admin.auth().getUserByEmail(e.trim().toLowerCase());
        if (!sharedWith.includes(u.uid)) sharedWith.push(u.uid);
      } catch {
        // skip unknown emails
      }
    }
  }

  const ref = db.collection('savedViews').doc();
  await ref.set({
    name,
    payload,
    ownerId: user.uid,
    ownerEmail: user.email || '',
    visibility: body.visibility,
    sharedWith,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { id: ref.id };
}

export async function inviteToSavedView(
  db: Firestore,
  user: admin.auth.DecodedIdToken,
  body: { presetId?: string; email?: string }
): Promise<{ success: true } | { error: string; status: number }> {
  const presetId = typeof body.presetId === 'string' ? body.presetId.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!presetId || !email) {
    return { error: 'presetId and email are required', status: 400 };
  }

  const snap = await db.collection('savedViews').doc(presetId).get();
  if (!snap.exists) {
    return { error: 'Preset not found', status: 404 };
  }
  const data = snap.data()!;
  if (data.ownerId !== user.uid) {
    return { error: 'Forbidden', status: 403 };
  }

  let uid: string;
  try {
    const u = await admin.auth().getUserByEmail(email);
    uid = u.uid;
  } catch {
    return { error: 'User not found for email', status: 404 };
  }

  await snap.ref.update({
    sharedWith: admin.firestore.FieldValue.arrayUnion(uid),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
}
