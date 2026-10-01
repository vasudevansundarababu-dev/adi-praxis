#!/usr/bin/env node
// Joins the recorded clips (out/demo-videos/raw/*.webm) into one MP4 per role plus a full walkthrough, in
// out/demo-videos/. Needs ffmpeg on PATH. Clips named zz-* are set-up steps and are never used.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '../..', process.env.VIDEO_OUT ?? 'out/demo-videos');
const RAW = path.join(OUT, 'raw');
const TMP = path.join(OUT, 'mp4');

const VIDEOS = [
  ['00-full-walkthrough', null],
  ['01-getting-started', ['01-getting-started']],
  ['02-admin', ['02-admin-guidelines', '03-admin-setup']],
  ['03-program-manager', ['04-pm-project', '05-pm-requisition', '10-pm-staffing', '15b-pm-confirm']],
  ['04-validator', ['08-validator-select', '12-validator-task', '13-validator-rl']],
  ['05-finance', ['15a-finance', '15b-pm-confirm', '15c-finance']],
  ['06-staffing-partner', ['06-partner']],
  ['07-expert-sme', ['07-sme-apply', '09-sme-onboarding', '11-sme-task', '14-sme-certification']],
];

const clips = readdirSync(RAW).filter((f) => f.endsWith('.webm') && !f.startsWith('zz-')).map((f) => f.slice(0, -5)).sort();
if (!clips.length) throw new Error(`no clips in ${RAW}: record them first`);
mkdirSync(TMP, { recursive: true });

// One encode per clip, with identical settings so the concat demuxer can join them without re-encoding.
for (const c of clips) {
  const dst = path.join(TMP, `${c}.mp4`);
  if (existsSync(dst)) rmSync(dst);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(RAW, `${c}.webm`), '-vf', 'fps=25,scale=1440:900,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-an', '-movflags', '+faststart', dst], { stdio: 'inherit' });
}

const made = [];
for (const [name, parts] of VIDEOS) {
  const use = (parts ?? clips).filter((c) => clips.includes(c));
  if (!use.length) continue;
  const list = path.join(TMP, `${name}.txt`);
  writeFileSync(list, use.map((c) => `file '${path.join(TMP, `${c}.mp4`)}'`).join('\n'));
  const dst = path.join(OUT, `${name}.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', dst], { stdio: 'inherit' });
  const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', dst]).toString());
  made.push(`${name}.mp4  ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`);
}
console.log(`videos in ${OUT}:\n  ${made.join('\n  ')}`);
