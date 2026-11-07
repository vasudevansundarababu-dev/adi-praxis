'use client';

import type {
  BlueprintResponse,
  CustomField,
  GenerationRunDto,
  HarborBlueprint,
  SmeAuthoredTaskDto,
  StudioDeploymentDto,
  VerificationRunDto,
} from '@praxis/shared';
import { MC_BROWSER_BASE } from './mode';

/** Browser calls for the Meta-Compiler (architecture §5). Mutations carry a fresh Idempotency-Key. */

export interface McResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  code: string | null;
}

export type ModelOption = { provider: 'claude' | 'gemini' | 'mock'; model: string; label: string; available: boolean };
export type ProposeFieldResult = {
  proposal: CustomField | null;
  problems: string[];
  provider: 'claude' | 'gemini' | 'mock';
  model: string;
  costUsd: number;
  unavailableReason: string | null;
};
export type ModelsResponse = { items: ModelOption[]; liveAi: boolean; codegenEnabled: boolean };
export type DeploymentTarget = { id: string; name: string; templateVersion: number; smes: Array<{ candidateId: string; displayName: string | null; email: string | null }> };
export type StudioTaskDetail = SmeAuthoredTaskDto & { taskJson: unknown };

async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, idempotencyKey?: string): Promise<McResult<T>> {
  try {
    const res = await fetch(`${MC_BROWSER_BASE}${path}`, {
      method,
      headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'idempotency-key': idempotencyKey ?? crypto.randomUUID() },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => null)) as (T & { message?: string; error?: string }) | null;
    return { ok: res.ok, status: res.status, data: res.ok ? json : null, error: res.ok ? null : (json?.message ?? `Request failed (${res.status})`), code: res.ok ? null : (json?.error ?? null) };
  } catch {
    return { ok: false, status: 0, data: null, error: 'Could not reach the server. Check your connection and try again.', code: null };
  }
}

export const mcBrowser = {
  blueprint: (id: string) => call<BlueprintResponse>('GET', `/templates/${id}/blueprint`),
  saveBlueprint: (id: string, blueprint: HarborBlueprint, expectedRevision: number) => call<BlueprintResponse>('PUT', `/templates/${id}/blueprint`, { blueprint, expectedRevision }),
  saveVariant: (id: string, label: string) => call<{ templateId: string; lineageId: string; version: 1; variantOfId: string }>('POST', `/templates/${id}/variant`, { label }),
  uiSpecUrl: (id: string) => `${MC_BROWSER_BASE}/templates/${id}/uispec`,
  proposeField: (id: string, stage: string, prompt: string) => call<ProposeFieldResult>('POST', `/templates/${id}/assistant/propose-field`, { stage, prompt }),
  models: () => call<ModelsResponse>('GET', '/meta-compiler/models'),
  startGeneration: (id: string, provider: string, model: string, key: string) => call<GenerationRunDto>('POST', `/templates/${id}/generations`, { provider, model, mode: 'BLUEPRINT' }, key),
  generation: (id: string) => call<GenerationRunDto>('GET', `/generations/${id}`),
  startVerification: (generationId: string, key: string) => call<VerificationRunDto>('POST', `/generations/${generationId}/verifications`, {}, key),
  verification: (id: string) => call<VerificationRunDto>('GET', `/verifications/${id}`),
  deploy: (id: string, body: { verificationRunId: string; projectId: string; smeCandidateId: string }, key: string) => call<StudioDeploymentDto>('POST', `/templates/${id}/deployments`, body, key),
  deployments: (id: string) => call<{ items: StudioDeploymentDto[] }>('GET', `/templates/${id}/deployments`),
  studioTask: (id: string) => call<StudioTaskDetail>('GET', `/studio-tasks/${id}`),
  bundleUrl: (id: string) => `${MC_BROWSER_BASE}/studio-tasks/${id}/bundle`,
  exportUrl: () => `${MC_BROWSER_BASE}/studio-tasks/export`,
};
