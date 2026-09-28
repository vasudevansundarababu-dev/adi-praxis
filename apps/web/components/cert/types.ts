import type { SmeTier } from '@praxis/shared';

/** Response shapes of apps/api/src/routes/cert-admin.ts. */

export interface GenerationRunRow {
  id: string;
  scope: string;
  target: { tier?: SmeTier; familyId?: string } | null;
  stage: string;
  status: string;
  model: string | null;
  promptVersions: Record<string, string> | null;
  cost: { calls?: number; inputTokens?: number; outputTokens?: number; bulkModel?: string } | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface KnowledgeRow {
  id: string;
  kind: string;
  text: string;
  citation: string;
  critical: boolean;
  status: 'DRAFT' | 'APPROVED' | 'REJECTED';
}

export interface TierReadiness {
  tier: SmeTier;
  tierLabel: string;
  published: boolean;
  course: { id: string; status: string; modules: number } | null;
  blueprint: { id: string; status: string; itemCount: number; timeLimitMinutes: number; families: number; approvedFamilies: number; flaggedFamilies: number } | null;
  readyToPublish: boolean;
  missing: string[];
}

export interface VersionDetail {
  id: string;
  package: { id: string; domain: string; taskFamily: string; name: string };
  version: number;
  major: boolean;
  status: string;
  fileName: string;
  sha256: string;
  sections: { anchor: string; heading: string; text: string }[];
  runs: GenerationRunRow[];
  knowledge: KnowledgeRow[];
  tiers: TierReadiness[];
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  feedback: string;
  citation: string;
}

export interface CourseDetail {
  id: string;
  versionId: string;
  tier: SmeTier;
  title: string;
  status: string;
  model: string | null;
  promptVersion: string | null;
  approvedAt: string | null;
  modules: {
    id: string;
    position: number;
    title: string;
    explanation: string;
    goodExamples: string[];
    badExamples: string[];
    quiz: QuizQuestion[];
    practice: { prompt: string; answer: string; feedback: string }[];
    citations: string[];
  }[];
}

export interface PassRulesDto {
  overallPct: number;
  plantedErrorsPct: number | null;
  noCriticalMiss: boolean;
  writtenPassScore: number;
  confirmationsRequired: number;
  objectiveOnlyOverall: boolean;
}

export interface Competency {
  key: string;
  name: string;
  weight: number;
  citations: string[];
}

export interface SampleValidation {
  rule: boolean;
  solver: boolean;
  citation: boolean;
  difficulty: boolean;
  estimatedDifficulty?: number;
  nearCopy?: boolean;
  model?: string;
  attempt?: number;
}

export interface FamilyDto {
  id: string;
  competency: string;
  difficultyMin: number;
  difficultyMax: number;
  cognitiveLevel: string;
  itemType: string;
  stemPattern: string;
  variableSchema: unknown;
  answerRule: unknown;
  options: string[];
  distractorRationale: string;
  citation: string;
  critical: boolean;
  status: string;
  approvals: { userId: string; role: string; at?: string }[] | null;
  stats: { served?: number; correct?: number; validationFailures?: number; consecutiveFailures?: number } | null;
  samples: {
    id: string;
    stem: string;
    content: { options?: string[]; steps?: { id: string; text: string }[]; rubric?: { criterion: string; weight: number }[] } | null;
    variables: Record<string, unknown>;
    key: string | string[] | null;
    validation: SampleValidation | null;
    createdAt: string;
  }[];
}

export interface BlueprintDetail {
  id: string;
  versionId: string;
  tier: SmeTier;
  status: string;
  competencies: Competency[];
  itemCount: number;
  authoringTask: boolean;
  timeLimitMinutes: number;
  passRules: PassRulesDto;
  families: FamilyDto[];
}
