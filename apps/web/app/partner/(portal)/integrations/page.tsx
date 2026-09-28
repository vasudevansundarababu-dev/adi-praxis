import type { Metadata } from 'next';
import { PartnerApiClients } from '@/components/partner/api-clients';
import { PartnerDeliveries, PartnerWebhooks } from '@/components/partner/webhooks';
import { partnerGet, type PartnerApiClient, type PartnerWebhook, type PartnerWebhookDelivery } from '@/lib/partner-api';

export const metadata: Metadata = { title: 'API & webhooks' };

const FILTERS = ['FAILED', 'PENDING', 'DELIVERED'];

export default async function PartnerIntegrationsPage({ searchParams }: { searchParams: Promise<{ deliveries?: string }> }) {
  const { deliveries } = await searchParams;
  const filter = deliveries && FILTERS.includes(deliveries) ? deliveries : null;
  const [clients, hooks, dels] = await Promise.all([
    partnerGet<{ items: PartnerApiClient[] }>('/clients'),
    partnerGet<{ items: PartnerWebhook[] }>('/webhooks'),
    partnerGet<{ items: PartnerWebhookDelivery[] }>(`/webhook-deliveries${filter ? `?status=${filter}` : ''}`),
  ]);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">API &amp; webhooks</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">
          Connect your applicant tracking system to Partner API v1 on the ADI Praxis API host, under <code className="font-mono">/partner/v1</code>. Get an access
          token from <code className="font-mono">/partner/v1/oauth/token</code> with a client ID and secret below (OAuth2 client credentials), and send an{' '}
          <code className="font-mono">Idempotency-Key</code> header on every write.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="card p-4 text-sm">
            <p className="font-semibold">Sandbox</p>
            <p className="mt-1 text-fg-muted">
              For building and testing. Candidates you submit with a sandbox client are never emailed; you simulate their progress through the API and receive
              the matching sandbox webhooks. Sandbox candidates do not appear in this portal or on statements.
            </p>
          </div>
          <div className="card p-4 text-sm">
            <p className="font-semibold">Live</p>
            <p className="mt-1 text-fg-muted">
              For real candidates. Each submission is invited by email, counts toward requisition limits and shows up under Candidates. Use live only once your integration works
              in sandbox.
            </p>
          </div>
        </div>
      </div>

      <section aria-labelledby="clients-h">
        <h2 id="clients-h" className="text-lg font-semibold">
          API clients
        </h2>
        <p className="mb-3 text-sm text-fg-muted">Each client has a client ID and a secret. The secret is shown once, when you create or rotate the client.</p>
        {clients.status !== 200 ? <p role="alert" className="text-sm text-error">Could not load API clients. Refresh the page.</p> : <PartnerApiClients initial={clients.data?.items ?? []} />}
      </section>

      <section aria-labelledby="hooks-h">
        <h2 id="hooks-h" className="text-lg font-semibold">
          Webhooks
        </h2>
        <p className="mb-3 text-sm text-fg-muted">
          We POST each event to your URL, signed with HMAC-SHA256, and retry with backoff if your endpoint does not answer with a 2xx status.
        </p>
        {hooks.status !== 200 ? <p role="alert" className="text-sm text-error">Could not load webhooks. Refresh the page.</p> : <PartnerWebhooks initial={hooks.data?.items ?? []} />}
      </section>

      <section id="deliveries" aria-labelledby="del-h">
        <h2 id="del-h" className="text-lg font-semibold">
          Recent deliveries
        </h2>
        <p className="mb-3 text-sm text-fg-muted">The latest 200 deliveries. Replay sends the same event again with the same event ID, so you can deduplicate.</p>
        {dels.status !== 200 ? (
          <p role="alert" className="text-sm text-error">
            Could not load deliveries. Refresh the page.
          </p>
        ) : (
          <PartnerDeliveries initial={dels.data?.items ?? []} filter={filter} />
        )}
      </section>
    </div>
  );
}
