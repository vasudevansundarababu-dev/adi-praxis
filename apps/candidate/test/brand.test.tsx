import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NavBrand, SignInShell } from '@/components/brand';

/** ADI Labs Forge branding (owner, 22 Nov 2026; design repo shared/BRANDING.md, change F-09). */
const APP = path.resolve(import.meta.dirname, '..');
const read = (f: string) => readFileSync(path.join(APP, f), 'utf8');
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

describe('ADI Labs Forge branding in the candidate app', () => {
  it('header: navy bar, 3 px gradient rule, lockup linking home; nav links unchanged', () => {
    const src = read('components/header.tsx');
    expect(src).toContain('bg-forge-navy');
    expect(src).toContain('h-[3px] bg-forge-rule');
    expect(src).toMatch(/<Link href=\{me \? '\/home' : '\/'\} aria-label="Authoring home">\s*<NavBrand \/>/);
    for (const link of ['/home', '/opportunities', '/tutorials', '/sign-in']) expect(src).toContain(`href="${link}"`);
    const html = renderToStaticMarkup(<NavBrand />);
    expect(text(html)).toBe('ADI LABS-FORGEAuthoring');
    expect(html).toMatch(/<img[^>]*width="30"/);
  });

  it('sign-in, forgot and set password pages: navy page, centred lockup, one white card', () => {
    for (const f of ['app/sign-in/page.tsx', 'app/forgot-password/page.tsx', 'app/set-password/[token]/page.tsx']) {
      expect(read(f)).toContain('<SignInShell');
      expect(read(f)).not.toContain('FullLogo');
    }
    expect(read('app/sign-in/page.tsx')).toContain('<SignInShell title="Sign in to Authoring">');
    const html = renderToStaticMarkup(<SignInShell title="Sign in to Authoring"><p>form</p></SignInShell>);
    expect(html).toMatch(/<main class="[^"]*bg-forge-navy/);
    expect(html.match(/rounded-2xl bg-white/g)).toHaveLength(1);
    expect(text(html)).toBe('ADI LABS-FORGEAuthoringSign in to Authoringform');
  });

  it('browser tab and icons come from the shield; the 15 Nov pen-nib image is gone', () => {
    const src = read('app/layout.tsx');
    expect(src).toContain('title: titleTemplate');
    expect(src).toContain("'@praxis/shared/brand/icon-32.png'");
    expect(src).toContain("'@praxis/shared/brand/apple-touch-icon.png'");
    for (const f of ['app/layout.tsx', 'components/header.tsx', 'components/brand.tsx']) expect(read(f)).not.toMatch(/praxis-(mark|logo)|brand-forge|adi-forge-/);
  });
});
