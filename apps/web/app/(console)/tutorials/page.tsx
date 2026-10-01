import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { GuideCard, RecordingNote, VideoGrid } from '@/components/tutorials/tutorials';
import { getCurrentUser } from '@/lib/api';
import { TUTORIAL_GUIDES, videosForRoles } from '@/lib/tutorials';

export const metadata: Metadata = { title: 'Tutorials' };

export default async function TutorialsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { mine, others } = videosForRoles(user.roles);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Tutorials and user guide</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">
          Short captioned videos that follow one story through ADI Praxis, and the user guide with every screen step by step. Start with the videos for your role.
        </p>
      </div>
      <GuideCard {...TUTORIAL_GUIDES.staff} />
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">For your role</h2>
        <VideoGrid videos={mine} label="Videos for your role" />
      </div>
      {others.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Other roles</h2>
          <VideoGrid videos={others} label="Videos for other roles" />
        </div>
      )}
      <RecordingNote />
    </div>
  );
}
