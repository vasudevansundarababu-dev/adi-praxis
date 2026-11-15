import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Legal rule (owner, 15 Nov 2026): nothing a user sees may name "ADI-Labs", "Praxis" or "Anvil". The product is
 * "ADI Forge"; Anvil is shown as "RL Gym". Internal names stay: code identifiers (`isAnvil`, `PraxisPrecheckValidator`),
 * packages (`@praxis/shared`), CSS and storage keys (`praxis-theme`), protocol names (`Praxis-Signature`,
 * `praxis.authored-task-export.v1`), "Praxis Demo Bank" (the fictional bank in synthetic data), and comments.
 *
 * This scans every UI source file in both apps, plus the API files whose text reaches the screen, emails or the
 * support bot, and fails on any public use of the three names.
 */
const ROOT = path.resolve(import.meta.dirname, '../../..');
const API_USER_FACING = [
  'apps/api/src/anvil/validator.ts',
  'apps/api/src/routes/tasks.ts',
  'apps/api/src/tasks/submission.ts',
  'apps/api/src/support/help-pack.ts',
  'apps/api/src/support/authoring-help.ts',
  'apps/api/src/support/assistant.ts',
  'apps/api/src/routes/forge-help.ts',
  'packages/shared/src/forge-help.ts',
  'apps/api/src/supply/submissions.ts',
  'apps/api/src/routes/supply-candidate.ts',
  'apps/api/src/cert/generator.ts',
  'apps/api/src/tasks/drafting/drafter.ts',
  'apps/api/src/config.ts',
  'apps/api/src/routes/forge-sourcing.ts',
  'apps/api/src/forge/recruiter-pack.ts',
  'apps/api/src/forge/sourcing.ts',
  'apps/api/src/forge/password.ts',
  'apps/api/src/routes/candidate-password.ts',
  'apps/api/src/routes/candidate-auth.ts',
  'packages/shared/theme/tokens.ts',
];
const BANNED = [
  /ADI[- ]?Labs/,
  /ADI Praxis/,
  /(?<![\w@./-])Praxis(?![\w-])(?! Demo Bank)/,
  /(?<![\w@./-])Anvil(?![\w-])/,
];
const COMMENT = /^\s*(\/\/|\*|\/\*|\{\/\*)/;

function uiFiles(): string[] {
  const out = execFileSync('git', ['ls-files', 'apps/web/app', 'apps/web/components', 'apps/web/lib', 'apps/candidate/app', 'apps/candidate/components', 'apps/candidate/lib'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|\/test\//.test(f));
}

/** Lines that show a banned name to users, as "file:line: text". */
export function publicNameViolations(files: string[], read: (f: string) => string): string[] {
  const hits: string[] = [];
  for (const f of files) {
    read(f).split('\n').forEach((line, i) => {
      if (COMMENT.test(line) || /^\s*import\s/.test(line)) return;
      // The support bot's own instruction must name what it may not say.
      if (line.includes('Never use the names Praxis, Anvil or ADI-Labs')) return;
      if (BANNED.some((re) => re.test(line))) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  return hits;
}

describe('public names (legal, 15 Nov 2026)', () => {
  it('no UI text, user-facing API message, email or support prompt names ADI-Labs, Praxis or Anvil', () => {
    const files = [...uiFiles(), ...API_USER_FACING];
    expect(files.length).toBeGreaterThan(100);
    expect(publicNameViolations(files, (f) => readFileSync(path.join(ROOT, f), 'utf8'))).toEqual([]);
  });

  it('catches the banned names but allows internal names', () => {
    const lines: Record<string, string> = {
      'a.tsx': [
        "<p>Validated by Anvil.</p>",
        "const title = 'ADI Praxis';",
        "<span>Praxis checks each task</span>",
        "<p>Hello ADI Labs</p>",
        "// Anvil and Praxis in a comment are fine",
        "import x from '@praxis/shared/theme';",
        "if (state.validator.isAnvil) send('Praxis-Signature');",
        "const doc = 'US Federal KYC Policy (Praxis Demo Bank)';",
        "const schema = 'praxis.authored-task-export.v1';",
        "<p>Export to RL Gym from ADI Forge</p>",
      ].join('\n'),
    };
    expect(publicNameViolations(['a.tsx'], (f) => lines[f]!).map((h) => h.split(':')[1])).toEqual(['1', '2', '3', '4']);
  });
});
