import { describe, it, expect } from 'vitest';
import {
  buildVideoAnalysisPrompt,
  parseVideoAnalysisResponse,
  MOTIVATIONS,
  ITERABLE_ELEMENTS,
} from './videoAnalysis';

describe('buildVideoAnalysisPrompt', () => {
  it('frames the Iteration Loop segments and lists the taxonomies', () => {
    const p = buildVideoAnalysisPrompt({
      creativeId: 'a__1',
      appName: 'Screw Master 3D',
      isFocusGame: true,
      videoDurationSec: 15,
      title: 'Only 1% can solve this',
    });
    expect(p).toContain('ATTENTION / HOOK');
    expect(p).toContain('CONTENT');
    expect(p).toContain('END');
    expect(p).toContain('FOCUS game');
    expect(p).toContain('~15s');
    expect(p).toContain('Only 1% can solve this');
    // taxonomies present
    expect(p).toContain(MOTIVATIONS[0]);
    expect(p).toContain(ITERABLE_ELEMENTS[0]);
  });

  it('handles missing duration and copy', () => {
    const p = buildVideoAnalysisPrompt({ creativeId: 'a__1', appName: 'X', isFocusGame: false, videoDurationSec: null });
    expect(p).toContain('unknown length');
    expect(p).not.toContain('(this is the FOCUS game');
  });
});

describe('parseVideoAnalysisResponse', () => {
  const valid = JSON.stringify({
    hookType: 'Challenge / Can You Beat',
    motivations: ['Challenge', 'Mastery', 'Achievement', 'Power'], // 4 -> capped to 3
    hookMechanic: 'A near-impossible screw puzzle flashes on screen.',
    segments: [
      { phase: 'attention', startSec: 0, endSec: 3, whatHappens: 'Puzzle teased.', notableElements: ['Opening/Hook', 'Captions', 'NotARealElement'] },
      { phase: 'content', startSec: 3, endSec: 12, whatHappens: 'Gameplay.', notableElements: ['Hand pointer'] },
      { phase: 'bogus', startSec: 0, endSec: 1, whatHappens: 'dropped', notableElements: [] },
    ],
    cta: 'Play Now',
    predictedHookStrength: 4,
    predictedHoldStrength: 7, // out of range -> null
    iterationIdeas: ['Try a fail-first open', 'Add a timer'],
    themes: ['home renovation', 'boss fight'],
  });

  it('parses a valid response and enforces the vocabularies', () => {
    const a = parseVideoAnalysisResponse(valid, 'a__1');
    expect(a).not.toBeNull();
    expect(a!.creativeId).toBe('a__1');
    expect(a!.hookType).toBe('Challenge / Can You Beat');
    expect(a!.motivations).toEqual(['Challenge', 'Mastery', 'Achievement']); // capped, de-duped, in-vocab
    expect(a!.cta).toBe('Play Now');
    expect(a!.predictedHookStrength).toBe(4);
    expect(a!.predictedHoldStrength).toBeNull(); // 7 clamped out
    // off-list element dropped, bogus-phase segment dropped
    expect(a!.segments).toHaveLength(2);
    expect(a!.segments[0].notableElements).toEqual(['Opening/Hook', 'Captions']);
  });

  it('coerces an unknown hook type to Other', () => {
    const a = parseVideoAnalysisResponse(JSON.stringify({ hookType: 'Made Up', motivations: [] }), 'x');
    expect(a!.hookType).toBe('Other');
  });

  it('treats a literal "null" cta string as null', () => {
    const a = parseVideoAnalysisResponse(JSON.stringify({ hookType: 'Other', cta: 'null' }), 'x');
    expect(a!.cta).toBeNull();
  });

  it('strips markdown fences', () => {
    const a = parseVideoAnalysisResponse('```json\n' + valid + '\n```', 'a__1');
    expect(a!.hookType).toBe('Challenge / Can You Beat');
  });

  it('returns null on malformed JSON', () => {
    expect(parseVideoAnalysisResponse('not json', 'x')).toBeNull();
  });
});
