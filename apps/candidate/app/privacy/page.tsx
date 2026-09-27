import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';

export const metadata: Metadata = { title: { absolute: pageTitle('Privacy notice') } };

/** Placeholder: the approved privacy notice is supplied by the owner (FLOW2-SME section 15). Never invented here. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Privacy notice</h1>
      <p className="mt-4 text-fg-muted">The approved privacy notice will be published here before candidates are invited.</p>
    </main>
  );
}
