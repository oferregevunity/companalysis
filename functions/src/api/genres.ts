import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export const addGenre = onCall({ invoker: 'private' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }
  
  const { name, categoryIds } = request.data;
  if (!name || !categoryIds?.ios || !categoryIds?.android) {
    throw new HttpsError('invalid-argument', 'Name and categoryIds (ios, android) are required');
  }
  
  const genreRef = db.collection('genres').doc();
  await genreRef.set({
    name,
    categoryIds,
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  
  return { id: genreRef.id, name };
});

export const updateGenre = onCall({ invoker: 'private' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }
  
  const { id, ...updates } = request.data;
  if (!id) {
    throw new HttpsError('invalid-argument', 'Genre ID is required');
  }
  
  const genreRef = db.collection('genres').doc(id);
  const doc = await genreRef.get();
  if (!doc.exists) {
    throw new HttpsError('not-found', 'Genre not found');
  }
  
  const allowed: Record<string, any> = {};
  if (updates.name !== undefined) allowed.name = updates.name;
  if (updates.categoryIds !== undefined) allowed.categoryIds = updates.categoryIds;
  if (updates.active !== undefined) allowed.active = updates.active;
  
  await genreRef.update(allowed);
  return { success: true };
});

export const deleteGenre = onCall({ invoker: 'private' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }
  
  const { id } = request.data;
  if (!id) {
    throw new HttpsError('invalid-argument', 'Genre ID is required');
  }
  
  await db.collection('genres').doc(id).delete();
  return { success: true };
});
