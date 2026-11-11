import type { ExportStatusView, TaskCheck } from '@praxis/shared';

export interface TaskSummary {
  id: string;
  status: 'CREATED' | 'ASSIGNED' | 'IN_PROGRESS' | 'SUBMITTED' | 'ACCEPTED' | 'REWORK' | 'REJECTED';
  taskType: 'AUTHORING' | 'ANNOTATION';
  brief: string | null;
  isOpenSlot: boolean;
  assignedAt: string | null;
  submittedAt: string | null;
  activeSeconds: number;
  revision: number;
}

export interface ProjectView {
  project: { id: string; name: string; status: string; taskMode: 'AUTHORING' | 'ANNOTATION'; tptMinutes: number | null; workflow: string; humanGate: string | null };
  tasks: TaskSummary[];
  limits: { openCap: number; open: number; perExpertCap: number | null; used: number };
  canPull: boolean;
}

export interface OutstandingStep {
  error: 'OUTSTANDING_STEP';
  message: string;
  details: { step: string; message: string; href: string | null };
}

export interface SlotInput {
  id: string;
  brief: string;
  tags: Record<string, string>;
  edgeCase: string | null;
  isOpen: boolean;
}

export interface TaskView extends TaskSummary {
  authoringExperience?: 'CLASSIC'|'CHATBOT'|'BOTH'|null;
  effectiveAuthoringExperience?: 'CLASSIC'|'CHATBOT'|'BOTH';
  /** Authoring v2.1: fixed by the template, read-only here. */
  agentMode?: 'SINGLE' | 'MULTI';
  reviewRoute?: 'SME_PM' | 'SME_EXPERT_PM';
  phase?: import('@praxis/shared').TaskPhaseView;
  startingGraph?: import('@praxis/shared').WorkflowGraphInput | null;
  authoringWorkspace?: {view:'CLASSIC'|'CHATBOT';answer:string}|null;
  projectId: string;
  projectName: string;
  tptMinutes: number | null;
  definition: string;
  template: {
    workflow: string;
    domain: string;
    primaryWork: string | null;
    verificationCriteria: string | null;
    humanGate: string | null;
    coverageDimensions: { key: string; label: string; values: string[] }[];
    edgeCases: string[];
    collectionSchema: { properties?: Record<string, { type?: string; title?: string; enum?: string[]; description?: string }>; required?: string[] } | null;
  };
  input: { slot?: SlotInput } & Record<string, unknown>;
  output: Record<string, unknown> | null;
  coverageTags: { tags: Record<string, string>; edgeCase: string | null } | null;
  checks: TaskCheck[] | null;
  /** Anvil export readiness of a template-profile task, compiled at submission. */
  exportStatus?: ExportStatusView | null;
  readOnly: boolean;
  review: { decision: string; comments: { section: string; text: string }[]; notes: string | null; rejectReason: string | null; at: string } | null;
}

export interface DataFlag {
  id: string;
  kind: string;
  path: string;
  excerpt: string;
}

export interface CheckResult {
  checks: TaskCheck[];
  flags: DataFlag[];
  similar: { brief: string | null; score: number; flagged: boolean }[];
}

export const TASK_STATUS: Record<TaskSummary['status'], string> = {
  CREATED: 'Queued',
  ASSIGNED: 'Not started',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted · awaiting review',
  ACCEPTED: 'Accepted',
  REWORK: 'Changes requested',
  REJECTED: 'Not accepted',
};

export const minutes = (seconds: number) => Math.round(seconds / 60);
