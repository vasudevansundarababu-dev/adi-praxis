import { notFound, redirect } from 'next/navigation';
import { api } from '@/lib/api';

/** Tracked apply link from a job post: counts the click, then shows the opportunity with the campaign attached. */
export default async function ApplyPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) notFound();
  const { data } = await api<{ opportunityId: string | null; live: boolean }>(`/public/campaigns/${campaignId}/click`, { method: 'POST' });
  if (!data?.opportunityId) notFound();
  redirect(`/opportunities/${data.opportunityId}${data.live ? `?campaign=${campaignId}` : ''}`);
}
