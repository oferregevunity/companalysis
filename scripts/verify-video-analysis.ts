/**
 * One-off: verify the live per-video analysis path.
 *
 * Run from the functions/ dir so firebase-admin resolves, with ADC:
 *   cd functions && npx tsx ../scripts/verify-video-analysis.ts          # inspect only
 *   cd functions && RUN=1 npx tsx ../scripts/verify-video-analysis.ts    # trigger + verify
 *
 * Inspect mode: finds the best analyzed workspace and reports how many of its
 * apps' creatives are videos (so we know a re-analysis will have something to
 * video-analyze). RUN=1: POSTs games/analyze to the deployed endpoint, then
 * reads back the insight doc's videoAnalyses.
 */
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

admin.initializeApp();
const db = getFirestore('companalysis');
const ENDPOINT = 'https://companalysisapi-w5zosioqha-uc.a.run.app/games/analyze';

interface WorkspaceDoc {
  focusApp: { appId: string; name: string };
  selectedIds?: string[];
  competitors?: Array<{ appId: string }>;
  country?: string;
  lastAnalyzedWeek?: string | null;
}

async function countVideos(appIds: string[]): Promise<{ total: number; videos: number }> {
  let total = 0;
  let videos = 0;
  const IN = 30;
  for (let i = 0; i < appIds.length; i += IN) {
    const chunk = appIds.slice(i, i + IN);
    const snap = await db.collection('creativeLatest').where('appId', 'in', chunk).get();
    for (const d of snap.docs) {
      total += 1;
      const c = d.data() as { format?: string; mediaUrl?: string | null };
      if (c.format === 'video' && c.mediaUrl) videos += 1;
    }
  }
  return { total, videos };
}

async function main() {
  const snap = await db.collection('gameWorkspaces').get();
  const candidates: Array<{ id: string; ws: WorkspaceDoc; appIds: string[] }> = [];
  for (const d of snap.docs) {
    const ws = d.data() as WorkspaceDoc;
    const selected = ws.selectedIds ?? [];
    if (!ws.focusApp?.appId || selected.length === 0) continue;
    candidates.push({ id: d.id, ws, appIds: [ws.focusApp.appId, ...selected] });
  }
  console.log(`gameWorkspaces with a selected set: ${candidates.length}`);
  if (candidates.length === 0) return;

  // Rank by how many of the set's creatives are videos.
  const scored: Array<{ id: string; ws: WorkspaceDoc; appIds: string[]; videos: number; total: number }> = [];
  for (const c of candidates.slice(0, 12)) {
    const { total, videos } = await countVideos(c.appIds);
    scored.push({ ...c, total, videos });
    console.log(`  ${c.ws.focusApp.name} (${c.id}) — apps=${c.appIds.length} creatives=${total} videos=${videos} week=${c.ws.lastAnalyzedWeek ?? '?'}`);
  }
  scored.sort((a, b) => b.videos - a.videos);
  const best = scored[0];
  if (!best || best.videos === 0) {
    console.log('\nNo workspace has fetched video creatives — re-analyze one in the app first.');
    return;
  }
  console.log(`\nBest candidate: ${best.ws.focusApp.name} — ${best.videos} video creatives, week=${best.ws.lastAnalyzedWeek}`);

  if (process.env.RUN !== '1') {
    console.log('Inspect only. Re-run with RUN=1 to trigger + verify.');
    return;
  }

  const week = best.ws.lastAnalyzedWeek;
  if (!week) {
    console.log('Best candidate has no lastAnalyzedWeek; skipping trigger.');
    return;
  }

  // Call the pipeline in-process (the HTTP endpoint requires a Firebase user
  // token). Same code path the deployed function runs; needs GCLOUD_PROJECT +
  // ADC with Vertex access.
  console.log(`\nRunning analyzeGameWorkspace(${best.ws.focusApp.name}, ${week}) …`);
  const t0 = Date.now();
  const { analyzeGameWorkspace } = await import('../functions/src/gameWorkspaces/analyze');
  const result = await analyzeGameWorkspace({
    focusAppId: best.ws.focusApp.appId,
    focusName: best.ws.focusApp.name,
    appIds: best.appIds,
    week,
  });
  console.log(`analyze done in ${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(result));

  const docId = `game_${best.ws.focusApp.appId}_week_${week}`;
  const doc = await db.collection('creativeInsights').doc(docId).get();
  const data = doc.data() as { winners?: unknown[]; videoAnalyses?: Array<Record<string, unknown>> } | undefined;
  const vas = data?.videoAnalyses ?? [];
  console.log(`\ncreativeInsights/${docId}: winners=${(data?.winners ?? []).length} videoAnalyses=${vas.length}`);
  for (const va of vas.slice(0, 3)) {
    console.log(`  - ${va.creativeId}: hook=${va.hookType} motivations=${JSON.stringify(va.motivations)} hookStrength=${va.predictedHookStrength} segments=${(va.segments as unknown[] | undefined)?.length ?? 0}`);
    console.log(`    mechanic: ${String(va.hookMechanic ?? '').slice(0, 120)}`);
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
