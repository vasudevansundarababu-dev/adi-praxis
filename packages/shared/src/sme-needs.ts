import { z } from 'zod';

/**
 * SME needs (new RL Gym part 4; docs/design/FORGE-RLGYM-V2-DESIGN.md; AUTHORING-SNAPSHOT §3.3). An author sends a need
 * to the PM from the task page; a Reviewer or the PM can raise one too. Only the PM (or an Admin) sends needs to
 * Studio's next-version inbox, merging several into one item, or rejects them, or marks them resolved. A task with an
 * open "new kind of case" need is held back from export. Every template change is a Studio release; ADI Forge only
 * sends the request.
 */

export const NEED_KINDS = ['more_data', 'new_case_kind'] as const;
export type NeedKind = (typeof NEED_KINDS)[number];
export const NEED_KIND_LABEL: Record<NeedKind, string> = { more_data: 'More data', new_case_kind: 'New edge case' };

export const RaiseNeedRequest = z.object({ kind: z.enum(NEED_KINDS), note: z.string().trim().min(1, 'Say what is needed.').max(2000) }).strict();
export type RaiseNeedRequest = z.infer<typeof RaiseNeedRequest>;

/** Console: the same, optionally about one task and from a Benchmark review item. */
export const StaffNeedRequest = RaiseNeedRequest.extend({ taskId: z.string().uuid().optional(), source: z.object({ batchId: z.string().max(200), itemId: z.string().max(200) }).strict().optional() }).strict();
export type StaffNeedRequest = z.infer<typeof StaffNeedRequest>;

export const SendNeedsRequest = z
  .object({
    needIds: z.array(z.string().uuid()).min(1).max(100).refine((ids) => new Set(ids).size === ids.length, 'List each need once.'),
    summary: z.string().trim().min(1, 'Write the summary Studio will see.').max(4000),
    neededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date (YYYY-MM-DD).').optional(),
  })
  .strict();
export type SendNeedsRequest = z.infer<typeof SendNeedsRequest>;

export const CloseNeedRequest = z.object({ reason: z.string().trim().min(1, 'Say why.').max(2000) }).strict();

export const NEED_STATES = ['open', 'sent', 'rejected', 'resolved'] as const;
export type NeedState = (typeof NEED_STATES)[number];

export const NeedDto = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  kind: z.enum(NEED_KINDS),
  note: z.string(),
  raisedBy: z.enum(['AUTHOR', 'REVIEWER', 'PM']),
  raisedByName: z.string().nullable(),
  createdAt: z.string(),
  state: z.enum(NEED_STATES),
  /** Studio's inbox item, once sent. Its later status is not visible here yet. */
  studioItemId: z.string().nullable(),
  closedReason: z.string().nullable(),
  /** A failed send of this need, when the last attempt failed. */
  lastError: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type NeedDto = z.infer<typeof NeedDto>;

/** A new-kind-of-case need holds its task back from export while it is open or sent (not rejected or resolved). */
export const holdsExport = (n: { kind: NeedKind; state: NeedState; taskId: string | null }) => n.kind === 'new_case_kind' && !!n.taskId && (n.state === 'open' || n.state === 'sent');
