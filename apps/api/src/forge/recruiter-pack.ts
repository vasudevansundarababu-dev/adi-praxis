import {
  demographicProfile,
  educationLabel,
  PROFILE_SECTIONS,
  profileForTemplate,
  QuestionPolicy,
  reconcilePolicy,
  type DemographicFilterInput,
  type JdProfileLine,
  type RecruiterPackDto,
  type RecruiterRequirement,
} from '@praxis/shared';
import ExcelJS from 'exceljs';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Actor } from '../auth/actor';
import type { Db } from '../db';
import { currentDraft } from '../routes/opportunities';
import { sourcingProject } from './sourcing';

/**
 * Export to Recruiter (docs/design/PROJECT-SCREEN-DESIGN.md, Resource assignments): one PDF for recruitment agencies,
 * built from the project, with the candidate assessment sheet (Excel) attached inside it. Everything here is public
 * text, so it says "ADI Forge" and never the internal names (legal rule, 15 Nov 2026): free text from the project is
 * passed through `publicText`.
 */

/** Replaces the internal names in free text (project names, JD text, template examples) with the public ones. */
export function publicText(s: string): string {
  return s
    .replace(/\bADI[\s-]*(?=\bPraxis\b)/g, '')
    .replace(/\bPraxis\b/g, 'ADI Forge')
    .replace(/\bADI[\s-]?Labs\b/gi, 'ADI Forge')
    .replace(/\bAnvil\b/g, 'RL Gym');
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** File-name form of a project name: "KYC-Of US bank Chicago" becomes "KYC-Of-US-bank-Chicago". */
export const projectSlug = (name: string) => publicText(name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'project';
export const sheetFileName = (name: string) => `candidate-assessment-${projectSlug(name)}.xlsx`;
export const packFileName = (name: string) => `recruiter-pack-${projectSlug(name)}.pdf`;

export const formatPackDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Fixed: what the recruiter sends back for each candidate (design, section 4). */
export const SEND_BACK: RecruiterPackDto['sendBack'] = [
  { item: 'First name, last name, email', detail: "Required. The email must be the candidate's Gmail address; it becomes their sign-in." },
  { item: 'Assessment against the requirements', detail: 'For each requirement in section 2: met or not, with the evidence you checked.' },
  { item: 'Why they fit', detail: 'A few sentences in your words.' },
  { item: 'Answers to the questions', detail: "The candidate's answers to the questions in the sheet." },
  { item: 'Optional', detail: 'LinkedIn URL and a CV (PDF).' },
];

/** Plain words for the eight sections of every authoring form; the template adds its own field names and an example. */
const SECTION_PLAIN: Record<string, string> = {
  S1: 'The case in one line: what triggers it and what is in scope.',
  S2: 'The made-up people, organisations and documents the case uses.',
  S3: 'The tools or systems the work uses, and what each one returns.',
  S4: 'The rules and policies that apply, and which part of each one matters.',
  S5: 'What a careful expert does, step by step, and what happens when a check fails.',
  S6: 'The right outcome and the values it must contain.',
  S7: 'The scoring criteria a reviewer uses to judge an answer.',
  S8: 'Automatic checks before the task is submitted for review.',
};

const LOCATION: Record<string, string> = { REMOTE: 'Remote', ONSITE: 'On site', HYBRID: 'Hybrid' };

type JdData = {
  title?: string;
  responsibilities?: string;
  skills?: string[];
  mandatorySkills?: string[];
  wagePerTask?: number | string;
  wageCurrency?: string;
  locationType?: string;
  location?: string | null;
  minExperienceYears?: number | null;
  educationLevel?: string | null;
  demographicProfile?: JdProfileLine[];
};

function requirementsFrom(jd: JdData, profile: JdProfileLine[], domain: string): RecruiterRequirement[] {
  const out: RecruiterRequirement[] = [];
  const mandatory = new Set((jd.mandatorySkills ?? []).map((s) => s.toLowerCase()));
  const skills = [...(jd.mandatorySkills ?? []), ...(jd.skills ?? []).filter((s) => !mandatory.has(s.toLowerCase()))];
  skills.forEach((s, i) => {
    // A hand-picked JD (no mandatory skills) keeps the job post's rule: the first skill is required.
    const required = mandatory.size ? mandatory.has(s.toLowerCase()) : i === 0;
    out.push({ kind: 'Skill', detail: publicText(s), level: required ? 'Required' : 'Preferred', evidence: 'Roles where they used this skill, with examples' });
  });
  if (jd.minExperienceYears) out.push({ kind: 'Experience', detail: `${jd.minExperienceYears}+ years in ${domain}`, level: 'Required', evidence: 'Role history with dates' });
  if (jd.educationLevel) out.push({ kind: 'Education', detail: `${educationLabel(jd.educationLevel)} or higher (or equivalent professional experience)`, level: 'Required', evidence: 'Highest qualification' });
  for (const l of profile) out.push({ kind: publicText(l.label), detail: publicText(l.text), level: l.required ? 'Required' : 'Preferred', evidence: `${publicText(l.label)}, as the candidate states it` });
  return out;
}

/** Sheet header for one question: "Q1. <question>", short enough to be a column header and an assessment key. */
const questionHeader = (q: { n: number; text: string }) => clip(`Q${q.n}. ${q.text}`, 180);
export const requirementHeaders = (r: RecruiterRequirement) => {
  const name = clip(`${r.kind}: ${r.detail}`, 120);
  return [`${name} — Met? (Yes/No)`, `${name} — Evidence`];
};

export const FIXED_COLUMNS = { first: 'First name*', last: 'Last name*', email: 'Email (Gmail)*', linkedin: 'LinkedIn URL', why: 'Why they fit', recruiter: 'Recruiter name', agency: 'Agency' } as const;

function sheetColumnsFor(reqs: RecruiterRequirement[], questions: { n: number; text: string }[]) {
  return [
    FIXED_COLUMNS.first,
    FIXED_COLUMNS.last,
    FIXED_COLUMNS.email,
    FIXED_COLUMNS.linkedin,
    ...reqs.flatMap(requirementHeaders),
    ...questions.map(questionHeader),
    FIXED_COLUMNS.why,
    FIXED_COLUMNS.recruiter,
    FIXED_COLUMNS.agency,
  ];
}

/** The pack's content, from the project's frozen JD (else its JD), demographics, template form and question policy. */
export async function buildRecruiterPack(db: Db, actor: Actor, projectId: string, now = new Date()): Promise<RecruiterPackDto> {
  const base = await sourcingProject(db, actor, projectId);
  const p = await db.project.findUniqueOrThrow({
    where: { id: base.id },
    include: { template: { include: { domain: true } }, jdSnapshot: true, jobDescription: true, demographicFilters: { orderBy: { createdAt: 'asc' } } },
  });
  const live = p.jobDescription;
  const jd: JdData = (p.jdSnapshot?.data as JdData | undefined) ?? (live ? { ...live, wagePerTask: Number(live.wagePerTask), demographicProfile: live.demographicProfile as JdProfileLine[] } : {});
  const domain = publicText(p.template.domain.name);

  // Demographics: the JD's generated profile when it has one, else the project's own filters in plain words.
  let profile = jd.demographicProfile ?? [];
  if (!profile.length && p.demographicFilters.length) {
    const attributes = await db.demographicAttribute.findMany({ where: { clientId: p.clientId } });
    const filters = p.demographicFilters.map((f) => ({ attributeKey: f.attributeKey, operator: f.operator, values: f.values, required: f.required })) as DemographicFilterInput[];
    profile = demographicProfile(filters, attributes.map((a) => ({ key: a.key, label: a.label, type: a.type, allowedValues: a.allowedValues })));
  }
  const requirements = requirementsFrom(jd, profile, domain);

  // Questions: the job post's question policy (owner-edited, or the default from the brief and criteria).
  const draft = await currentDraft(db, p.id);
  const opp = await db.opportunity.findUnique({ where: { projectId_role: { projectId: p.id, role: 'AUTHOR' } } });
  const owned = QuestionPolicy.safeParse(opp?.draftQuestionPolicy);
  const policy = reconcilePolicy(owned.success ? owned.data : null, draft.brief, draft.criteria);
  const questions = policy.questions.map((q, i) => {
    // The combined requirements question lists them all; the pack shows them in section 2 instead.
    const text = q.criterionIds.length
      ? 'In a sentence or two, how does their experience meet the requirements in section 2?'
      : oneLine(q.text.replace(/\s*Tap (all that apply|or type)\.?/gi, ''));
    const options = q.answerType === 'choice' && q.options.length ? ` Options: ${q.options.join(', ')}.` : '';
    return { n: i + 1, text: publicText(`${text}${options}`), required: q.required };
  });

  // Cheat sheet: the template's eight sections in plain words, with the fields it asks for and one example.
  const form = profileForTemplate({ workflowName: p.template.workflowName, profileId: p.template.profileId });
  const sections = form.status === 'ok' ? form.profile.sections : null;
  const cheatSheet = PROFILE_SECTIONS.map((s) => {
    const sec = sections?.find((x) => x.key === s.key);
    const fields = sec?.fields ?? [];
    const labels = fields.slice(0, 5).map((f) => f.label);
    const example = fields.map((f) => f.example).find((e): e is string => !!e?.trim());
    const parts = [
      SECTION_PLAIN[s.key]!,
      labels.length ? `It asks for: ${labels.join(', ')}${fields.length > labels.length ? ', and more' : ''}.` : '',
      example ? `Example: ${clip(oneLine(example), 220)}` : '',
    ];
    return { section: s.key, title: publicText(sec?.title ?? s.title), explanation: publicText(parts.filter(Boolean).join(' ')) };
  });

  const wage = Number(jd.wagePerTask ?? 0);
  const country = profile.find((l) => /country|region/i.test(l.key) || /country|region/i.test(l.label));
  const language = profile.find((l) => /language/i.test(l.key) || /language/i.test(l.label));
  const effort = [p.tptMinutes ? `About ${p.tptMinutes} minutes per task` : '', p.maxPerExpert ? `up to ${p.maxPerExpert} tasks per person` : ''].filter(Boolean).join(' · ');
  const location = [LOCATION[jd.locationType ?? ''] ?? '', jd.location ?? country?.text ?? ''].filter(Boolean).join(', ');

  return {
    projectId: p.id,
    projectName: publicText(p.name),
    date: formatPackDate(now),
    fileName: sheetFileName(p.name),
    role: {
      title: publicText(jd.title ?? p.name),
      work: publicText(oneLine((jd.responsibilities ?? p.template.primaryWork ?? '').split(/\n\s*\n/)[0] ?? '')) || `${publicText(p.template.workflowName)} tasks in ${domain}.`,
      location: publicText(location) || 'Not set',
      language: language ? publicText(language.text) : 'Not set',
      pay: wage > 0 ? `${wage} ${jd.wageCurrency ?? ''} per accepted task`.replace(/\s+per/, ' per') : 'To be confirmed',
      effort: effort || 'To be confirmed',
      peopleNeeded: p.requiredWorkers,
    },
    requirements,
    cheatSheetIntro: 'Each expert writes one or more tasks in a fixed form, using made-up people and data only:',
    cheatSheet,
    questions,
    sendBack: SEND_BACK,
    sheetColumns: sheetColumnsFor(requirements, questions),
  };
}

// ───────────────────────── The candidate assessment sheet (Excel) ─────────────────────────

export const SHEET_NAME = 'Candidates';
const SHEET_ROWS = 200;

export async function buildAssessmentSheet(pack: RecruiterPackDto, now = new Date()): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ADI Forge';
  wb.created = now;
  wb.modified = now;
  const ws = wb.addWorksheet(SHEET_NAME, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(pack.sheetColumns);
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A2170' } };
  header.alignment = { wrapText: true, vertical: 'top' };
  pack.sheetColumns.forEach((h, i) => {
    ws.getColumn(i + 1).width = Math.min(Math.max(h.length * 0.6, 14), 40);
    // Yes/No on every "Met?" column, for the rows a recruiter fills in.
    if (h.endsWith('Met? (Yes/No)')) {
      for (let r = 2; r <= SHEET_ROWS + 1; r++) {
        ws.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Yes,No"'], showErrorMessage: true, errorTitle: 'Yes or No', error: 'Choose Yes or No.' };
      }
    }
  });

  const info = wb.addWorksheet('Instructions');
  info.getColumn(1).width = 110;
  const lines = [
    `ADI Forge — candidate assessment · ${pack.projectName} · ${pack.date}`,
    '',
    `One row per candidate on the "${SHEET_NAME}" sheet. Columns marked * are required.`,
    "Email: the candidate's Gmail address. It becomes their sign-in.",
    'For each requirement: "Met?" is Yes or No, and "Evidence" says what you checked.',
    "Q1 onwards: the candidate's answers to the questions, in their words.",
    'Why they fit: a few sentences in your words. Recruiter name and Agency: who sent the candidate.',
    'Never include real customer or employer data.',
    '',
    'Requirements:',
    ...pack.requirements.map((r) => `• ${r.level}: ${r.kind} — ${r.detail}. Evidence: ${r.evidence}.`),
    '',
    'Questions:',
    ...pack.questions.map((q) => `Q${q.n}. ${q.text}${q.required ? '' : ' (optional)'}`),
  ];
  lines.forEach((l, i) => {
    const c = info.getCell(i + 1, 1);
    c.value = l;
    c.alignment = { wrapText: true, vertical: 'top' };
    if (i === 0) c.font = { bold: true, size: 13 };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ───────────────────────── The recruiter PDF ─────────────────────────

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;
const NAVY = rgb(10 / 255, 33 / 255, 112 / 255);
const MUTED = rgb(0.36, 0.42, 0.47);
const REPLACE: Record<string, string> = { '→': '->', '≥': '>=', '≤': '<=', '✓': 'Yes', '×': 'x', ' ': ' ' };

/** Writes the pack top to bottom, adding pages as needed. Standard fonts only (no font files), so text is limited to WinAnsi. */
class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private header: string,
  ) {
    this.newPage();
  }
  private chars = new Set<number>();
  safe(s: string, f: PDFFont) {
    if (!this.chars.size) for (const c of f.getCharacterSet()) this.chars.add(c);
    return [...s].map((ch) => REPLACE[ch] ?? (this.chars.has(ch.codePointAt(0)!) ? ch : '?')).join('');
  }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
    this.page.drawText(this.safe(this.header, this.bold), { x: MARGIN, y: this.y, size: 10, font: this.bold, color: NAVY });
    this.y -= 8;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: A4[0] - MARGIN, y: this.y }, thickness: 1.5, color: NAVY });
    this.y -= 22;
  }
  private need(h: number) {
    if (this.y - h < MARGIN) this.newPage();
  }
  wrap(text: string, f: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of text.split('\n').map((x) => this.safe(x, f))) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) <= width || !line) line = next;
        else {
          out.push(line);
          line = word;
        }
      }
      out.push(line);
    }
    return out;
  }
  heading(text: string) {
    this.need(40);
    this.y -= 6;
    this.page.drawText(this.safe(text, this.bold), { x: MARGIN, y: this.y, size: 14, font: this.bold, color: NAVY });
    this.y -= 20;
  }
  para(text: string, o: { size?: number; muted?: boolean; bold?: boolean } = {}) {
    const size = o.size ?? 10;
    const f = o.bold ? this.bold : this.font;
    for (const l of this.wrap(text, f, size, A4[0] - 2 * MARGIN)) {
      this.need(size + 4);
      this.page.drawText(l, { x: MARGIN, y: this.y, size, font: f, color: o.muted ? MUTED : NAVY });
      this.y -= size + 4;
    }
    this.y -= 4;
  }
  /** A two-column row: a bold label on the left, wrapped text on the right. */
  row(label: string, value: string, labelWidth = 150) {
    const size = 10;
    const left = this.wrap(label, this.bold, size, labelWidth - 10);
    const right = this.wrap(value, this.font, size, A4[0] - 2 * MARGIN - labelWidth);
    const n = Math.max(left.length, right.length);
    this.need(n * (size + 4) + 4);
    for (let i = 0; i < n; i++) {
      if (left[i]) this.page.drawText(left[i]!, { x: MARGIN, y: this.y, size, font: this.bold, color: NAVY });
      if (right[i]) this.page.drawText(right[i]!, { x: MARGIN + labelWidth, y: this.y, size, font: this.font, color: NAVY });
      this.y -= size + 4;
    }
    this.y -= 4;
  }
}

