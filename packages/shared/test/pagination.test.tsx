import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { clampPage, matchesQuery, pageButtons, pageCount, PageQuery, pageWindow, parsePage, showingText, slicePage, withPage, withQuery } from '../src/pagination';
import { Pagination } from '../src/ui/pagination';
import { urlWithPage } from '../src/ui/use-page';

const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('D24 paging logic', () => {
  it('pages 10 rows at a time and clamps a stale page into range', () => {
    const rows = Array.from({ length: 23 }, (_, i) => i + 1);
    expect(pageCount(23)).toBe(3);
    expect(pageCount(0)).toBe(1);
    expect(slicePage(rows, 1)).toMatchObject({ items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], page: 1, total: 23, pageCount: 3, pageSize: 10 });
    expect(slicePage(rows, 3).items).toEqual([21, 22, 23]);
    expect(slicePage(rows, 9)).toMatchObject({ page: 3, items: [21, 22, 23] });
    expect(slicePage([], 4)).toMatchObject({ page: 1, items: [], total: 0 });
    expect(clampPage(0, 50)).toBe(1);
    expect(pageWindow(4, 35)).toMatchObject({ skip: 30, take: 10, page: 4, pageCount: 4 });
  });

  it('reads the page from the URL: a positive whole number, otherwise 1', () => {
    expect(parsePage('3')).toBe(3);
    expect(parsePage(['2', '5'])).toBe(2);
    for (const bad of [undefined, '', '0', '-2', 'abc', null]) expect(parsePage(bad)).toBe(1);
    expect(PageQuery.parse({ page: '2', pageSize: '25' })).toEqual({ page: 2, pageSize: 25 });
    expect(PageQuery.safeParse({ pageSize: '500' }).success).toBe(false);
    expect(PageQuery.parse({})).toEqual({});
  });

  it('shows the first five pages, then from page 5 the current page and the five after it (owner, 23 Nov 2026)', () => {
    expect(pageButtons(1, 1)).toEqual([1]);
    expect(pageButtons(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageButtons(1, 99)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 99]);
    expect(pageButtons(4, 11)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 11]);
    // The owner's case: on page 5 of 11 the next pages 6 to 10 are shown.
    expect(pageButtons(5, 11)).toEqual([1, 'ellipsis', 5, 6, 7, 8, 9, 10, 11]);
    expect(pageButtons(6, 11)).toEqual([1, 'ellipsis', 6, 7, 8, 9, 10, 11]);
    expect(pageButtons(5, 99)).toEqual([1, 'ellipsis', 5, 6, 7, 8, 9, 10, 'ellipsis', 99]);
    expect(pageButtons(50, 99)).toEqual([1, 'ellipsis', 50, 51, 52, 53, 54, 55, 'ellipsis', 99]);
    expect(pageButtons(97, 99)).toEqual([1, 'ellipsis', 94, 95, 96, 97, 98, 99]);
    expect(pageButtons(99, 99)).toEqual([1, 'ellipsis', 94, 95, 96, 97, 98, 99]);
    expect(pageButtons(10, 11)).toEqual([1, 'ellipsis', 6, 7, 8, 9, 10, 11]);
    for (let p = 1; p <= 40; p++) expect(pageButtons(p, 40)).toContain(p);
  });

  it('counts the rows: "Showing 10 of 50 users"', () => {
    expect(showingText(10, 50, 'users')).toBe('Showing 10 of 50 users');
    expect(showingText(1, 1, 'projects', 'project')).toBe('Showing 1 of 1 project');
    expect(showingText(0, 0, 'projects', 'project')).toBe('Showing 0 of 0 projects');
  });

  it('keeps other URL parameters when changing page, and a new search goes back to page 1', () => {
    expect(withPage('?q=ada&status=OPEN', 3)).toBe('?q=ada&status=OPEN&page=3');
    expect(withPage('?q=ada&page=3', 1)).toBe('?q=ada');
    expect(withPage({ q: 'x', tab: ['a', 'b'] }, 2)).toBe('?q=x&tab=a&tab=b&page=2');
    expect(withPage('', 1)).toBe('?');
    expect(withPage('?page=2', 4, 'usersPage')).toBe('?page=2&usersPage=4');
    expect(withQuery('?q=ad&page=4&status=OPEN', 'ada')).toBe('?q=ada&status=OPEN');
    expect(withQuery('?q=ada&page=4', ' ')).toBe('?');
    expect(urlWithPage({ pathname: '/users', search: '?q=x', hash: '#top' }, 2)).toBe('/users?q=x&page=2#top');
    expect(urlWithPage({ pathname: '/users', search: '?page=2', hash: '' }, 1)).toBe('/users');
  });

  it('matches every word of a search across the fields, ignoring case', () => {
    const f = ['Ada', 'Lovelace', 'ada@gmail.test', 'KYC', 'Sanctions screening'];
    expect(matchesQuery(f, 'ada')).toBe(true);
    expect(matchesQuery(f, 'LOVE kyc')).toBe(true);
    expect(matchesQuery(f, 'sanctions')).toBe(true);
    expect(matchesQuery(f, 'gmail.test')).toBe(true);
    expect(matchesQuery(f, 'ada babbage')).toBe(false);
    expect(matchesQuery(f, '')).toBe(true);
    expect(matchesQuery([null, undefined, 'x'], 'x')).toBe(true);
  });
});

