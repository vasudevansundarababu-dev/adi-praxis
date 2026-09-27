import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Candidate' };

interface Candidate {
  id: string;
  name: string;
  identityVerified: boolean;
  specialties: string[];
  skills: string[];
  jurisdictions: string[];
  country: string | null;
  city: string | null;
  languages: { language: string; level: string }[];
  domainExperienceYears: number | null;
  educationLevel: string | null;
  hoursPerWeek: number | null;
  timezone: string | null;
  lastValidatedAt: string | null;
  activeProjects: number;
  concurrentProjectLimit: number;
}

/** "View profile": the candidate's matching record only (no identity documents, evidence or transcripts). */
export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { data: c } = await apiGet<Candidate>(`/candidates/${(await params).id}`);
  if (!c) notFound();
  const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
  const rows: [string, string][] = [
    ['Identity', c.identityVerified ? 'Identity verified' : 'Identity not verified'],
    ['Specialties', c.specialties.join(', ') || '—'],
    ['Skills', c.skills.join(', ') || '—'],
    ['Jurisdictions', c.jurisdictions.join(', ') || '—'],
    ['Location', [c.city, c.country].filter(Boolean).join(', ') || '—'],
    ['Languages', c.languages.map((l) => `${l.language} ${l.level}`).join(', ') || '—'],
    ['Domain experience', c.domainExperienceYears === null ? '—' : `${c.domainExperienceYears} years`],
    ['Education', dash(c.educationLevel)],
    ['Availability', c.hoursPerWeek === null ? '—' : `${c.hoursPerWeek} h/week${c.timezone ? `, ${c.timezone}` : ''}`],
    ['Projects', `${c.activeProjects} active of ${c.concurrentProjectLimit} allowed`],
    ['Last validated', c.lastValidatedAt ? new Date(c.lastValidatedAt).toLocaleDateString() : '—'],
  ];
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">{c.name}</h1>
      <p className="mt-1 text-sm text-fg-muted">Matching profile. Claims are as confirmed by the candidate; badges are scoped to what was checked.</p>
      <dl className="mt-6 card divide-y divide-line text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-2 px-4 py-2 sm:grid-cols-[10rem_1fr]">
            <dt className="font-medium text-fg-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
