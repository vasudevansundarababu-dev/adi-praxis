'use client';

import type { ConversationState } from './profile-types';

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null; message: string; details: unknown };

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotent = false): Promise<Result<T>> {
  try {
    const res = await fetch(`/api/v1${path}`, {
      method,
      headers: method === 'POST' ? { 'content-type': 'application/json', ...(idempotent ? { 'idempotency-key': crypto.randomUUID() } : {}) } : {},
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: json as T };
    return { ok: false, status: res.status, code: json?.error ?? null, message: json?.message ?? `Request failed (${res.status})`, details: json?.details };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK', message: 'Could not reach the server. Your saved answers are safe; try again.', details: null };
  }
}

export const loadState = (id: string) => request<ConversationState>('GET', `/me/enrollments/${id}/conversation`);
export const startConversation = (id: string) => request<ConversationState>('POST', `/me/enrollments/${id}/conversation/start`);
export const sendMessage = (id: string, body: { clientMessageId: string; questionId: string | null; content?: string; quickReply?: string; expectedRevision: number }) =>
  request<ConversationState>('POST', `/me/enrollments/${id}/conversation/messages`, body);
export const retryMessage = (id: string, clientMessageId: string) => request<ConversationState>('POST', `/me/enrollments/${id}/conversation/messages/${clientMessageId}/retry`);
export const correct = (enrollmentId: string, expectedRevision: number, changes: { fields?: unknown[]; roles?: unknown[]; claims?: unknown[] }) =>
  request<ConversationState>('POST', '/me/profile/corrections', { enrollmentId, expectedRevision, fields: [], roles: [], claims: [], ...changes }, true);
export const submitProfile = (id: string, body: { expectedRevision: number; confirmAccuracy: true; evidencePermission: true; futureOpportunities: boolean }) =>
  request<ConversationState>('POST', `/me/enrollments/${id}/submit`, body, true);
