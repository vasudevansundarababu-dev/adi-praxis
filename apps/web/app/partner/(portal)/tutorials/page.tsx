import { tutorialsEnabled } from '@praxis/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { GuideCard, RecordingNote, VideoGrid } from '@/components/tutorials/tutorials';
import { TUTORIAL_GUIDES, TUTORIAL_VIDEOS } from '@/lib/tutorials';

export const metadata: Metadata = { title: 'Tutorials' };

export default function PartnerTutorialsPage() {
  // Owner, 27 Nov 2026: hidden while TUTORIALS_ENABLED is off.
  if (!tutorialsEnabled()) redirect('/partner');
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Tutorials and partner guide</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">How to put candidates forward and follow their progress, in a short video and a written guide.</p>
      </div>
      <GuideCard {...TUTORIAL_GUIDES.partner} />
      <VideoGrid videos={TUTORIAL_VIDEOS.filter((v) => v.audiences.includes('partner'))} label="Partner videos" />
      <RecordingNote />
    </div>
  );
}
