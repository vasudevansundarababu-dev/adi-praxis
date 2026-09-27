import type { ProfileData, Readiness } from '@praxis/shared';

/** GET /me/enrollments/{id}/conversation */
export interface ConversationState {
  enrollment: { id: string; status: string; submittedAt: string | null; opportunityId: string; title: string; version: number };
  session: { status: string; revision: number } | null;
  editable: boolean;
  turns: { id: string; clientMessageId: string; speaker: 'CANDIDATE' | 'ASSISTANT' | 'SYSTEM'; content: string; questionId: string | null; redacted: boolean; extractionStatus: string; createdAt: string }[];
  nextQuestion: { id: string; text: string; why: string; answerType: string; options: string[]; required: boolean; section: string; sensitive: boolean } | null;
  questions: { id: string; section: string; text: string; why: string; fields: string[]; answerType: string; options: string[]; required: boolean; covered: boolean }[];
  profile: ProfileData;
  fieldLabels: Record<string, string>;
  durations: {
    domain: { months: number; years: number; approximate: boolean; overlapsMerged: boolean; basis: string[] };
    specialty: { months: number; years: number; approximate: boolean; overlapsMerged: boolean; basis: string[] };
    undated: string[];
  };
  readiness: Readiness;
  evidence: { id: string; filename: string; mimeType: string; sizeBytes: number; scanStatus: string; createdAt: string }[];
}
