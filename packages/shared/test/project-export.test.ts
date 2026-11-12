import { describe, expect, it } from 'vitest';
import { exportEligibility } from '../src';

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
