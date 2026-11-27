import type { FixField } from './fix-logic';

/**
 * Owner and Jose, 27 Nov 2026: the answer box under an open question on the rule page. Pure helpers for the panel and
 * its tests (no 'use client').
 */
export interface ProposedChangeDto {
  field: string;
  before: string;
  after: string;
  reason: string;
}
export interface AnswerDto {
  id: string;
  ruleVersionId: string;
  question: string;
  answer: string;
  answeredBy: string;
  answeredAt: string;
  aiStatus: 'none' | 'proposed' | 'unmapped' | 'failed' | 'paused' | string;
  aiMessage: string | null;
  changes: ProposedChangeDto[];
  costUsd: number | null;
  accepted: string[];
}
export interface RuleAids {
  fieldLinks: boolean;
  aiAnswer: boolean;
  aiPaused: boolean;
}

/** Plain names for the fields a proposal can change. */
export const ANSWER_FIELD_LABEL: Record<string, string> = {
  kind: 'Kind',
  issuer: 'Issuer',
  jurisdiction: 'Jurisdiction',
  subject: 'Evaluated for',
  process: 'Process',
  customer_types: 'Customer types',
  product_lines: 'Product lines',
  channels: 'Channels',
  condition: 'When it applies',
  effective_from: 'In force from',
};

/** The rule-page field a proposed change is shown at ("Show field"). */
export const ANSWER_FIELD_TARGET: Record<string, FixField> = {
  kind: 'kind',
  issuer: 'issuer',
  jurisdiction: 'jurisdiction',
  subject: 'subject',
  process: 'process',
  customer_types: 'process',
  product_lines: 'process',
  channels: 'process',
  condition: 'condition',
  effective_from: 'effective',
};

/** The answers given to one question (newest first). */
export const answersTo = (answers: readonly AnswerDto[], question: string) => answers.filter((a) => a.question.trim() === question.trim());

/** The changes of an answer still waiting for a decision (not accepted yet, not rejected in this session). */
export const openChanges = (a: AnswerDto, rejected: ReadonlySet<string>) => a.changes.filter((c) => !a.accepted.includes(c.field) && !rejected.has(`${a.id}:${c.field}`));

export const PAUSED_TEXT = 'AI answers are paused for today (budget reached)';
