import { KYC_TOOLS } from '@praxis/shared';

/**
 * The in-workbench AI interview (docs/TASK-DRAFTING.md section 2): up to eight short questions, tap-to-answer where
 * possible, built from the task's slot. The questions are fixed so every expert gets the same, predictable interview;
 * the model's work is the draft made from the answers.
 */
export interface InterviewQuestion {
  id: string;
  text: string;
  /** Tap options; `multi` allows several. Free text is always allowed alongside. */
  options: string[];
  multi: boolean;
  required: boolean;
  /** What the answer is used for, shown under "Why we ask". */
  why: string;
}

export interface SlotBrief {
  brief: string;
  edgeCase: string | null;
  isOpen: boolean;
  tags: Record<string, string>;
}

const RED_FLAGS = ['Expired or missing document', 'Name or date mismatch', 'Stale registry filing', 'Ownership does not add up', 'Screening near match', 'Virtual office address', 'Unexplained source of funds', 'Nominee or proxy'];

export function interviewQuestions(slot: SlotBrief | null): InterviewQuestion[] {
  const edge = slot?.edgeCase ?? null;
  const flags = edge ? [edge, ...RED_FLAGS.filter((f) => f.toLowerCase() !== edge.toLowerCase())] : RED_FLAGS;
  return [
    {
      id: 'case',
      text: `Describe the kind of case this task should be about, in a few sentences: the customer, what they wanted and what made it tricky.${slot?.brief ? ` Your slot: ${slot.brief}.` : ''} Describe the pattern, never a real customer.`,
      options: [],
      multi: false,
      required: true,
      why: 'Sets the scenario and customer file (W02). Names and details are replaced with invented ones.',
    },
    { id: 'trigger', text: 'Is this a new onboarding or a periodic refresh?', options: ['New onboarding', 'Periodic refresh'], multi: false, required: true, why: 'Sets the trigger in the scenario (W02).' },
    {
      id: 'red_flags',
      text: `What was wrong or missing in the documents or data? Tap all that apply${edge ? `; your slot needs “${edge}”` : ''}, and add anything else.`,
      options: flags,
      multi: true,
      required: true,
      why: 'Becomes the evidence with its deliberate defects (W03) and the findings (W04).',
    },
    {
      id: 'tools',
      text: 'Which checks would you run? Tap them in the order you would run them.',
      options: KYC_TOOLS.map((t) => t.label),
      multi: true,
      required: true,
      why: 'Becomes the tools, the recorded tool calls (W03) and the order of the reference steps (W04).',
    },
    { id: 'ambiguous', text: 'Which result was ambiguous or easy to misread, and how would you resolve it?', options: [], multi: false, required: true, why: 'Makes the task hard in the right place: a near match, a stale filing, a partial document (W03, W04).' },
    {
      id: 'outcome',
      text: 'What is the right outcome for the agent to recommend?',
      options: ['Recommend approve (with sign-off)', 'Recommend reject (with sign-off)', 'Request more information', 'Escalate'],
      multi: false,
      required: true,
      why: 'Sets the disposition and the hand-off to a person (W04). The agent never approves or rejects on its own.',
    },
    { id: 'risk', text: 'What risk rating would you give?', options: ['Low', 'Medium', 'High'], multi: false, required: true, why: 'Sets the risk rating and factors (W04).' },
    { id: 'junior_mistake', text: 'What would a junior analyst typically miss or get wrong on this case?', options: [], multi: false, required: true, why: 'Becomes the common errors and the critical rubric criteria that catch them (W05).' },
  ];
}

export interface InterviewAnswer {
  questionId: string;
  question: string;
  answer: string;
}

/** The next unanswered question, or null when the interview is complete. */
export function nextQuestion(questions: InterviewQuestion[], answered: Set<string>): InterviewQuestion | null {
  return questions.find((q) => !answered.has(q.id)) ?? null;
}
