import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db';
import { jointTemplateSpec } from '../anvil/joint-template';
import { declaredToolIds } from '../anvil/tool-binding';
import { aiUnavailableMessage } from '../lib/ai-errors';
import { AppError, notFound } from '../lib/errors';
import { avoidFromRules, CoachUnavailableError, ruleCheck, type CheckResult, type ExampleResult, type FieldCoachModel } from '../tasks/coach/field-coach';
import { profileFor } from '../tasks/profile-output';
import { templateRef } from '../tasks/task-service';
import { ownTask } from './work';

/**
 * D-027: POST /me/tasks/:id/fields/coach, for the SME's own task: "example" (a ready-to-adapt example and what not to
 * write) or "check" (review the SME's text). Reads the live template's form; stores nothing; decides nothing.
 */
const Body = z.object({ section: z.string().regex(/^S[1-8]$/), field: z.string().min(1).max(100), mode: z.enum(['example', 'check']), text: z.string().max(8000).optional() }).strict();

const textOf = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(textOf).filter(Boolean).join('; ') : v && typeof v === 'object' ? Object.values(v).map(textOf).filter(Boolean).join(', ') : '');

export const fieldCoachRoutes: FastifyPluginAsyncZod<{ db: Db; coach: FieldCoachModel | null }> = async (app, { db, coach }) => {
  app.post('/me/tasks/:id/fields/coach', { config: { access: 'candidate', rateLimit: { max: 40, timeWindow: '1 minute' } }, schema: { tags: ['work'], params: z.object({ id: z.string().uuid() }), body: Body } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    const template = await templateRef(db, t.project.templateId);
    const profile = profileFor({ workflowName: template.workflowName, profileId: template.profileId });
    const section = profile?.sections.find((s) => s.key === req.body.section);
    const field = section?.fields.find((f) => f.key === req.body.field);
    if (!profile || !section || !field) throw notFound('That field is not part of this task’s form.');
    const f = { section: { key: section.key, title: section.title }, field: { key: field.key, label: field.label, help: field.help, type: field.type, example: field.example, visibility: field.visibility } };
    const sections = ((t.output as { sections?: Record<string, Record<string, unknown>> } | null)?.sections ?? {}) as Record<string, Record<string, unknown>>;
    const otherSections = Object.entries(sections)
      .filter(([k]) => k !== section.key)
      .map(([k, v]) => `${k}: ${textOf(v)}`)
      .join('\n')
      .slice(0, 4000);
    const ctx = { workflow: profile.catalogWorkflowName, otherSections };

    if (req.body.mode === 'example') {
      const avoid = avoidFromRules(f, profile.catalogWorkflowName);
      if (coach) {
        try {
          const r = await coach.example(f, ctx);
          return { example: r.example, avoid: r.avoid.length ? r.avoid : avoid, source: 'model' } satisfies ExampleResult;
        } catch (err) {
          if (!(err instanceof CoachUnavailableError)) throw err;
          if (!field.example) throw new AppError(503, 'COACH_UNAVAILABLE', aiUnavailableMessage(err, 'Examples', 'Use the field’s help text to write it yourself.', 'An example could not be written just now. Use the field’s help text to write it yourself.'));
        }
      }
      if (field.example) return { example: field.example, avoid, source: 'template' } satisfies ExampleResult;
      throw new AppError(503, 'COACH_UNAVAILABLE', 'There is no ready example for this field here. Use the field’s help text to write it yourself.');
    }

    // check
    const steps = section.key === 'S5' && field.key === 'steps' ? sections.S5?.steps : undefined;
    const spec = jointTemplateSpec(t.project.template);
    const tools = spec ? declaredToolIds(spec.execution) : null;
    const text = req.body.text ?? (steps !== undefined ? textOf(steps) : textOf(sections[section.key]?.[field.key]));
    const rules = ruleCheck(f, text, steps, tools);
    const out: CheckResult = { ...rules, reviewedBy: 'rules' };
    if (coach && text.trim()) {
      try {
        const m = await coach.review(f, text, ctx);
        out.findings.push(...m.findings.map((x) => ({ kind: 'other' as const, message: `${x.issue} ${x.suggestion}`.trim() })));
        out.rewrite = m.rewrite ?? out.rewrite;
        out.reviewedBy = 'rules_and_model';
      } catch (err) {
        if (!(err instanceof CoachUnavailableError)) throw err;
        out.modelNote = aiUnavailableMessage(err, 'The AI review', 'The quick checks above still apply.', 'The AI review is not available right now. The quick checks above still apply.');
      }
    }
    return out;
  });
};
