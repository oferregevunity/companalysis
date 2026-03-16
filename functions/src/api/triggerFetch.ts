import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { fetchAndStoreGenre } from '../sensorTower/fetchTopApps';
import { sensorTowerAuthToken } from '../sensorTower/client';

const db = admin.firestore();

export const triggerFetch = onCall(
  {
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [sensorTowerAuthToken],
    invoker: 'private',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }
    
    const { genreId } = request.data || {};
    const authToken = sensorTowerAuthToken.value();
    
    const logRef = db.collection('fetchLogs').doc();
    await logRef.set({
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'running',
      triggeredBy: request.auth.uid,
      genresProcessed: [],
      errors: [],
    });
    
    let query: FirebaseFirestore.Query = db.collection('genres').where('active', '==', true);
    if (genreId) {
      const genreDoc = await db.collection('genres').doc(genreId).get();
      if (!genreDoc.exists) {
        throw new HttpsError('not-found', 'Genre not found');
      }
      const genre = { id: genreDoc.id, ...genreDoc.data() } as any;
      const result = await fetchAndStoreGenre(genre, authToken);
      
      await logRef.update({
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: result.errors.length === 0 ? 'completed' : 'failed',
        genresProcessed: [genre.name],
        errors: result.errors,
      });
      
      return { success: result.success, processed: [genre.name], errors: result.errors };
    }
    
    const genresSnapshot = await query.get();
    const allErrors: string[] = [];
    const processedGenres: string[] = [];
    
    for (const doc of genresSnapshot.docs) {
      const genre = { id: doc.id, ...doc.data() } as any;
      try {
        const result = await fetchAndStoreGenre(genre, authToken);
        processedGenres.push(genre.name);
        allErrors.push(...result.errors);
      } catch (error) {
        allErrors.push(`Failed: ${genre.name}: ${error}`);
      }
    }
    
    await logRef.update({
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: allErrors.length === 0 ? 'completed' : 'failed',
      genresProcessed: processedGenres,
      errors: allErrors,
    });
    
    return { success: allErrors.length === 0, processed: processedGenres, errors: allErrors };
  }
);
