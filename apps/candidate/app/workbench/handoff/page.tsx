import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { Suspense } from 'react';
import { Handoff } from '@/components/journey/handoff';

export const metadata: Metadata = { title: { absolute: pageTitle('Workbench') } };

export default function HandoffPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Suspense>
        <Handoff />
      </Suspense>
    </main>
  );
}
