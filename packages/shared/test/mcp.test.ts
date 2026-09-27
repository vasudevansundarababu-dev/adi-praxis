import { describe, expect, it } from 'vitest';
import { argumentProblems, canonicalArgs, KYC_EXAMPLE_TASK, KYC_MCP_TOOLS, KYC_TOOLS, kycChecks, replayBundle, replayCall, responseArguments, type KycTask } from '../src';

const clone = (): KycTask => structuredClone(KYC_EXAMPLE_TASK);
const failing = (t: KycTask) => kycChecks(t, null).filter((c) => !c.ok && c.severity !== 'warning').map((c) => c.id);

describe('KYC tools as MCP tools (TASK-DRAFTING section 5)', () => {
  it('every catalog tool has an MCP definition with an object inputSchema', () => {
    expect(KYC_MCP_TOOLS.map((t) => t.name).sort()).toEqual(KYC_TOOLS.map((t) => t.key).sort());
    for (const t of KYC_MCP_TOOLS) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(t.description.length).toBeGreaterThan(20);
    }
  });

  it('validates arguments against the inputSchema', () => {
    expect(argumentProblems('sanctions_pep_screening', { name: 'Soren Dunmore' })).toEqual([]);
    expect(argumentProblems('sanctions_pep_screening', {})).toEqual(['sanctions_pep_screening needs “name”']);
    expect(argumentProblems('sanctions_pep_screening', { name: 'A', passport: 'x' })[0]).toMatch(/no argument “passport”/);
    expect(argumentProblems('registry_lookup', { jurisdiction: 'GB' })[0]).toMatch(/needs one of/);
    expect(argumentProblems('registry_lookup', { companyName: 'Northwind Trading Ltd' })).toEqual([]);
    expect(argumentProblems('teleport', { a: 'b' })[0]).toMatch(/not in the MCP catalog/);
  });

  it('matches arguments regardless of key order and surrounding spaces', () => {
    expect(canonicalArgs({ b: ' 2 ', a: '1' })).toBe(canonicalArgs({ a: '1', b: '2', c: '' }));
  });

  it('tasks written before M9 (free-text input only) still load and pass every check', () => {
    const t = clone();
    for (const r of t.environment!.responses!) delete r.arguments;
    expect(failing(t)).toEqual([]);
    expect(responseArguments(t.environment!.responses![0]!)).toEqual({ companyNumber: 'SYN-889201' });
  });

  it('a recorded call with invalid arguments fails the W03 check', () => {
    const t = clone();
    t.environment!.responses![1]!.arguments = { dateOfBirth: '1964-11-02' };
    t.environment!.responses![1]!.input = '';
    expect(failing(t)).toContain('responses.arguments');
  });

  it('two recorded calls with the same tool and arguments fail, since replay could not tell them apart', () => {
    const t = clone();
    const r = t.environment!.responses!;
    r.push({ ...r[1]!, id: 'R9', response: 'Clear.' });
    expect(failing(t)).toContain('responses.unique');
  });

  it('a tool step whose arguments do not match its recorded call fails the W04 check', () => {
    const t = clone();
    const s = t.solution!.steps!.find((x) => x.responseId === 'R2')!;
    s.arguments = { name: 'Soren Dunmore', dateOfBirth: '1964-11-02' };
    expect(failing(t)).toEqual([]);
    s.arguments = { name: 'Someone Else' };
    expect(failing(t)).toContain('steps.arguments');
  });

  it('exports a replay bundle as MCP tools/call requests and results', () => {
    const b = replayBundle(clone());
    expect(b.catalogVersion).toBe('kyc-tools/1');
    expect(b.tools.map((t) => t.name)).toEqual(['document_check', 'registry_lookup', 'sanctions_pep_screening', 'risk_calculator', 'request_info']);
    expect(b.calls[1]).toEqual({
      id: 'R2',
      request: { method: 'tools/call', params: { name: 'sanctions_pep_screening', arguments: { name: 'Soren Dunmore', dateOfBirth: '1964-11-02' } } },
      result: { content: [{ type: 'text', text: expect.stringContaining('Near match') }], isError: false },
      kind: 'NEAR_MATCH',
    });
  });

  it('replays every recorded call and errors on unrecorded arguments or tools', () => {
    const b = replayBundle(clone());
    for (const c of b.calls) expect(replayCall(b, c.request.params.name, c.request.params.arguments)).toEqual(c.result);
    expect(replayCall(b, 'sanctions_pep_screening', { dateOfBirth: '1964-11-02', name: ' Soren Dunmore ' }).isError).toBe(false);
    expect(replayCall(b, 'sanctions_pep_screening', { name: 'Nobody' })).toEqual({ content: [{ type: 'text', text: 'No recorded response for these arguments.' }], isError: true });
    expect(replayCall(b, 'adverse_media_search', { name: 'Soren Dunmore' }).isError).toBe(true);
  });
});