/** One PDF with the four sections, and the assessment sheet embedded as a file attachment. */
export async function buildRecruiterPdf(pack: RecruiterPackDto, sheet: Buffer, now = new Date()): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const title = `ADI Forge — Recruiter pack · ${pack.projectName} · ${pack.date}`;
  doc.setTitle(title);
  doc.setAuthor('ADI Forge');
  doc.setCreator('ADI Forge');
  doc.setProducer('ADI Forge');
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold), title);

  w.para('One pack for recruitment agencies. Use it to pick the right profiles and send back one row per candidate in the attached sheet.', { muted: true });

  w.heading('1 · The role');
  w.row('Role', pack.role.title);
  w.row('Work', pack.role.work);
  w.row('Location · language', `${pack.role.location} · ${pack.role.language}`);
  w.row('Pay · effort', `${pack.role.pay} · ${pack.role.effort}`);
  w.row('People needed', pack.role.peopleNeeded === null ? 'To be confirmed' : String(pack.role.peopleNeeded));

  w.heading('2 · Requirements');
  if (!pack.requirements.length) w.para('No requirements are set for this project yet.', { muted: true });
  for (const r of pack.requirements) w.row(`${r.level} · ${r.kind}`, `${r.detail}\nEvidence to check: ${r.evidence}`);

  w.heading('3 · The task they would author (SME cheat sheet)');
  w.para(pack.cheatSheetIntro);
  for (const s of pack.cheatSheet) w.row(`${s.section} ${s.title}`, s.explanation);
  w.para('Good fits have done this work themselves: they can explain a real (anonymised) case step by step and say which rule drove each decision.', { muted: true });

  w.heading('4 · What to send back for each candidate');
  for (const s of pack.sendBack) w.row(s.item, s.detail, 190);
  w.para('Questions in the sheet:', { bold: true });
  for (const q of pack.questions) w.para(`Q${q.n}. ${q.text}${q.required ? '' : ' (optional)'}`);
  w.para('Fill in the attached sheet, one row per candidate, and send it back with any CVs. Never include real customer or employer data.', { muted: true });
  w.para(`Attached: ${pack.fileName}. If your PDF viewer hides attachments, ask for the Excel file.`, { bold: true });

  await doc.attach(sheet, pack.fileName, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    description: 'Candidate assessment sheet: one row per candidate',
    creationDate: now,
    modificationDate: now,
  });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

