import type { DemographicAttributeDto } from '@praxis/shared';
import type { Metadata } from 'next';
import { NewAttributeForm } from '@/components/taxonomy/new-attribute-form';
import { apiGet, getCurrentUser } from '@/lib/api';
import { NoAccess } from '@/components/no-access';

export const metadata: Metadata = { title: 'Demographic taxonomy' };

function describe(a: DemographicAttributeDto): string {
  const v = a.allowedValues as Record<string, unknown> | unknown[];
  switch (a.type) {
    case 'SINGLE_SELECT':
    case 'MULTI_SELECT':
      return `${(v as unknown[]).length} values`;
    case 'NUMBER_RANGE': {
      const r = v as { min: number; max: number; unit: string };
      return `${r.min}–${r.max} ${r.unit}`;
    }
    case 'GEO_RADIUS':
      return `up to ${(v as { maxRadiusKm: number }).maxRadiusKm} km`;
    case 'LANGUAGE_PROFICIENCY': {
      const l = v as { languages: unknown[]; levels: unknown[] };
      return `${l.languages.length} languages, ${l.levels.length} levels`;
    }
  }
}

const TYPE_LABELS = {
  SINGLE_SELECT: 'Single choice',
  MULTI_SELECT: 'Multiple choice',
  NUMBER_RANGE: 'Number range',
  GEO_RADIUS: 'City and radius',
  LANGUAGE_PROFICIENCY: 'Language and level',
} as const;

export default async function TaxonomyPage() {
  const user = (await getCurrentUser())!;
  if (!user.roles.includes('ADMIN')) return <NoAccess need="Admins" />;
  const { data } = await apiGet<{ items: DemographicAttributeDto[] }>('/demographic-attributes');
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Demographic taxonomy</h1>
      <p className="mt-1 text-sm text-fg-muted">The filters PMs can set on a project in step 4 of the wizard.</p>
      <div className="mt-6 overflow-x-auto card">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface">
            <tr>
              <th className="px-4 py-2 font-medium">Attribute</th>
              <th className="px-4 py-2 font-medium">Key</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Allowed values</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="px-4 py-2">{a.label}</td>
                <td className="px-4 py-2 font-mono text-xs">{a.key}</td>
                <td className="px-4 py-2">{TYPE_LABELS[a.type]}</td>
                <td className="px-4 py-2">{describe(a)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <NewAttributeForm />
    </div>
  );
}
