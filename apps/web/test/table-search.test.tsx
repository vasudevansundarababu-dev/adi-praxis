import { describe, expect, it } from 'vitest';
import { filterRows, TableSearch } from '../components/search/table-search';
import { html } from './helpers';

const row = (id: string) => ({ dataset: { searchId: id }, hidden: false });

describe('console search bar (owner, 12 Nov 2026)', () => {
  it('filters the table rows to the matches, and shows all rows again when cleared', () => {
    const rows = [row('a'), row('b'), row('c')];
    let selector = '';
    const root = { querySelectorAll: (s: string) => ((selector = s), rows) } as unknown as ParentNode;
    expect(filterRows(root, 'projects', ['c', 'a'])).toBe(2);
    expect(selector).toBe('[data-search-scope="projects"] [data-search-id]');
    expect(rows.map((r) => r.hidden)).toEqual([false, true, false]);
    expect(filterRows(root, 'projects', null)).toBe(3);
    expect(rows.every((r) => !r.hidden)).toBe(true);
  });

  it('renders an accessible search box above the table', () => {
    const markup = html(<TableSearch type="projects" label="Search projects" />);
    expect(markup).toContain('role="search"');
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('Search projects');
  });
});
