import type { DomainDto, ProjectDto, TemplateDto } from '@praxis/shared';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MockContext, MockSource } from '@/lib/mc/mock-backend';

export const html = (el: ReactElement) => renderToStaticMarkup(el);

/** Visible text with tags stripped and whitespace collapsed. */
export const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export const DOMAIN_MKTG = '11111111-1111-4111-8111-111111111111';
export const DOMAIN_BANK = '22222222-2222-4222-8222-222222222222';
export const DOMAIN_EMPTY = '33333333-3333-4333-8333-333333333333';

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

export function template(over: Partial<TemplateDto> = {}): TemplateDto {
  const id = over.id ?? uuid();
  return {
    id,
    lineageId: uuid(),
    version: 1,
    status: 'DRAFT',
    domainId: DOMAIN_MKTG,
    domainName: 'Digital Marketing',
    workflowName: 'Launch of Noise Cancelling Phone',
    primaryWork: 'Synthetic launch plan.',
    verificationCriteria: 'Oracle keyword table.',
    humanGate: 'Reviewer checks.',
    taskDefinitionSchema: {},
    collectionSchema: {},
    defaultTptMinutes: 45,
    skills: ['Marketing'],
    taskModes: ['AUTHORING'],
    coverageDimensions: { dimensions: [], cells: [] },
    edgeCaseCatalog: [],
    defaultDistinctTarget: 50,
    defaultMaxPerExpert: 4,
    openSlotShare: 0,
    similarityThreshold: 0.9,
    profileId: null,
    publishedAt: null,
    retiredAt: null,
    createdAt: '2026-11-07T10:00:00.000Z',
    updatedAt: '2026-11-07T10:00:00.000Z',
    ...over,
  };
}

export function project(over: Partial<ProjectDto> = {}): ProjectDto {
  return {
    id: uuid(),
    status: 'STAFFING',
    name: 'SYNTHETIC Launch pilot',
    description: null,
    ownerId: uuid(),
    ownerName: 'PM',
    templateId: uuid(),
    templateVersion: 1,
    workflowName: 'Launch',
    domainName: 'Digital Marketing',
    taskMode: 'AUTHORING',
    taskCount: null,
    distinctTarget: 8,
    maxPerExpert: 4,
    coverageQuotas: null,
    tptMinutes: 45,
    hoursPerWorkerDay: 4,
    startDate: null,
    endDate: null,
    requiredWorkers: 2,
    demographicFilters: [],
    jobDescriptionId: null,
    reviewerJobDescriptionId: null,
    jdGenerated: false,
    jdSnapshotId: null,
    jdSnapshot: null,
    demographicsSnapshot: null,
    autoLaunchCampaign: false,
    submittedAt: null,
    createdAt: '2026-11-07T10:00:00.000Z',
    updatedAt: '2026-11-07T10:00:00.000Z',
    ...over,
  };
}

export function fixtureSource(templates: TemplateDto[], projects: ProjectDto[] = []): MockSource {
  const domains: DomainDto[] = [
    { id: DOMAIN_MKTG, name: 'Digital Marketing', status: 'ACTIVE' },
    { id: DOMAIN_BANK, name: 'Banking', status: 'ACTIVE' },
    { id: DOMAIN_EMPTY, name: 'Healthcare', status: 'ACTIVE' },
  ];
  return {
    templates: async () => templates,
    domains: async () => domains,
    template: async (id) => templates.find((t) => t.id === id) ?? null,
    versions: async (id) => templates.filter((t) => t.lineageId === templates.find((x) => x.id === id)?.lineageId),
    projects: async () => projects,
  };
}

export const ctx = (roles: string[], source: MockSource, now?: () => number): MockContext => ({ roles, source, now, candidateAppUrl: 'http://localhost:3131' });
