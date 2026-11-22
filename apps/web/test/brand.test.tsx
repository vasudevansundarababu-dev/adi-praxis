import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandLockup, FullLogo, NavBrand, SignInShell } from '@/components/brand';

/** ADI Labs Forge branding (owner, 22 Nov 2026; design repo shared/BRANDING.md, change F-09). */
const APP = path.resolve(import.meta.dirname, '..');
const read = (f: string) => readFileSync(path.join(APP, f), 'utf8');
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

describe('ADI Labs Forge lockup (BRANDING.md §3)', () => {
  it('header lockup: 30 px shield, "ADI LABS" white, "-FORGE" light purple, divider, AUTHORING', () => {
    const html = renderToStaticMarkup(<NavBrand />);
    expect(text(html)).toBe('ADI LABS-FORGEAuthoring');
    expect(html).toMatch(/<img[^>]*width="30"[^>]*height="30"/);
    expect(html).toContain('adi-labs-forge-mark-512');
    expect(html).toMatch(/class="text-white">ADI LABS</);
    expect(html).toMatch(/class="text-forge-purple-light">-FORGE</);
    expect(html).toContain('bg-forge-divider');
    expect(html).toMatch(/font-display font-semibold uppercase tracking-\[0\.14em\]/);
  });

  it('light tone uses navy and purple', () => {
    const html = renderToStaticMarkup(<BrandLockup tone="light" />);
    expect(html).toMatch(/class="text-forge-navy">ADI LABS</);
    expect(html).toMatch(/class="text-forge-purple">-FORGE</);
  });

  it('sign-in: navy page, centred shield + ADI LABS-FORGE + AUTHORING, one white card with the heading', () => {
    const html = renderToStaticMarkup(
      <SignInShell title="Sign in to Authoring" footer={<a href="/x">footer link</a>}>
        <button className="btn btn-primary">Sign in</button>
      </SignInShell>,
    );
    expect(html).toMatch(/<main class="[^"]*bg-forge-navy/);
    expect(text(renderToStaticMarkup(<FullLogo />))).toBe('ADI LABS-FORGEAuthoring');
    expect(html).toMatch(/<img[^>]*alt="ADI Labs Forge"[^>]*width="112"/);
    expect(html.match(/rounded-2xl bg-white/g)).toHaveLength(1);
    expect(html).toMatch(/class="light [^"]*bg-white[^"]*"><h1[^>]*>Sign in to Authoring<\/h1><button class="btn btn-primary">/);
    expect(html.indexOf('footer link')).toBeGreaterThan(html.indexOf('</h1>'));
  });

  it('every signed-in header uses the navy bar, the 3 px gradient rule and the lockup linking home', () => {
    for (const f of ['app/(console)/layout.tsx', 'app/partner/(portal)/layout.tsx']) {
      const src = read(f);
      expect(src).toContain('bg-forge-navy');
      expect(src).toContain('h-[3px] bg-forge-rule');
      expect(src).toContain('<NavBrand />');
      expect(src).not.toContain('bg-brand-navy');
    }
    expect(read('app/(console)/layout.tsx')).toMatch(/<Link href="\/" aria-label="Authoring home">\s*<NavBrand \/>/);
  });

  it('sign-in and change-password pages use the navy shell; "Sign in to Authoring" on the console', () => {
    for (const f of ['app/login/page.tsx', 'app/change-password/page.tsx', 'app/partner/login/page.tsx', 'app/partner/change-password/page.tsx']) {
      expect(read(f)).toContain('<SignInShell');
      expect(read(f)).not.toContain('bg-brand-charcoal');
    }
    expect(read('app/login/page.tsx')).toContain('title="Sign in to Authoring"');
  });

  it('browser tab and icons: "<Page> · Authoring · ADI Labs Forge", favicon and apple-touch icon from the shield', () => {
    const src = read('app/layout.tsx');
    expect(src).toContain('title: titleTemplate');
    expect(src).toContain("'@praxis/shared/brand/icon-32.png'");
    expect(src).toContain("'@praxis/shared/brand/apple-touch-icon.png'");
  });

  it('the 15 Nov pen-nib image is gone from the app', () => {
    for (const f of ['components/brand.tsx', 'app/layout.tsx']) expect(read(f)).not.toMatch(/praxis-(mark|logo)|brand-forge|adi-forge-/);
  });
});
