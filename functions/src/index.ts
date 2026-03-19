import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { sensorTowerAuthToken } from './sensorTower/client';
import { fetchAndStoreGenre, fetchAndStoreMonth, getGenreMonths, getGenreWeeks, fetchAndStoreWeek } from './sensorTower/fetchTopApps';
import { runAllGenreInsights, runInsightsPipeline } from './insights/pipeline';

admin.initializeApp();

const db = getFirestore('companalysis');

const HOSTING_DOMAINS = ['.firebaseapp.com', '.web.app'];

function isHostingRequest(req: any): boolean {
  const forwardedHost = req.headers['x-forwarded-host'] || '';
  return HOSTING_DOMAINS.some((domain) => forwardedHost.includes(domain));
}

async function getAuthUser(req: any): Promise<admin.auth.DecodedIdToken | null> {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  try {
    const token = authHeader.split('Bearer ')[1];
    return await admin.auth().verifyIdToken(token);
  } catch {
    return null;
  }
}

function sendError(res: any, status: number, message: string) {
  res.status(status).json({ error: message });
}

function sendSuccess(res: any, data: any) {
  res.status(200).json(data);
}

export const compAnalysisApi = onRequest(
  {
    timeoutSeconds: 540,
    memory: '2GiB',
    secrets: [sensorTowerAuthToken],
    cors: true,
  },
  async (req, res) => {
    if (!isHostingRequest(req)) {
      const user = await getAuthUser(req);
      if (!user) {
        sendError(res, 401, 'Unauthorized');
        return;
      }
    }

    const path = req.path.replace(/^\/?api\//, '').replace(/^\/+/, '');

    try {
      switch (path) {
        case 'genres/add': {
          const { name, categoryIds, country, monthsBack } = req.body;
          if (!name || !categoryIds?.ios || !categoryIds?.android) {
            sendError(res, 400, 'Name and categoryIds (ios, android) are required');
            return;
          }
          const genreRef = db.collection('genres').doc();
          await genreRef.set({
            name,
            categoryIds,
            country: country || 'US',
            monthsBack: monthsBack || 6,
            active: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          sendSuccess(res, { id: genreRef.id, name });
          return;
        }

        case 'genres/update': {
          const { id, ...updates } = req.body;
          if (!id) {
            sendError(res, 400, 'Genre ID is required');
            return;
          }
          const genreRef = db.collection('genres').doc(id);
          const genreDoc = await genreRef.get();
          if (!genreDoc.exists) {
            sendError(res, 404, 'Genre not found');
            return;
          }
          const allowed: Record<string, any> = {};
          if (updates.name !== undefined) allowed.name = updates.name;
          if (updates.categoryIds !== undefined) allowed.categoryIds = updates.categoryIds;
          if (updates.country !== undefined) allowed.country = updates.country;
          if (updates.monthsBack !== undefined) allowed.monthsBack = updates.monthsBack;
          if (updates.active !== undefined) allowed.active = updates.active;
          await genreRef.update(allowed);
          sendSuccess(res, { success: true });
          return;
        }

        case 'genres/delete': {
          const { id } = req.body;
          if (!id) {
            sendError(res, 400, 'Genre ID is required');
            return;
          }

          // Delete all snapshots + app subcollections for this genre
          const genreSnaps = await db.collection('snapshots')
            .where('genreId', '==', id).get();
          let snapsDeleted = 0;
          for (const snap of genreSnaps.docs) {
            const appsDocs = await snap.ref.collection('apps').listDocuments();
            const BATCH_SIZE = 400;
            for (let i = 0; i < appsDocs.length; i += BATCH_SIZE) {
              const batch = db.batch();
              appsDocs.slice(i, i + BATCH_SIZE).forEach(doc => batch.delete(doc));
              await batch.commit();
            }
            await snap.ref.delete();
            snapsDeleted++;
          }

          // Delete all comments for this genre
          const genreComments = await db.collection('appComments')
            .where('genreId', '==', id).get();
          if (!genreComments.empty) {
            const batch = db.batch();
            genreComments.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
          }

          // Delete the genre document itself
          await db.collection('genres').doc(id).delete();
          console.log(`Deleted genre ${id}: ${snapsDeleted} snapshots, ${genreComments.size} comments`);
          sendSuccess(res, { success: true, snapshotsDeleted: snapsDeleted });
          return;
        }

        case 'fetch/plan': {
          const { genreIds, refetch } = req.body || {};
          if (!genreIds || !Array.isArray(genreIds) || genreIds.length === 0) {
            sendError(res, 400, 'genreIds array is required');
            return;
          }
          const plan: { genreId: string; genreName: string; months: { month: string; startDate: string; endDate: string }[] }[] = [];
          for (const gid of genreIds) {
            const gDoc = await db.collection('genres').doc(gid).get();
            if (gDoc.exists) {
              const gData = gDoc.data() as any;
              const genre = { id: gDoc.id, ...gData };
              const allMonths = getGenreMonths(genre);

              const existingSnaps = await db.collection('snapshots')
                .where('genreId', '==', gid).get();
              const existingMonthKeys = new Set(
                existingSnaps.docs.filter(d => d.data().month != null).map(d => d.data().month as string)
              );

              const monthsToUse = refetch
                ? allMonths.filter(m => existingMonthKeys.has(m.month))
                : allMonths.filter(m => !existingMonthKeys.has(m.month));

              plan.push({
                genreId: gDoc.id,
                genreName: gData.name,
                months: monthsToUse,
              });
            }
          }
          sendSuccess(res, { plan });
          return;
        }

        case 'fetch/month': {
          const { genreId: fetchGenreId, month: fetchMonth, startDate: fetchStart, endDate: fetchEnd } = req.body;
          if (!fetchGenreId || !fetchMonth || !fetchStart || !fetchEnd) {
            sendError(res, 400, 'genreId, month, startDate, and endDate are required');
            return;
          }
          const authTokenMonth = sensorTowerAuthToken.value().trim();
          const gDoc = await db.collection('genres').doc(fetchGenreId).get();
          if (!gDoc.exists) {
            sendError(res, 404, 'Genre not found');
            return;
          }
          const genre = { id: gDoc.id, ...gDoc.data() } as any;
          const result = await fetchAndStoreMonth(
            genre,
            { month: fetchMonth, startDate: fetchStart, endDate: fetchEnd },
            authTokenMonth
          );
          sendSuccess(res, result);
          return;
        }

        case 'fetch/week-plan': {
          const { genreIds: weekGenreIds } = req.body || {};
          if (!weekGenreIds || !Array.isArray(weekGenreIds) || weekGenreIds.length === 0) {
            sendError(res, 400, 'genreIds array is required');
            return;
          }
          const weekPlan: { genreId: string; genreName: string; weeks: { week: string; startDate: string; endDate: string }[] }[] = [];
          for (const gid of weekGenreIds) {
            const gDoc = await db.collection('genres').doc(gid).get();
            if (gDoc.exists) {
              const gData = gDoc.data() as any;
              const genre = { id: gDoc.id, ...gData };
              const allWeeks = getGenreWeeks(genre);

              const existingSnaps = await db.collection('snapshots')
                .where('genreId', '==', gid)
                .where('granularity', '==', 'week').get();
              const existingWeeks = new Set(existingSnaps.docs.map(d => d.data().week as string));
              const missingWeeks = allWeeks.filter(w => !existingWeeks.has(w.week));

              weekPlan.push({
                genreId: gDoc.id,
                genreName: gData.name,
                weeks: missingWeeks,
              });
            }
          }
          sendSuccess(res, { plan: weekPlan });
          return;
        }

        case 'fetch/week': {
          const { genreId: weekGenreId, week: fetchWeek, startDate: weekStart, endDate: weekEnd } = req.body;
          if (!weekGenreId || !fetchWeek || !weekStart || !weekEnd) {
            sendError(res, 400, 'genreId, week, startDate, and endDate are required');
            return;
          }
          const weekAuthToken = sensorTowerAuthToken.value().trim();
          const weekDoc = await db.collection('genres').doc(weekGenreId).get();
          if (!weekDoc.exists) {
            sendError(res, 404, 'Genre not found');
            return;
          }
          const weekGenre = { id: weekDoc.id, ...weekDoc.data() } as any;
          const weekResult = await fetchAndStoreWeek(
            weekGenre,
            { week: fetchWeek, startDate: weekStart, endDate: weekEnd },
            weekAuthToken
          );
          sendSuccess(res, weekResult);
          return;
        }

        case 'fetch/trigger': {
          const { genreIds } = req.body || {};
          const authToken = sensorTowerAuthToken.value().trim();

          const logRef = db.collection('fetchLogs').doc();
          await logRef.set({
            startedAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'running',
            genresProcessed: [],
            errors: [],
          });

          let genreDocs: { id: string; [key: string]: any }[] = [];

          if (genreIds && Array.isArray(genreIds) && genreIds.length > 0) {
            for (const gid of genreIds) {
              const gDoc = await db.collection('genres').doc(gid).get();
              if (gDoc.exists) {
                genreDocs.push({ id: gDoc.id, ...gDoc.data() } as any);
              }
            }
          } else {
            const genresSnapshot = await db.collection('genres').where('active', '==', true).get();
            genreDocs = genresSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
          }

          const allErrors: string[] = [];
          const processedGenres: string[] = [];
          for (const genre of genreDocs) {
            try {
              const result = await fetchAndStoreGenre(genre as any, authToken);
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
          sendSuccess(res, { success: allErrors.length === 0, processed: processedGenres, errors: allErrors });
          return;
        }

        case 'analysis/delete': {
          const { genreId: deleteGenreId } = req.body;
          if (!deleteGenreId) {
            sendError(res, 400, 'genreId is required');
            return;
          }
          const snaps = await db.collection('snapshots')
            .where('genreId', '==', deleteGenreId).get();

          let deleted = 0;
          for (const snap of snaps.docs) {
            const appsDocs = await snap.ref.collection('apps').listDocuments();
            const BATCH_SIZE = 400;
            for (let i = 0; i < appsDocs.length; i += BATCH_SIZE) {
              const batch = db.batch();
              appsDocs.slice(i, i + BATCH_SIZE).forEach(doc => batch.delete(doc));
              await batch.commit();
            }
            await snap.ref.delete();
            deleted++;
          }

          const comments = await db.collection('appComments')
            .where('genreId', '==', deleteGenreId).get();
          if (!comments.empty) {
            const batch = db.batch();
            comments.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
          }

          sendSuccess(res, { success: true, snapshotsDeleted: deleted });
          return;
        }

        case 'comments/save': {
          const { appId, genreId: commentGenreId, comment } = req.body;
          if (!appId || !commentGenreId) {
            sendError(res, 400, 'appId and genreId are required');
            return;
          }
          const commentRef = db.collection('appComments').doc(`${commentGenreId}_${appId}`);
          await commentRef.set({
            appId,
            genreId: commentGenreId,
            comment: comment || '',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          sendSuccess(res, { success: true });
          return;
        }

        case 'insights/generate': {
          const granularity = (req.body?.granularity || 'month') as 'month' | 'week';
          const result = await runAllGenreInsights(granularity);
          return sendSuccess(res, result);
        }

        case 'insights/generate-genre': {
          const { genreId, genreName, granularity: gran } = req.body || {};
          if (!genreId || !genreName) {
            return sendError(res, 400, 'genreId and genreName are required');
          }
          const result = await runInsightsPipeline(
            { id: genreId, name: genreName },
            (gran || 'month') as 'month' | 'week'
          );
          return sendSuccess(res, {
            scored: result.scored,
            topApps: result.topApps.map(a => ({ appId: a.appId, appName: a.appName, score: a.score })),
          });
        }

        default:
          sendError(res, 404, `Unknown route: ${path}`);
      }
    } catch (error) {
      console.error(`Error handling ${path}:`, error);
      sendError(res, 500, error instanceof Error ? error.message : 'Internal error');
    }
  }
);

export { weeklyFetch } from './scheduled/weeklyFetch';
