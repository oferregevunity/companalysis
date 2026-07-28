import { describe, it, expect } from 'vitest';
import { buildConceptInput, appIdFromCreativeId, type WorkspaceConceptContext } from './fromWorkspace';
import type { VideoAnalysis } from '../creativeInsights/videoAnalysis';

function va(creativeId: string, over: Partial<VideoAnalysis> = {}): VideoAnalysis {
  return {
    creativeId,
    hookType: 'Fail & Frustration',
    motivations: ['Challenge'],
    hookMechanic: 'King trapped as gold floods in',
    segments: [],
    cta: null,
    predictedHookStrength: 4,
    predictedHoldStrength: 3,
    iterationIdeas: [],
    themes: [],
    ...over,
  };
}

const ctx: WorkspaceConceptContext = {
  focusAppId: 'focus',
  focusGameName: 'Screw Guru',
  videoAnalyses: [
    va('comp1__k1', { motivations: ['Challenge'], hookType: 'Fail & Frustration' }),
    va('comp2__k2', { motivations: ['Satisfaction' as never] }),
    va('focus__own', { motivations: ['Achievement'], hookType: 'Satisfying / ASMR' }),
  ],
  creativeTags: [
    { creativeId: 'focus__own', hookType: 'Satisfying / ASMR' },
    { creativeId: 'comp1__k1', hookType: 'Fail & Frustration' },
  ],
  winners: [{ creativeId: 'comp1__k1', explanation: 'high tension open' }],
  appNameById: new Map([
    ['comp1', 'Screw Jam'],
    ['comp2', 'Bolt Master'],
  ]),
  gaps: ['Before & After', ''],
  rising: ['home renovation'],
  count: 4,
};

describe('appIdFromCreativeId', () => {
  it('takes everything before the first __', () => {
    expect(appIdFromCreativeId('com.foo.bar__abc__def')).toBe('com.foo.bar');
    expect(appIdFromCreativeId('noDelimiter')).toBe('noDelimiter');
  });
});

describe('buildConceptInput', () => {
  const out = buildConceptInput(ctx);

  it('uses only competitor videos as sources (excludes the focus game)', () => {
    expect(out.sources.map(s => s.creativeId)).toEqual(['comp1__k1', 'comp2__k2']);
    expect(out.sources.some(s => s.creativeId.startsWith('focus__'))).toBe(false);
  });

  it('resolves app names and attaches the winner explanation as whatWorks', () => {
    expect(out.sources[0]).toMatchObject({ appName: 'Screw Jam', whatWorks: 'high tension open' });
    expect(out.sources[1]).toMatchObject({ appName: 'Bolt Master', whatWorks: null });
  });

  it('derives focusRuns from the focus game\'s own tags + video motivations', () => {
    expect(out.focusRuns).toContain('Satisfying / ASMR'); // focus tag hook
    expect(out.focusRuns).toContain('Achievement'); // focus video motivation
    expect(out.focusRuns).not.toContain('Fail & Frustration'); // competitor-only
  });

  it('passes gaps/rising/count through, dropping empty gap strings', () => {
    expect(out.gaps).toEqual(['Before & After']);
    expect(out.rising).toEqual(['home renovation']);
    expect(out.count).toBe(4);
  });
});
