import { describe, expect, it } from 'vitest';
import { AnvilReadinessBadge, type AnvilReadiness } from '../components/templates/anvil-readiness';
import { html, text } from './helpers';

const base: AnvilReadiness = { versionHash: 'a'.repeat(64), proposedByAnvil: true, qualification: 'none', receiptId: null, qualifiedAt: null, anvilReady: false, requirementId: 'REQ-2026-041', channel: 'enterprise-banking' };

describe('Anvil readiness badge (Praxis-Anvil contract)', () => {
  it('says not yet qualified, and where the proposal came from', () => {
    expect(text(html(<AnvilReadinessBadge r={base} />))).toBe('Not yet qualified by Anvil for benchmarks · proposed by Anvil for requirement REQ-2026-041 (enterprise-banking)');
  });
  it('qualified and published: Anvil-ready with the receipt', () => {
    expect(text(html(<AnvilReadinessBadge r={{ ...base, qualification: 'qualified', anvilReady: true, receiptId: 'RCPT-1' }} />))).toContain('Anvil-ready for benchmarks (receipt RCPT-1)');
  });
  it('revoked is never shown as ready', () => {
    expect(text(html(<AnvilReadinessBadge r={{ ...base, qualification: 'revoked' }} />))).toContain('revoked its qualification');
  });
});
