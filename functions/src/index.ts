import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { sensorTowerAuthToken } from './sensorTower/client';
import { fetchAndStoreGenre, fetchAndStoreMonth, getGenreMonths, getGenreWeeks, fetchAndStoreWeek } from './sensorTower/fetchTopApps';
import { createSavedView, inviteToSavedView } from './api/savedViews';
import { runAllGenreInsights, runInsightsPipeline } from './insights/pipeline';
import { rebuildGenreAggregate, deleteGenreAggregates } from './aggregates/genreAggregate';
import { appbirdApiKey } from './appbird/client';

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
    secrets: [sensorTowerAuthToken, appbirdApiKey],
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
        case 'genres/list': {
          const snap = await db.collection('genres').get();
          const genres = snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              name: typeof data.name === 'string' ? data.name : d.id,
              active: data.active === true,
              enableCreatives: data.enableCreatives === true,
              marketPulse: data.marketPulse === true,
              categoryIds: data.categoryIds ?? null,
              country: typeof data.country === 'string' ? data.country : null,
            };
          });
          return sendSuccess(res, { genres });
        }

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
          if (updates.enableCreatives !== undefined) allowed.enableCreatives = updates.enableCreatives;
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

          // Delete the aggregate read-model docs
          await deleteGenreAggregates(id, db);

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
          if (result.success) {
            try {
              await rebuildGenreAggregate(genre, 'month', db);
            } catch (err) {
              console.error('Aggregate (month) rebuild failed:', err);
            }
          }
          sendSuccess(res, result);
          // Fire-and-forget: generate insights after fetch
          runInsightsPipeline({ id: fetchGenreId, name: genre.name }, 'month')
            .catch(err => console.error('Post-fetch insight generation failed:', err));
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
          if (weekResult.success) {
            try {
              await rebuildGenreAggregate(weekGenre, 'week', db);
            } catch (err) {
              console.error('Aggregate (week) rebuild failed:', err);
            }
          }
          sendSuccess(res, weekResult);
          // Fire-and-forget: generate insights after fetch
          runInsightsPipeline({ id: weekGenreId, name: weekGenre.name }, 'week')
            .catch(err => console.error('Post-fetch insight generation failed:', err));
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

        case 'aggregates/rebuild': {
          // One-time backfill / repair for the dashboard read-models. Rebuilds
          // the genreAggregates docs from existing snapshots (no Sensor Tower
          // calls). Defaults to the `week` granularity, which is the one the
          // routine month fetch never used to maintain and is therefore the one
          // most likely missing. Pass { granularity: 'month' | 'week' | 'both' }
          // and optionally { genreIds: [...] } to scope it.
          const { genreIds: rebuildGenreIds, granularity: rebuildGranularity } = req.body || {};
          const grans: ('month' | 'week')[] =
            rebuildGranularity === 'both'
              ? ['month', 'week']
              : rebuildGranularity === 'month'
                ? ['month']
                : ['week'];

          let rebuildDocs: { id: string; [key: string]: any }[] = [];
          if (rebuildGenreIds && Array.isArray(rebuildGenreIds) && rebuildGenreIds.length > 0) {
            for (const gid of rebuildGenreIds) {
              const gDoc = await db.collection('genres').doc(gid).get();
              if (gDoc.exists) rebuildDocs.push({ id: gDoc.id, ...gDoc.data() } as any);
            }
          } else {
            const genresSnapshot = await db.collection('genres').get();
            rebuildDocs = genresSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
          }

          const rebuildErrors: string[] = [];
          const rebuilt: { genre: string; granularity: string; appCount: number; months: number }[] = [];
          for (const genre of rebuildDocs) {
            for (const gran of grans) {
              try {
                const r = await rebuildGenreAggregate(genre as any, gran, db);
                rebuilt.push({ genre: genre.name ?? genre.id, granularity: gran, appCount: r.appCount, months: r.months.length });
              } catch (err) {
                rebuildErrors.push(`${genre.name ?? genre.id} (${gran}): ${err}`);
              }
            }
          }
          sendSuccess(res, { success: rebuildErrors.length === 0, rebuilt, errors: rebuildErrors });
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

          await deleteGenreAggregates(deleteGenreId, db);

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

        case 'savedViews/create': {
          const user = await getAuthUser(req);
          if (!user) {
            sendError(res, 401, 'Unauthorized');
            return;
          }
          const result = await createSavedView(db, user, req.body || {});
          if ('error' in result) {
            sendError(res, result.status, result.error);
            return;
          }
          sendSuccess(res, { id: result.id });
          return;
        }

        case 'savedViews/invite': {
          const user = await getAuthUser(req);
          if (!user) {
            sendError(res, 401, 'Unauthorized');
            return;
          }
          const inv = await inviteToSavedView(db, user, req.body || {});
          if ('error' in inv) {
            sendError(res, inv.status, inv.error);
            return;
          }
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

        case 'apps/search': {
          const { term } = req.body || {};
          if (!term || typeof term !== 'string' || term.trim().length < 2) {
            sendError(res, 400, 'term (string, min 2 chars) is required');
            return;
          }
          const { searchUnifiedApps } = await import('./sensorTower/client');
          const apps = await searchUnifiedApps(term.trim(), sensorTowerAuthToken.value().trim(), 10);
          sendSuccess(res, { apps });
          return;
        }

        case 'apps/competitors': {
          const { category, country, excludeAppId, limit } = req.body || {};
          if (!category || typeof category !== 'string') {
            sendError(res, 400, 'category (string) is required');
            return;
          }
          const { fetchCompetitorsForCategory } = await import('./sensorTower/competitors');
          const competitors = await fetchCompetitorsForCategory({
            authToken: sensorTowerAuthToken.value().trim(),
            category,
            country: typeof country === 'string' ? country : undefined,
            excludeAppId: typeof excludeAppId === 'string' ? excludeAppId : undefined,
            limit: typeof limit === 'number' ? limit : undefined,
          });
          sendSuccess(res, { competitors });
          return;
        }

        case 'games/discover-competitors': {
          const { appId, name, publisherName, iosAppId, androidAppId, country } = req.body || {};
          if (!appId || typeof appId !== 'string' || !name || typeof name !== 'string') {
            return sendError(res, 400, 'appId and name (strings) are required');
          }
          const { discoverCompetitors } = await import('./gameWorkspaces/discovery');
          const competitors = await discoverCompetitors({
            focusAppId: appId,
            name,
            publisherName: typeof publisherName === 'string' ? publisherName : '',
            iosAppId: typeof iosAppId === 'string' ? iosAppId : null,
            androidAppId: typeof androidAppId === 'string' ? androidAppId : null,
            country: typeof country === 'string' && country ? country : 'US',
            authToken: sensorTowerAuthToken.value().trim(),
          });
          return sendSuccess(res, { competitors });
        }

        case 'games/fetch-app': {
          const { appId, weekStart, weekEnd, country, force, name, publisherName, iconUrl } = req.body || {};
          if (!appId || typeof appId !== 'string' || !weekStart || !weekEnd) {
            return sendError(res, 400, 'appId, weekStart, and weekEnd are required');
          }
          const { fetchAppCreativesForWeek } = await import('./gameWorkspaces/fetchAppWeek');
          const result = await fetchAppCreativesForWeek({
            appId,
            country: typeof country === 'string' && country ? country : 'US',
            weekStart,
            weekEnd,
            authToken: sensorTowerAuthToken.value().trim(),
            force: force === true,
            ...(typeof name === 'string' && name
              ? {
                  appMeta: {
                    name,
                    publisherName: typeof publisherName === 'string' ? publisherName : null,
                    iconUrl: typeof iconUrl === 'string' ? iconUrl : null,
                  },
                }
              : {}),
          });
          return sendSuccess(res, result);
        }

        case 'games/analyze': {
          const { focusAppId, focusName, appIds, week } = req.body || {};
          if (
            !focusAppId ||
            typeof focusAppId !== 'string' ||
            !week ||
            typeof week !== 'string' ||
            !Array.isArray(appIds) ||
            appIds.length === 0
          ) {
            return sendError(res, 400, 'focusAppId, week, and a non-empty appIds array are required');
          }
          const { analyzeGameWorkspace } = await import('./gameWorkspaces/analyze');
          const result = await analyzeGameWorkspace({
            focusAppId,
            focusName: typeof focusName === 'string' && focusName ? focusName : focusAppId,
            appIds: appIds.filter((a: unknown): a is string => typeof a === 'string' && a.length > 0),
            week,
          });
          return sendSuccess(res, result);
        }

        case 'creatives/analyze-video': {
          const { scopeId, week, creativeId } = req.body || {};
          if (
            !scopeId ||
            typeof scopeId !== 'string' ||
            !week ||
            typeof week !== 'string' ||
            !creativeId ||
            typeof creativeId !== 'string'
          ) {
            return sendError(res, 400, 'scopeId, week, and creativeId are required');
          }
          const { analyzeSingleCreativeVideo } = await import('./gameWorkspaces/analyzeVideo');
          const result = await analyzeSingleCreativeVideo({ scopeId, week, creativeId });
          return sendSuccess(res, result);
        }

        case 'creatives/generate-concepts': {
          const { scopeId, week, focusAppId, focusGameName, gaps, rising, count } = req.body || {};
          if (
            !scopeId ||
            typeof scopeId !== 'string' ||
            !week ||
            typeof week !== 'string' ||
            !focusAppId ||
            typeof focusAppId !== 'string' ||
            !focusGameName ||
            typeof focusGameName !== 'string'
          ) {
            return sendError(res, 400, 'scopeId, week, focusAppId, and focusGameName are required');
          }
          const asStrings = (v: unknown): string[] | undefined =>
            Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length > 0) : undefined;
          const countNum = typeof count === 'number' && count >= 1 && count <= 10 ? Math.round(count) : undefined;
          const { generateWorkspaceConcepts } = await import('./gameWorkspaces/generateConcepts');
          const result = await generateWorkspaceConcepts({
            scopeId,
            week,
            focusAppId,
            focusGameName,
            gaps: asStrings(gaps),
            rising: asStrings(rising),
            count: countNum,
          });
          return sendSuccess(res, result);
        }

        case 'games/market-opportunity': {
          const { focusAppId, apps, category, androidCategory, primaryCountry } = req.body || {};
          if (
            !focusAppId ||
            typeof focusAppId !== 'string' ||
            !category ||
            typeof category !== 'string' ||
            !Array.isArray(apps) ||
            apps.length === 0
          ) {
            return sendError(res, 400, 'focusAppId, category, and a non-empty apps array are required');
          }
          const marketApps = (apps as unknown[])
            .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
            .map((a) => ({
              appId: String(a.appId ?? ''),
              iosAppId: typeof a.iosAppId === 'string' ? a.iosAppId : null,
              androidAppId: typeof a.androidAppId === 'string' ? a.androidAppId : null,
              isFocus: a.isFocus === true,
            }))
            .filter((a) => a.appId.length > 0);
          if (marketApps.length === 0) {
            return sendError(res, 400, 'apps must contain at least one app with an appId');
          }
          const { fetchMarketPresence } = await import('./gameWorkspaces/marketPresence');
          const presence = await fetchMarketPresence({
            focusAppId,
            apps: marketApps,
            category,
            androidCategory: typeof androidCategory === 'string' && androidCategory ? androidCategory : null,
            primaryCountry: typeof primaryCountry === 'string' && primaryCountry ? primaryCountry : 'US',
            authToken: sensorTowerAuthToken.value().trim(),
          });
          return sendSuccess(res, presence);
        }

        case 'marketPulse/run': {
          const { weekStart, weekEnd, skipFetch } = req.body || {};
          if (!weekStart || typeof weekStart !== 'string' || !weekEnd || typeof weekEnd !== 'string') {
            return sendError(res, 400, 'weekStart and weekEnd are required');
          }
          const { runMarketPulse } = await import('./marketPulse/runPulse');
          const result = await runMarketPulse({
            authToken: sensorTowerAuthToken.value().trim(),
            weekStart,
            weekEnd,
            skipFetch: skipFetch === true,
          });
          return sendSuccess(res, result);
        }

        case 'creatives/trigger': {
          const { genreId, weekStart, weekEnd } = req.body || {};
          if (!genreId || !weekStart || !weekEnd) {
            return sendError(res, 400, 'genreId, weekStart, and weekEnd are required');
          }
          const creativesAuthToken = sensorTowerAuthToken.value().trim();
          const gDoc = await db.collection('genres').doc(genreId).get();
          if (!gDoc.exists) {
            return sendError(res, 404, 'Genre not found');
          }
          const genre = { id: gDoc.id, ...gDoc.data() } as any;
          const { runCreativePipelineForGenre } = await import('./creativeInsights/runForGenre');
          const result = await runCreativePipelineForGenre(genre, weekStart, weekEnd, creativesAuthToken);
          return sendSuccess(res, result);
        }

        case 'creatives/fetch-app': {
          const { appId, genreId, weekStart, weekEnd } = req.body || {};
          if (!appId || !genreId || !weekStart || !weekEnd) {
            return sendError(res, 400, 'appId, genreId, weekStart, and weekEnd are required');
          }
          const fetchAppAuthToken = sensorTowerAuthToken.value().trim();
          const gDoc = await db.collection('genres').doc(genreId).get();
          if (!gDoc.exists) {
            return sendError(res, 404, 'Genre not found');
          }
          const genre = { id: gDoc.id, ...gDoc.data() } as any;
          const [{ fetchCreativesForSingleApp, weekKeyFromStart }, { scoreCreativesForGenre }] =
            await Promise.all([
              import('./adIntel/fetchCreativesForGenre'),
              import('./creativeInsights/scoringPipeline'),
            ]);
          const result = await fetchCreativesForSingleApp(genre, appId, weekStart, weekEnd, fetchAppAuthToken);
          // Re-run the (cheap, statistical) scoring pass so the new creatives
          // get scores immediately. Gemini insights stay as-is until the next
          // re-analyze / weekly run.
          let scored = 0;
          try {
            const scoreResult = await scoreCreativesForGenre(genreId, weekKeyFromStart(weekStart));
            scored = scoreResult.scored;
          } catch (err) {
            result.partialErrors.push(`score: ${err instanceof Error ? err.message : String(err)}`);
          }
          return sendSuccess(res, { ...result, scoredCount: scored });
        }

        case 'creatives/watchlist': {
          const ref = db.collection('watchlist').doc('team');
          const snap = await ref.get();
          const appIds: string[] = (snap.exists && Array.isArray((snap.data() as any)?.appIds))
            ? (snap.data() as any).appIds
            : [];
          return sendSuccess(res, { appIds });
        }

        case 'creatives/watchlist/add': {
          const { appId } = req.body || {};
          if (!appId || typeof appId !== 'string') {
            return sendError(res, 400, 'appId (string) is required');
          }
          const ref = db.collection('watchlist').doc('team');
          await ref.set(
            { appIds: admin.firestore.FieldValue.arrayUnion(appId), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true },
          );
          return sendSuccess(res, { success: true });
        }

        case 'creatives/watchlist/remove': {
          const { appId } = req.body || {};
          if (!appId || typeof appId !== 'string') {
            return sendError(res, 400, 'appId (string) is required');
          }
          const ref = db.collection('watchlist').doc('team');
          await ref.set(
            { appIds: admin.firestore.FieldValue.arrayRemove(appId), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true },
          );
          return sendSuccess(res, { success: true });
        }

        case 'ownershipTransfers/run': {
          // Populate/refresh the ownership-transfers feed from AppBird. Fans out
          // over the tracked publisher developer ids, unions + dedupes their
          // transfers, and upserts them into the `ownershipTransfers` collection
          // (clients read that collection directly). Idempotent.
          const { runOwnershipTransfers } = await import('./appbird/fetchTransfers');
          const result = await runOwnershipTransfers(db, appbirdApiKey.value().trim());
          return sendSuccess(res, result);
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

export { weeklyFetchApps, weeklyFetchCreatives, weeklyFetchCreativesFallback, weeklyMarketPulse } from './scheduled/weeklyFetch';
export { weeklyOwnershipTransfers } from './scheduled/weeklyTransfers';