describe('D24 shared Pagination component', () => {
  const bar = (props: Partial<Parameters<typeof Pagination>[0]> = {}) =>
    renderToStaticMarkup(<Pagination page={5} total={990} shown={10} noun="users" singular="user" hrefFor={(p) => `?page=${p}`} {...props} />);

  it('renders the count, Previous, numbers with an ellipsis and Next, in a nav landmark', () => {
    const m = bar();
    expect(text(m)).toContain('Showing 10 of 990 users');
    expect(m).toContain('<nav aria-label="Users pages"');
    expect(text(m)).toMatch(/‹ Previous 1 … 5 6 7 8 9 10 … 99 Next ›/);
    expect(m).toContain('href="?page=4"');
    expect(m).toContain('href="?page=6"');
    expect(m).toContain('href="?page=99"');
    expect(m).toContain('rel="prev"');
    expect(m).toContain('rel="next"');
  });

  it('marks the current page with aria-current and the brand colour, and does not link it', () => {
    const m = bar();
    expect(m.match(/aria-current="page"/g)).toHaveLength(1);
    expect(m).toMatch(/<span aria-current="page" aria-label="Page 5" class="[^"]*bg-primary text-on-primary[^"]*">5<\/span>/);
    expect(m).not.toContain('href="?page=5"');
  });

  it('disables Previous on the first page and Next on the last', () => {
    expect(bar({ page: 1 })).toMatch(/<span aria-disabled="true" aria-label="Previous page"/);
    expect(bar({ page: 99 })).toMatch(/<span aria-disabled="true" aria-label="Next page"/);
  });

  it('collapses on narrow screens to arrows and numbers: the words and the count are hidden below the sm breakpoint', () => {
    const m = bar();
    expect(m).toContain('<span class="sr-only sm:not-sr-only">Previous</span>');
    expect(m).toContain('<span class="sr-only sm:not-sr-only">Next</span>');
    expect(m).toMatch(/<p class="sr-only [^"]*sm:not-sr-only"[^>]*>Showing 10 of 990 users<\/p>/);
  });

  it('uses buttons for a client table and hides the controls when everything fits on one page', () => {
    const m = renderToStaticMarkup(<Pagination page={1} total={25} shown={10} noun="rules" onPage={() => undefined} />);
    expect(m).toContain('<button type="button" aria-label="Page 2"');
    expect(m).not.toContain('href=');
    const one = renderToStaticMarkup(<Pagination page={1} total={3} shown={3} noun="projects" singular="project" onPage={() => undefined} />);
    expect(text(one)).toBe('Showing 3 of 3 projects');
    expect(one).not.toContain('<nav');
  });

  it('uses the given link component (next/link in the apps)', () => {
    const Fake = ({ href, children }: { href: string; children?: ReactNode }) => <a data-fake href={href}>{children}</a>;
    expect(bar({ linkAs: Fake })).toContain('data-fake="true" href="?page=4"');
  });
});
