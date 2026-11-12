import { isUploadedProfile, profileById, registerUploadedProfile } from '@praxis/shared';
import type { Db } from '../db';

/**
 * Uploaded authoring forms (golden task packs, owner 12 Nov 2026) live in the database and are registered in the
 * shared profile registry of each API instance: at start, after an upload, and every minute (other instances).
 */
export async function loadUploadedProfiles(db: Db): Promise<{ loaded: number; problems: string[] }> {
  const rows = await db.uploadedProfile.findMany({ orderBy: { createdAt: 'asc' }, select: { profileId: true, profile: true } });
  const problems: string[] = [];
  let loaded = 0;
  for (const r of rows) {
    if (profileById(r.profileId)) {
      loaded++;
      continue;
    }
    const p = registerUploadedProfile(r.profile);
    if (p.length) problems.push(`${r.profileId}: ${p.join('; ')}`);
    else loaded++;
  }
  return { loaded, problems };
}

/** A form ID is taken by a built-in form or by any stored pack (IDs are never reused). */
export async function profileIdTaken(db: Db, id: string): Promise<boolean> {
  if (profileById(id) && !isUploadedProfile(id)) return true;
  return (await db.uploadedProfile.count({ where: { profileId: id } })) > 0;
}
