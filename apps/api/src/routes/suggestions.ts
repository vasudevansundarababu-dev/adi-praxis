import { ClearSuggestionRequest, ConfirmSectionRequest, SuggestRequest, UseSuggestionsRequest, provenanceSummary, sectionDigest } from '@praxis/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db, Tx } from '../db';
import { AppError } from '../lib/errors';
import { runCandidateCommand } from '../platform/command';
import type { SelectionGate } from '../staffing/selection-gate';
import type { FieldSuggester } from '../tasks/suggestions/assistant';
import { draftingWithSuggestions, generateSuggestions, recordUse, sectionsProfile, suggestionStateOf } from '../tasks/suggestions/service';
import { outstanding, ownTask, workContext } from './work';

const IdParams = z.object({ id: z.string().uuid() });

/**
 * Suggested text for every field, provenance and per-section confirmation (owner decisions 1-6, 15 Nov 2026). Registered
 * only with FIELD_SUGGESTIONS_ENABLED. Writes are the task author's, while the task is editable, through commands
 * (authorised, idempotent, audited). Suggestions never change the task: the author's form saves through autosave.
 */
export const suggestionRoutes: FastifyPluginAsyncZod<{ db: Db; selectionGate: SelectionGate; suggester: FieldSuggester }> = async (app, { db, selectionGate, suggester }) => {
  async function editable(tx: Tx, taskId: string, smeUserId: string, lock = true) {
    if (lock) await tx.$executeRaw`SELECT 1 FROM "TaskInstance" WHERE id = ${taskId}::uuid FOR UPDATE`;
    const t = await ownTask(tx, taskId, smeUserId);
    const w = await workContext(tx, selectionGate, smeUserId, t.projectId);
    if (!w.ok) outstanding(w);
    if (t.taskType !== 'AUTHORING' || !['ASSIGNED', 'IN_PROGRESS', 'REWORK'].includes(t.status) || t.quarantinedAt) throw new AppError(409, 'READ_ONLY', 'This task is read-only now.');
    const profile = sectionsProfile(t);
    if (!profile) throw new AppError(404, 'NO_FORM', 'This task’s form has no suggestions.');
    return { t, profile };
  }
  const save = (tx: Tx, t: { id: string; drafting: unknown }, state: ReturnType<typeof suggestionStateOf>) =>
    tx.taskInstance.update({ where: { id: t.id }, data: { drafting: JSON.parse(JSON.stringify(draftingWithSuggestions(t as never, state))) as Prisma.InputJsonValue } });

  app.get('/me/tasks/:id/suggestions', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    const profile = sectionsProfile(t);
    if (!profile) throw new AppError(404, 'NO_FORM', 'This task’s form has no suggestions.');
    const state = suggestionStateOf(t);
    const selector = (t.input as { slot?: { case?: { source?: string } } } | null)?.slot?.case?.source ?? null;
    return { state, summary: provenanceSummary(profile, t.output ?? {}, state, selector) };
  });

  // Suggestions for a section's empty fields. Shown again from storage unless the author asks for new ones.
  app.post('/me/tasks/:id/suggestions', { config: { access: 'candidate', rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['work'], params: IdParams, body: SuggestRequest } }, async (req, reply) => {
    // Suggestions already shown for this section are returned as they are: a read, no model call, no state change.
    if (!req.body.again && !req.body.keys?.length) {
      const kept = suggestionStateOf(await ownTask(db, req.params.id, req.candidate!.smeUserId)).offered?.[req.body.section];
      if (kept) return reply.send(kept);
    }
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const { t } = await editable(tx, req.params.id, actor.smeUserId, false);
      // The model call runs before the row is locked; the result is merged into the latest state.
      const fresh = await generateSuggestions(tx, t, req.body, suggester);
      await tx.$executeRaw`SELECT 1 FROM "TaskInstance" WHERE id = ${t.id}::uuid FOR UPDATE`;
      const now = await ownTask(tx, t.id, actor.smeUserId);
      const state = suggestionStateOf(now);
      const prev = state.offered?.[req.body.section];
      // Asking for specific fields keeps the other fields' current suggestions.
      const merged = req.body.keys?.length && prev ? { ...fresh, items: [...prev.items.filter((i) => !fresh.items.some((f) => f.key === i.key)), ...fresh.items] } : fresh;
      state.offered = { ...(state.offered ?? {}), [req.body.section]: merged };
      await save(tx, now, state);
      await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.suggestions.generated', after: { section: req.body.section, fields: fresh.items.map((i) => i.key), model: fresh.model, again: !!req.body.again } });
      return { status: 200, body: merged };
    });
    return reply;
  });

  // The author took these suggestions (the form saves the text itself through autosave).
  app.post('/me/tasks/:id/suggestions/use', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams, body: UseSuggestionsRequest } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const { t } = await editable(tx, req.params.id, actor.smeUserId);
      const state = suggestionStateOf(t);
      const keys = recordUse(state, req.body.section, req.body.items);
      await save(tx, t, state);
      await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.suggestion.used', after: { section: req.body.section, fields: keys } });
      return { status: 200, body: { state } };
    });
    return reply;
  });

  // The author undid a suggestion: the field is theirs again.
  app.post('/me/tasks/:id/suggestions/clear', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams, body: ClearSuggestionRequest } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const { t } = await editable(tx, req.params.id, actor.smeUserId);
      const state = suggestionStateOf(t);
      const path = `${req.body.section}.${req.body.key}`;
      const had = !!state.used[path];
      delete state.used[path];
      await save(tx, t, state);
      await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.suggestion.cleared', after: { section: req.body.section, field: req.body.key, had } });
      return { status: 200, body: { state } };
    });
    return reply;
  });

  // "I've read every field in this section, and it describes how this work is actually done." Bound to the saved content.
  app.post('/me/tasks/:id/suggestions/confirm', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams, body: ConfirmSectionRequest } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const { t, profile } = await editable(tx, req.params.id, actor.smeUserId);
      if (!profile.sections.some((s) => s.key === req.body.section)) throw new AppError(404, 'NO_SECTION', 'This section is not on this form.');
      const state = suggestionStateOf(t);
      const digest = sectionDigest(profile, t.output ?? {}, req.body.section);
      if (req.body.confirmed) {
        if (digest !== req.body.digest) throw new AppError(409, 'SECTION_NOT_SAVED', 'Your latest changes in this section are not saved yet. Save, then confirm again.');
        state.confirmed[req.body.section] = { digest, at: new Date().toISOString(), smeUserId: actor.smeUserId };
      } else delete state.confirmed[req.body.section];
      await save(tx, t, state);
      await audit({ entityType: 'TaskInstance', entityId: t.id, action: req.body.confirmed ? 'task.section.confirmed' : 'task.section.unconfirmed', after: { section: req.body.section, digest } });
      return { status: 200, body: { state } };
    });
    return reply;
  });
};
