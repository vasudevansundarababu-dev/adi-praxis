import { describe, expect, it } from 'vitest';
import { factRows } from '../src/policy/fact-table';

// The Policy page's fact list (owner, 26 Nov 2026): catalog facts, then derived facts, with how many rules' conditions use each.
const catalog = {
  schema_version: 'adi.utility.fact-catalog.v1' as const,
  catalog_id: 'kyc-judgment-openenv.facts',
  version: 1,
  owner: { kind: 'project_scope' as const, id: 'p1' },
  facts: [
    { id: 'product', label: 'Product', type: 'enum' as const, availability: 'case_data', allowed_values: ['individual', 'teen_joint'] },
    { id: 'citizenship', label: 'Citizenship', type: 'string' as const, availability: 'case_data', cardinality: 'many' as const, description: '  ', source: { field: 'party.citizenship' } },
  ],
};
const usPerson = { fact: { id: 'us_person', type: 'boolean' as const, definition: { fact: 'citizenship', op: 'eq' as const, value: 'US' }, description: 'A US citizen.' }, ruleId: 'r-us', ruleKey: 'R-US-PERSON-DEFINITION' };

describe('factRows', () => {
  it('lists catalog facts in order, then derived facts with the rule that defines them', () => {
    const rows = factRows(catalog, [usPerson], []);
    expect(rows.map((r) => r.id)).toEqual(['product', 'citizenship', 'us_person']);
    expect(rows[0]).toMatchObject({ label: 'Product', description: null, type: 'enum', allowedValues: ['individual', 'teen_joint'], origin: 'case_data', sourceField: null, definedBy: null, usedBy: 0 });
    expect(rows[1]).toMatchObject({ description: null, cardinality: 'many', sourceField: 'party.citizenship' });
    expect(rows[2]).toMatchObject({ origin: 'derived', description: 'A US citizen.', definedBy: { ruleId: 'r-us', ruleKey: 'R-US-PERSON-DEFINITION' } });
  });
  it('counts each rule once per fact its condition names, through all / any / not', () => {
    const conditions = [
      { fact: 'product', op: 'eq', value: 'teen_joint' },
      { all: [{ fact: 'product', op: 'eq', value: 'individual' }, { not: { fact: 'us_person', op: 'eq', value: true } }] },
      { any: [{ fact: 'us_person', op: 'eq', value: true }, { fact: 'us_person', op: 'eq', value: false }] },
      null,
      undefined,
    ];
    const used = Object.fromEntries(factRows(catalog, [usPerson], conditions).map((r) => [r.id, r.usedBy]));
    expect(used).toEqual({ product: 2, citizenship: 0, us_person: 2 });
  });
  it('a derived fact with a catalog id is not listed twice; no catalog gives only derived facts', () => {
    expect(factRows(catalog, [{ ...usPerson, fact: { ...usPerson.fact, id: 'product' } }], []).map((r) => r.id)).toEqual(['product', 'citizenship']);
    expect(factRows(null, [usPerson], []).map((r) => r.id)).toEqual(['us_person']);
  });
});
