import type { AuthoringExperience } from '@prisma/client';
import { AppError } from '../lib/errors';
export const experienceOf = (p: {authoringExperience?: AuthoringExperience | null}) => p.authoringExperience ?? 'BOTH';
export function allowEditor(p: {authoringExperience?: AuthoringExperience | null}, editor: 'CLASSIC' | 'CHATBOT') {
  if (experienceOf(p) !== 'BOTH' && experienceOf(p) !== editor) throw new AppError(403,'AUTHORING_VIEW_DISABLED',`${editor === 'CLASSIC' ? 'Classic' : 'Chatbot'} authoring is not enabled for this project.`);
}
