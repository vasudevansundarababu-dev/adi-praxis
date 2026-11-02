import { describe, expect, it } from 'vitest';
import { CorrectionsRequest, ProfileData } from '@praxis/shared';
import { applyCorrections } from '../src/candidate/profile-service';
const correction = (fields: unknown[]) => CorrectionsRequest.parse({ enrollmentId: '00000000-0000-4000-8000-000000000001', expectedRevision: 0, fields });

describe('manual profile correction privacy and clearing', () => {
  it.each(['account 123456789012', 'GB82 WEST 1234 5698 7654 32', 'ABCDE1234F', '1234 5678 9012'])('redacts sensitive identifiers in manual answers: %s', (secret) => {
    const original = ProfileData.parse({});
    const changed = applyCorrections(original, correction([{ fieldKey: 'summary', action: 'EDIT', value: `Worked with ${secret}` }]), new Set(['summary']));
    expect(JSON.stringify(changed)).not.toContain(secret);
    expect(changed.fields.summary?.value).toContain('[removed:');
    expect(changed.fields.summary?.status).toBe('PROPOSED');
    expect(original.fields).toEqual({});
  });

  it('explicit clearing removes the old confirmed answer', () => {
    const original = ProfileData.parse({ fields: { summary: { value: 'Old answer', status: 'CONFIRMED' } } });
    const changed = applyCorrections(original, correction([{ fieldKey: 'summary', action: 'CLEAR' }]), new Set(['summary']));
    expect(changed.fields.summary).toBeUndefined();
    expect(original.fields.summary?.value).toBe('Old answer');
  });
});
