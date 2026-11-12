import { describe, expect, it, vi } from 'vitest';
import { GoldenPackUpload } from '../components/templates/golden-pack-upload';
import { a11yProblems } from './a11y';
import { html, text } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

describe('golden task pack upload (owner, 12 Nov 2026)', () => {
  it('asks for a JSON pack file and explains the format', () => {
    const markup = html(<GoldenPackUpload />);
    expect(text(markup)).toContain('Upload a golden task pack');
    expect(markup).toContain('accept="application/json,.json"');
    expect(text(markup)).toContain('praxis.golden_pack.v1');
    expect(a11yProblems(markup)).toEqual([]);
  });
});
