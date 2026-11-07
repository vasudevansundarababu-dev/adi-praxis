import 'server-only';
import type {
  BlueprintResponse,
  DomainDto,
  ElicitationPresetDto,
  GenerationRunDto,
  ProjectDto,
  SmeAuthoredTaskDto,
  StudioDeploymentDto,
  TemplateDirectoryResponse,
  TemplateDto,
  VerificationRunDto,
} from '@praxis/shared';
import { apiGet, getCurrentUser } from '@/lib/api';
import type { DeploymentTarget, ModelsResponse } from './browser';
import { handleMock, type MockContext, type MockSource } from './mock-backend';
import { MC_API_MODE } from './mode';

/** Reads for the Meta-Compiler server pages. The only place (with browser.ts) that knows about the mock. */

const realSource: MockSource = {
  templates: async () => (await apiGet<{ items: TemplateDto[] }>('/templates')).data?.items ?? [],
  domains: async () => (await apiGet<{ items: DomainDto[] }>('/domains')).data?.items ?? [],
  template: async (id) => (await apiGet<TemplateDto>(`/templates/${id}`)).data,
  versions: async (id) => (await apiGet<{ items: TemplateDto[] }>(`/templates/${id}/versions`)).data?.items ?? [],
  projects: async () => (await apiGet<{ items: ProjectDto[] }>('/projects')).data?.items ?? [],
};

export async function mockContext(): Promise<MockContext> {
  const user = await getCurrentUser();
  return { roles: user?.roles ?? [], source: realSource, candidateAppUrl: process.env.CANDIDATE_APP_URL };
}

async function get<T>(path: string): Promise<{ status: number; data: T | null }> {
  if (MC_API_MODE === 'live') return apiGet<T>(path);
  const r = await handleMock('GET', path, undefined, await mockContext());
  return { status: r.status, data: r.status < 300 ? (r.body as T) : null };
}

export const mcServer = {
  directory: () => get<TemplateDirectoryResponse>('/templates/directory'),
  template: (id: string) => get<TemplateDto>(`/templates/${id}`),
  versions: (id: string) => get<{ items: TemplateDto[] }>(`/templates/${id}/versions`),
  blueprint: (id: string) => get<BlueprintResponse>(`/templates/${id}/blueprint`),
  presets: (domainId: string) => get<{ items: ElicitationPresetDto[] }>(`/domains/${domainId}/presets`),
  models: () => get<ModelsResponse>('/meta-compiler/models'),
  deploymentTargets: (id: string) => get<{ projects: DeploymentTarget[] }>(`/templates/${id}/deployment-targets`),
  deployments: (id: string) => get<{ items: StudioDeploymentDto[] }>(`/templates/${id}/deployments`),
  generation: (id: string) => get<GenerationRunDto>(`/generations/${id}`),
  verification: (id: string) => get<VerificationRunDto>(`/verifications/${id}`),
  studioTasks: () => get<{ items: SmeAuthoredTaskDto[] }>('/studio-tasks'),
};
