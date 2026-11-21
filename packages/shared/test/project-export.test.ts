import { describe, expect, it } from 'vitest';
import { anvilRunDto, AnvilRunDto, exportEligibility, MAX_VALIDATE_TASKS, ValidateRequest, ValidationRunDto } from '../src';

/** Owner, 12 Nov 2026: validate needs one approved task; export needs the project complete or its end date reached. */
const base = { status: 'IN_PROGRESS', approvedTasks: 3, distinctTarget: 10, endDate: '2026-12-31', today: '2026-11-12' };

describe('project export eligibility', () => {
  it('needs at least one approved task', () => {
    expect(exportEligibility({ ...base, approvedTasks: 0 })).toEqual({ canValidate: false, canExport: false, reason: 'Export needs at least one approved task.' });
  });
  it('validate any time; export waits for completion', () => {
    const r = exportEligibility(base);
    expect(r).toMatchObject({ canValidate: true, canExport: false });
    expect(r.reason).toBe('Export opens when the project is complete: 3 of 10 required tasks approved, or on 2026-12-31. You can validate one task now.');
  });
  it('export opens when the required tasks are approved, the project is complete, or the end date has come', () => {
    expect(exportEligibility({ ...base, approvedTasks: 10 }).canExport).toBe(true);
    expect(exportEligibility({ ...base, status: 'COMPLETED' }).canExport).toBe(true);
    expect(exportEligibility({ ...base, today: '2026-12-31' }).canExport).toBe(true);
  });
  it('drafts and cancelled projects cannot export', () => {
    expect(exportEligibility({ ...base, status: 'DRAFT' }).canValidate).toBe(false);
    expect(exportEligibility({ ...base, status: 'CANCELLED', approvedTasks: 10 }).canExport).toBe(false);
  });
});

describe('project export eligibility in the new flow (owner, 15 Nov 2026: all tasks approved)', () => {
  const nf = (approved: number, total = 5, over: Partial<typeof base> = {}) => exportEligibility({ ...base, approvedTasks: approved, ...over, allTasks: { totalTasks: total, approvedTasks: approved } });
  it('export stays closed until every task is approved, with the count in the reason; validate opens with one', () => {
    expect(nf(1)).toEqual({ canValidate: true, canExport: false, reason: 'Export opens when all 5 tasks are approved (1 of 5 now).' });
    expect(nf(0)).toEqual({ canValidate: false, canExport: false, reason: 'Export opens when all 5 tasks are approved (0 of 5 now).' });
    expect(nf(4).canExport).toBe(false);
    expect(nf(5)).toEqual({ canValidate: true, canExport: true, reason: null });
    expect(nf(0, 1).reason).toBe('Export opens when the task is approved (0 of 1 now).');
  });
  it('marked complete, the end date or the distinct target no longer open export', () => {
    expect(nf(2, 5, { status: 'COMPLETED' }).canExport).toBe(false);
    expect(nf(2, 5, { today: '2027-01-01' }).canExport).toBe(false);
    expect(nf(2, 5, { distinctTarget: 2 }).canExport).toBe(false);
  });
  it('a project without tasks never exports; drafts and cancelled projects still cannot', () => {
    expect(nf(0, 0)).toEqual({ canValidate: false, canExport: false, reason: 'Export opens when the project has tasks and all of them are approved.' });
    expect(nf(5, 5, { status: 'DRAFT' }).canExport).toBe(false);
    expect(nf(5, 5, { status: 'CANCELLED' }).canExport).toBe(false);
  });
});

describe('ValidateRequest (multi-select, 21 Nov 2026)', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  it('takes one or many approved records, each once, not none and not more than the cap', () => {
    expect(ValidateRequest.safeParse({ recordIds: [id(1)] }).success).toBe(true);
    expect(ValidateRequest.safeParse({ recordIds: [id(1), id(2), id(3), id(4)] }).success).toBe(true);
    expect(ValidateRequest.safeParse({ recordIds: [] }).success).toBe(false);
    expect(ValidateRequest.safeParse({ recordIds: [id(1), id(1)] }).success).toBe(false);
    expect(ValidateRequest.safeParse({ recordIds: Array.from({ length: MAX_VALIDATE_TASKS + 1 }, (_, i) => id(i + 1)) }).success).toBe(false);
  });
});

describe('RL Gym block of a run (owner, 21 Nov 2026)', () => {
  const stored = {
    contract: 'praxis.authored-task-export.v1',
    support: 'enabled',
    batchId: 'b-1',
    parts: [
      {
        partIndex: 1,
        partCount: 1,
        packageId: 'pkg-1',
        packageSha256: 'a'.repeat(64),
        zipSha256: 'b'.repeat(64),
        bytes: 1234,
        recordIds: ['r1', 'r2'],
        zipKey: 'exports/c/p/x-anvil-p1.zip',
        validate: { kind: 'business', httpStatus: 409, status: 'validation_blocked', valid: null, errorCount: 0, requestId: 'req-1', anvilPackageSha256: null, token: 'secret' },
        resolve: { kind: 'business', httpStatus: 200, status: 'import_resolved', idempotencyKey: 'praxis-aaa', requestId: 'rs-1' },
      },
    ],
    problems: [],
  };

  it('keeps RL Gym’s status and request ids; drops storage keys, idempotency keys and anything else', () => {
    const dto = anvilRunDto(stored)!;
    expect(AnvilRunDto.parse(dto)).toEqual(dto);
    expect(dto.parts[0]).toEqual({ partIndex: 1, partCount: 1, packageId: 'pkg-1', packageSha256: 'a'.repeat(64), zipSha256: 'b'.repeat(64), bytes: 1234, recordIds: ['r1', 'r2'], validate: { kind: 'business', httpStatus: 409, status: 'validation_blocked', valid: null, errorCount: 0, requestId: 'req-1', anvilPackageSha256: null }, resolve: { kind: 'business', httpStatus: 200, status: 'import_resolved', requestId: 'rs-1' } });
    const json = JSON.stringify(dto);
    for (const leak of ['zipKey', 'exports/', 'idempotencyKey', 'praxis-aaa', 'token', 'secret']) expect(json).not.toContain(leak);
  });

  it('a validate run has no resolve; nothing stored or an unreadable record gives null', () => {
    const { resolve: _r, ...part } = stored.parts[0]!;
    expect(anvilRunDto({ ...stored, parts: [part] })!.parts[0]!.resolve).toBeNull();
    expect(anvilRunDto(null)).toBeNull();
    expect(anvilRunDto({ support: 'sideways' })).toBeNull();
  });

  it('is part of ValidationRunDto (nullable)', () => {
    const run = { id: '00000000-0000-4000-8000-000000000001', projectId: '00000000-0000-4000-8000-000000000002', kind: 'VALIDATE', validator: 'anvil', validatorVersion: 'v1', results: [], counts: { valid: 0, needsFix: 0, notValidated: 0 }, requestedById: '00000000-0000-4000-8000-000000000003', createdAt: '2026-11-21T00:00:00.000Z', downloadPath: null };
    expect(ValidationRunDto.safeParse({ ...run, anvil: null }).success).toBe(true);
    expect(ValidationRunDto.safeParse({ ...run, anvil: anvilRunDto(stored) }).success).toBe(true);
    expect(ValidationRunDto.safeParse(run).success).toBe(false);
  });
});
