import { describe, it, expect } from 'vitest';
import { weeklyScheduledRunDocId } from './weeklyRunId';

describe('weeklyScheduledRunDocId', () => {
  it('returns weekly-YYYY-MM-DD', () => {
    const id = weeklyScheduledRunDocId(new Date('2026-05-04T12:00:00Z'));
    expect(id).toMatch(/^weekly-\d{4}-\d{2}-\d{2}$/);
  });
});
