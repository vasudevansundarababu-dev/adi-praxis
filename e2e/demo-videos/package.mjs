#!/usr/bin/env node
// Packages the user guide and demo videos for sharing outside the repository (docs/user-guide/VIDEOS.md):
//   out/handbook/            the handbook page, the guide PDF and web-sized videos (each under 15 MB), ready to publish
//   out/ADI-Praxis-1.1-Handbook.zip   the same, plus the full-quality videos and the full walkthrough
// Usage: node e2e/demo-videos/package.mjs [videos folder, default out/demo-videos]
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SRC = path.resolve(ROOT, process.argv[2] ?? 'out/demo-videos');
const OUT = path.join(ROOT, 'out/handbook');
const PDF = path.join(ROOT, 'out/user-guide/ADI-Praxis-User-Guide.pdf');
const ROLE = ['01-getting-started', '02-admin', '03-program-manager', '04-validator', '05-finance', '06-staffing-partner', '07-expert-sme'];
const LIMIT = 14.5 * 1024 * 1024;

if (!existsSync(PDF)) execFileSync('node', [path.join(ROOT, 'docs/user-guide/build-pdf.mjs')], { stdio: 'inherit' });
rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(OUT, 'videos'), { recursive: true });

// Web copies: 1280x800 H.264; raise the compression until each file is under the publishing limit.
for (const v of ROLE) {
  const src = path.join(SRC, `${v}.mp4`);
  if (!existsSync(src)) throw new Error(`missing ${src}: run make-videos.mjs first`);
  const dst = path.join(OUT, 'videos', `${v}.mp4`);
  for (const crf of [26, 29, 32, 35]) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', 'scale=1280:800', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-an', '-movflags', '+faststart', dst]);
    if (statSync(dst).size < LIMIT) break;
  }
}
copyFileSync(PDF, path.join(OUT, 'ADI-Praxis-User-Guide.pdf'));
const recorded = new Date(statSync(path.join(SRC, '01-getting-started.mp4')).mtime).toISOString().slice(0, 10);
const page = readFileSync(path.join(import.meta.dirname, 'handbook.html'), 'utf8').replace('__RECORDED__', recorded);
writeFileSync(path.join(OUT, 'page.html'), page); // published as an artifact (the host adds the document wrapper)
writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${page.replace('</style>', 'body{margin:0}</style>')}</body></html>`.replace(/(<\/style>)/, '$1</head><body>'));

// The zip adds the full-quality videos (including the full walkthrough) for offline use and Drive or SharePoint.
const ZIPDIR = path.join(ROOT, 'out/ADI-Praxis-1.1-Handbook');
rmSync(ZIPDIR, { recursive: true, force: true });
execFileSync('cp', ['-R', OUT, ZIPDIR]);
mkdirSync(path.join(ZIPDIR, 'videos-full-quality'), { recursive: true });
for (const v of ['00-full-walkthrough', ...ROLE]) {
  const src = path.join(SRC, `${v}.mp4`);
  if (existsSync(src)) copyFileSync(src, path.join(ZIPDIR, 'videos-full-quality', `${v}.mp4`));
}
rmSync(path.join(ZIPDIR, 'page.html'));
const zip = path.join(ROOT, 'out/ADI-Praxis-1.1-Handbook.zip');
rmSync(zip, { force: true });
execFileSync('zip', ['-qr', zip, path.basename(ZIPDIR)], { cwd: path.dirname(ZIPDIR) });
console.log(`handbook: ${OUT}\nzip: ${zip} (${(statSync(zip).size / 1048576).toFixed(0)} MB)`);
for (const v of ROLE) console.log(`  ${v}.mp4 ${(statSync(path.join(OUT, 'videos', `${v}.mp4`)).size / 1048576).toFixed(1)} MB`);
