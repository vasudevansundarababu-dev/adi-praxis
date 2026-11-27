/**
 * Owner, 27 Nov 2026: "These videos are outdated … Right now you can hide this page." One switch, TUTORIALS_ENABLED
 * (off unless "true" or "1"), read by the API, the console and the SME app from the same environment. Off: no Tutorials
 * link anywhere, /tutorials goes to Home, the tutorial files are not served, and no help text mentions Tutorials. On:
 * everything is as before. The videos and the page code are kept. (The per-template tutorial video on a task page is a
 * different feature and is not affected.)
 */
export function tutorialsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.TUTORIALS_ENABLED ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

/** Help text with the Tutorials mentions taken out (switch off). Paragraphs starting "TUTORIALS." are dropped. */
export function withoutTutorials(text: string): string {
  return text
    .split(/\n\s*\n/)
    .filter((p) => !/^\s*TUTORIALS\./.test(p))
    .join('\n\n')
    .replace(/, Admin and Tutorials\b/g, ' and Admin');
}
