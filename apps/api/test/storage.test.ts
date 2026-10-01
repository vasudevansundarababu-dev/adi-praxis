import { describe, expect, it, vi } from 'vitest';
import { GcsStorage } from '../src/candidate/storage';

describe('GcsStorage on buckets with uniform bucket-level access', () => {
  it('saves objects without per-object ACLs (GCS refuses legacy ACLs when uniform access is on)', async () => {
    const s = new GcsStorage('praxis-evidence', { projectId: 'praxis-test' });
    const save = vi.fn().mockResolvedValue(undefined);
    (s as unknown as { bucket: { file: () => { save: typeof save } } }).bucket = { file: () => ({ save }) };
    await s.put('guidelines/v1.pdf', Buffer.from('%PDF'), 'application/pdf');
    expect(save).toHaveBeenCalledTimes(1);
    const opts = save.mock.calls[0]![1] as Record<string, unknown>;
    expect(opts).toMatchObject({ contentType: 'application/pdf', resumable: false });
    for (const legacy of ['private', 'public', 'predefinedAcl']) expect(opts).not.toHaveProperty(legacy);
  });
});
