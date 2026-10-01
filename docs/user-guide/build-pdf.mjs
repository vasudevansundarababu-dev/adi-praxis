#!/usr/bin/env node
// Builds out/user-guide/ADI-Praxis-User-Guide.pdf (and .html) from the Markdown chapters in this folder, using
// Playwright's Chromium to print. A small Markdown converter covers what the guide uses: headings, paragraphs, lists,
// tables, code blocks, block quotes, bold, italics, inline code and links.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DIR = import.meta.dirname;
const OUT = path.resolve(DIR, '../../out/user-guide');
const CHAPTERS = ['README.md', '01-getting-started.md', '02-admin.md', '03-pm.md', '04-validator.md', '05-finance.md', '06-partner.md', '07-sme.md', 'ROLES-AND-ADMIN.md', '08-troubleshooting.md', 'VIDEOS.md'];
const anchor = (t) => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s, file) {
  const codes = [];
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
      // Links between chapters become links inside the single PDF.
      const m = href.match(/^([\w.-]+\.md)?(#.*)?$/);
      if (m && (m[1] || m[2])) return `<a href="#${m[2] ? m[2].slice(1) : anchor(file)}">${text}</a>`;
      return `<a href="${href}">${text}</a>`;
    });
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
}

function render(md, file) {
  const lines = md.replace(/\r/g, '').split('\n');
  const html = [`<section class="chapter" id="${anchor(file)}">`];
  for (let i = 0; i < lines.length; ) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const buf = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) buf.push(lines[i]);
      i++;
      html.push(`<pre>${esc(buf.join('\n'))}</pre>`);
    } else if (/^#{1,4} /.test(l)) {
      const n = l.match(/^#+/)[0].length;
      const t = l.slice(n + 1);
      html.push(`<h${n} id="${anchor(t)}">${inline(t, file)}</h${n}>`);
      i++;
    } else if (/^\|/.test(l)) {
      const rows = [];
      for (; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(lines[i]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => inline(c.trim().replace(/\\\|/g, '|'), file));
      const [head, , ...body] = rows;
      html.push(`<table><thead><tr>${cells(head).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (/^> ?/.test(l)) {
      const buf = [];
      for (; i < lines.length && /^> ?/.test(lines[i]); i++) buf.push(lines[i].replace(/^> ?/, ''));
      html.push(`<blockquote>${inline(buf.join(' '), file)}</blockquote>`);
    } else if (/^\s*([-*]|\d+\.) /.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items = [];
      for (; i < lines.length && (/^\s*([-*]|\d+\.) /.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length)); i++) {
        if (/^\s*([-*]|\d+\.) /.test(lines[i]) && !/^\s{3,}/.test(lines[i])) items.push(lines[i].replace(/^\s*([-*]|\d+\.) /, ''));
        else items[items.length - 1] += /^\s*([-*]|\d+\.) /.test(lines[i]) ? `<br>• ${lines[i].replace(/^\s*([-*]|\d+\.) /, '')}` : ` ${lines[i].trim()}`;
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.map((t) => `<li>${inline(t, file).replace(/&lt;br&gt;/g, '<br>')}</li>`).join('')}</${tag}>`);
    } else if (!l.trim()) {
      i++;
    } else {
      const buf = [];
      for (; i < lines.length && lines[i].trim() && !/^(#|\||>|```|\s*([-*]|\d+\.) )/.test(lines[i]); i++) buf.push(lines[i]);
      html.push(`<p>${inline(buf.join(' '), file)}</p>`);
    }
  }
  html.push('</section>');
  return html.join('\n');
}

const body = CHAPTERS.map((f) => render(readFileSync(path.join(DIR, f), 'utf8'), f)).join('\n');
const logo = readFileSync(path.resolve(DIR, '../brand/ADI-Labs-Icon.png')).toString('base64');
const date = new Date().toISOString().slice(0, 10);
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ADI Praxis user guide</title><style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  body { font: 10.5pt/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1b2433; }
  .cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
  .cover img { width: 70px; } .cover h1 { font-size: 34pt; margin: 18px 0 6px; color: #0b2a5b; border: 0; }
  .cover p { font-size: 13pt; color: #445; margin: 4px 0; }
  .chapter { page-break-before: always; }
  h1 { font-size: 20pt; color: #0b2a5b; border-bottom: 3px solid #1d6fb8; padding-bottom: 4px; }
  h2 { font-size: 14pt; color: #123a6b; margin-top: 20px; } h3 { font-size: 11.5pt; color: #123a6b; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; font-size: 9pt; page-break-inside: auto; }
  th, td { border: 1px solid #c9d3e0; padding: 4px 6px; vertical-align: top; text-align: left; } th { background: #eef3f9; }
  tr { page-break-inside: avoid; }
  code { font: 8.8pt ui-monospace, Menlo, monospace; background: #f1f4f8; padding: 0 3px; border-radius: 3px; }
  pre { font: 8pt/1.35 ui-monospace, Menlo, monospace; background: #f6f8fb; border: 1px solid #dde4ee; padding: 8px; white-space: pre-wrap; }
  blockquote { margin: 10px 0; padding: 6px 12px; border-left: 4px solid #f5a524; background: #fff8ea; }
  a { color: #1d5fa8; text-decoration: none; }
</style></head><body>
<div class="cover"><img src="data:image/png;base64,${logo}" alt=""><h1>ADI Praxis user guide</h1>
<p>Release 1.1 · for Admins, Program Managers, Validators, Finance, staffing partners and experts</p><p>ADI-Labs · ${date}</p></div>
${body}</body></html>`;

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'ADI-Praxis-User-Guide.html'), page);
const browser = await chromium.launch();
const p = await browser.newPage();
await p.setContent(page, { waitUntil: 'load' });
await p.pdf({ path: path.join(OUT, 'ADI-Praxis-User-Guide.pdf'), format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#778">ADI Praxis user guide · release 1.1 · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>', margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' } });
await browser.close();
console.log(`wrote ${path.join(OUT, 'ADI-Praxis-User-Guide.pdf')}`);
