import { describe, it, expect } from 'vitest';
import { buildConceptPrompt, parseConceptResponse, type ConceptGenInput } from './geminiClient';

const input: ConceptGenInput = {
  focusGameName: 'Screw Guru',
  focusRuns: ['Satisfying / ASMR'],
  sources: [
    { creativeId: 'a__1', appName: 'Screw Jam', hookType: 'Fail & Frustration', motivations: ['Challenge'], hookMechanic: 'King trapped as gold floods in', whatWorks: 'high tension open' },
  ],
  gaps: ['Before & After'],
  rising: ['home renovation'],
  count: 4,
};

describe('buildConceptPrompt', () => {
  it('frames the ideation tiers, brief fields, and grounds in sources/gaps/rising', () => {
    const p = buildConceptPrompt(input);
    expect(p).toContain('IDEATION STRATEGY');
    for (const tier of ['Direct Copy', 'Iteration', 'Strategic', 'Experimental']) expect(p).toContain(tier);
    expect(p).toContain('a__1'); // source cited
    expect(p).toContain('Satisfying / ASMR'); // focusRuns steer
    expect(p).toContain('Before & After'); // gaps
    expect(p).toContain('home renovation'); // rising
    expect(p).toContain('references');
    expect(p).toContain('Generate 4 concepts');
  });
});

describe('parseConceptResponse', () => {
  const raw = JSON.stringify({
    concepts: [
      { title: 'Trapped King Redux', tier: 'direct copy', motivation: 'Challenge', hook: 'King floods with gold', visualStyle: 'gameplay', structure: 'intro->play->cta', lengthSec: 20, references: ['a__1'], rationale: 'proven tension open' },
      { title: 'Reno Reveal', tier: 'Experimental', motivation: 'Design', hook: 'before/after', visualStyle: 'themed', structure: 's', lengthSec: '30', references: [], rationale: 'rising theme' },
      { title: '', tier: 'Iteration' }, // dropped (no title)
      { title: 'Weird Tier', tier: 'Nonsense', motivation: 'X', hook: 'h', visualStyle: 'v', structure: 's', rationale: 'r' },
    ],
  });

  it('parses concepts, coerces tiers, and drops titleless entries', () => {
    const out = parseConceptResponse(raw);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ title: 'Trapped King Redux', tier: 'Direct Copy', lengthSec: 20, references: ['a__1'] });
    expect(out[1]).toMatchObject({ tier: 'Experimental', lengthSec: 30 }); // string length coerced
    expect(out[2].tier).toBe('Iteration'); // unknown tier -> default
  });

  it('strips markdown fences', () => {
    const out = parseConceptResponse('```json\n' + raw + '\n```');
    expect(out[0].title).toBe('Trapped King Redux');
  });

  it('returns [] on malformed JSON', () => {
    expect(parseConceptResponse('nope')).toEqual([]);
  });
});
