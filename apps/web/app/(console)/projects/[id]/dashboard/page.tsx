import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Dashboard, type DashboardData } from '@/components/tasks/dashboard';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Progress dashboard' };

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await apiGet<DashboardData>(`/projects/${id}/dashboard`);
  if (!data) notFound();
  return <Dashboard initial={data} />;
}