// ───────────────────────── Reading a filled sheet back ─────────────────────────

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return String(v.result ?? '');
    if ('error' in v) return '';
  }
  return String(v);
}

export interface SheetRow {
  row: number;
  values: Record<string, string>;
}

const norm = (h: string) => h.replace(/\*/g, '').replace(/\(gmail\)/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
export const COLUMN_KEYS = { first: 'first name', last: 'last name', email: 'email', linkedin: 'linkedin url', agency: 'agency' } as const;

/**
 * The filled sheet's rows, keyed by header text. The first sheet (or "Candidates") is read; row 1 is the header. Fails
 * with a list of missing columns when it is not the assessment sheet.
 */
export async function readAssessmentSheet(buf: Buffer, maxRows = 1000): Promise<{ headers: string[]; rows: SheetRow[] } | { error: string }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  } catch {
    return { error: 'This file could not be read as an Excel workbook.' };
  }
  const ws = wb.getWorksheet(SHEET_NAME) ?? wb.worksheets[0];
  if (!ws) return { error: 'The workbook has no sheets.' };
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  for (let c = 1; c <= Math.max(headerRow.cellCount, ws.columnCount); c++) headers.push(oneLine(cellText(headerRow.getCell(c).value)));
  const have = new Set(headers.map(norm));
  const missing = [COLUMN_KEYS.first, COLUMN_KEYS.last, COLUMN_KEYS.email].filter((k) => !have.has(k));
  if (missing.length) return { error: `This is not the candidate assessment sheet: it has no ${missing.map((m) => `"${m}"`).join(', ')} column.` };
  const rows: SheetRow[] = [];
  let tooMany = false;
  ws.eachRow({ includeEmpty: false }, (r, n) => {
    if (n === 1) return;
    const values: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (!h) return;
      const v = cellText(r.getCell(i + 1).value).trim();
      if (v) values[h] = v;
    });
    if (!Object.keys(values).length) return;
    if (rows.length >= maxRows) tooMany = true;
    else rows.push({ row: n, values });
  });
  if (tooMany) return { error: `The sheet has more than ${maxRows} candidates. Split it into smaller files.` };
  return { headers, rows };
}

/** A sheet value by its normalised column name ("first name", "email", ...). */
export function columnValue(values: Record<string, string>, key: string): string {
  for (const [h, v] of Object.entries(values)) if (norm(h) === key) return v;
  return '';
}
export const isFixedColumn = (h: string) => (Object.values(COLUMN_KEYS) as string[]).includes(norm(h));
