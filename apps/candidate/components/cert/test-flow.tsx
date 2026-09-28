'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { call } from '@/lib/client';
import { CERT_STATE, fmtDateTime, isInProgress, type AttemptInProgress, type AttemptResult, type Band, type CertificationCard, type TestView } from '@/lib/supply-types';
import { TestPlayer } from './test-player';

const selfieKey = (certId: string) => `praxis.selfie.${certId}`;
function storedSelfie(certId: string): string | null {
  try {
    return sessionStorage.getItem(selfieKey(certId));
  } catch {
    return null;
  }
}
function storeSelfie(certId: string, ref: string | null) {
  try {
    if (ref) sessionStorage.setItem(selfieKey(certId), ref);
    else sessionStorage.removeItem(selfieKey(certId));
  } catch {
    /* private mode: the ?selfie= return parameter still works */
  }
}

/** Selfie check → start → player → result, driven by the certification state and the latest attempt. */
export function TestFlow({ cert: initialCert, initial, selfieParam }: { cert: CertificationCard; initial: TestView; selfieParam: string | null }) {
  const router = useRouter();
  const [cert, setCert] = useState(initialCert);
  const [view, setView] = useState(initial);

  async function reload() {
    const [t, l] = await Promise.all([call<TestView>('GET', `/me/certifications/${cert.id}/test`), call<{ items: CertificationCard[] }>('GET', '/me/certifications')]);
    if (t.data) setView(t.data);
    const c = l.data?.items.find((x) => x.id === cert.id);
    if (c) setCert(c);
    router.refresh();
  }

  if (isInProgress(view.attempt)) return <TestPlayer attempt={view.attempt} tierLabel={cert.tierLabel} domain={cert.domain} onSubmitted={reload} />;

  const last = view.attempt as AttemptResult | null;
  const waitUntil = cert.state === 'RETAKE_AVAILABLE' && cert.retakeAvailableAt && new Date(cert.retakeAvailableAt) > new Date() ? cert.retakeAvailableAt : null;
  const canStart = (cert.state === 'TEST_READY' || cert.state === 'RETAKE_AVAILABLE') && !waitUntil;

  return (
    <div className="mt-3 space-y-6">
      <section className="hero p-6 sm:p-8">
        <p className="muted text-sm">{cert.domain}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{cert.tierLabel} certification test</h1>
        <div className="mt-3">
          <span className={`pill ${CERT_STATE[cert.state][1]}`}>{CERT_STATE[cert.state][0]}</span>
        </div>
      </section>

      {last && <Result cert={cert} attempt={last} waitUntil={waitUntil} />}

      {canStart && (
        <StartPanel
          cert={cert}
          selfieParam={selfieParam}
          retake={!!last}
          onStarted={(a) => {
            setView({ certification: { id: cert.id, state: 'IN_TEST' }, attempt: a });
            setCert({ ...cert, state: 'IN_TEST' });
            router.replace(`/certifications/${cert.id}/test`, { scroll: false });
          }}
        />
      )}

      {!last && !canStart && <NotReady cert={cert} />}
    </div>
  );
}

function NotReady({ cert }: { cert: CertificationCard }) {
  if (cert.state === 'NOT_STARTED' || cert.state === 'IN_TRAINING')
    return (
      <section className="card p-5 text-sm">
        <h2 className="font-semibold">Finish the course first</h2>
        <p className="mt-1 text-fg-muted">The test opens when you complete the last module of the course.</p>
        <Link href={`/certifications/${cert.id}`} className="mt-4 inline-block btn btn-primary">
          {cert.state === 'NOT_STARTED' ? 'Start the course' : 'Continue the course'} →
        </Link>
      </section>
    );
  const text: Partial<Record<CertificationCard['state'], string>> = {
    PASSED: 'You are certified. There is nothing more to do here.',
    REVIEW_REQUIRED: `A person is reviewing your certification${cert.reviewReason ? `: ${cert.reviewReason}` : '.'} We’ll let you know the outcome.`,
    NOT_CERTIFIED: 'A person reviewed your attempts and decided not to certify you this time.',
    EXPIRED: 'This certificate has expired. A new certification opens when you are selected for a role that needs it.',
  };
  return <p className="card p-5 text-sm">{text[cert.state] ?? 'The test is not available right now. Check back later.'}</p>;
}

const BAND_TONE: Record<Band, string> = { Strong: 'pill-success', Meets: 'pill-success', Developing: 'pill-warning', Below: 'pill-error' };

function Result({ cert, attempt, waitUntil }: { cert: CertificationCard; attempt: AttemptResult; waitUntil: string | null }) {
  const sections = Object.entries(attempt.sections ?? {});
  const heading = attempt.result === 'PASS' ? 'You passed' : attempt.result === 'FAIL' ? 'You didn’t pass this time' : 'Your test is being reviewed by a person';
  return (
    <section aria-live="polite" className={`card p-5 ${attempt.result === 'PASS' ? 'border-success' : ''}`}>
      <p className="text-sm text-fg-muted">
        Attempt {attempt.attemptNo}
        {attempt.submittedAt ? `, submitted ${fmtDateTime(attempt.submittedAt)}` : ''}
      </p>
      <h2 className="mt-1 text-xl font-semibold">{heading}</h2>
      <div className="mt-2 space-y-2 text-sm">
        {attempt.result === 'PASS' && cert.state === 'PASSED' && <p>Your certificate is issued. The Onboarding checklist ticks this step for you.</p>}
        {attempt.result === 'PASS' && cert.state === 'REVIEW_REQUIRED' && <p>{cert.reviewReason ?? 'A person is completing a final check before your certificate is issued.'} We’ll let you know when it’s done.</p>}
        {attempt.result === 'PENDING_REVIEW' && <p>Your written answers are marked by people, not by a computer alone. Your result appears here when they have finished; we’ll also let you know. There’s nothing you need to do now.</p>}
        {attempt.result === 'FAIL' && cert.state === 'RETAKE_AVAILABLE' && (waitUntil ? <p>You can retake the test from {fmtDateTime(waitUntil)}. The retake has new questions. Use the time to go back over the course.</p> : <p>You can retake the test now. The retake has new questions.</p>)}
        {attempt.result === 'FAIL' && cert.state === 'REVIEW_REQUIRED' && <p>You have used every attempt, so a person will now review your certification and decide what happens next. We’ll let you know.</p>}
        {attempt.result === 'FAIL' && cert.state === 'NOT_CERTIFIED' && <p>A person reviewed your attempts and decided not to certify you this time.</p>}
      </div>
      {sections.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">How you did in each section</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {sections.map(([name, band]) => (
              <li key={name} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3 text-sm">
                <span className="min-w-0">{name.replace(/_/g, ' ')}</span>
                <span className={`pill ${BAND_TONE[band] ?? ''}`}>{band}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-fg-muted">Bands, from highest: Strong, Meets, Developing, Below. We don’t show questions or answers after a test, so every form stays fair.</p>
        </div>
      )}
      {(attempt.result === 'FAIL' || cert.state === 'PASSED') && (
        <Link href={`/certifications/${cert.id}`} className="mt-4 inline-block text-sm text-link underline">
          Go back over the course
        </Link>
      )}
    </section>
  );
}

function StartPanel({ cert, selfieParam, retake, onStarted }: { cert: CertificationCard; selfieParam: string | null; retake: boolean; onStarted: (a: AttemptInProgress) => void }) {
  const [selfie, setSelfie] = useState<string | null>(selfieParam);
  useEffect(() => {
    if (!selfieParam) setSelfie(storedSelfie(cert.id));
  }, [cert.id, selfieParam]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function takeSelfie() {
    setPending(true);
    setError(null);
    const r = await call<{ sessionRef: string; url: string }>('POST', `/me/certifications/${cert.id}/selfie`);
    if (!r.ok) {
      setPending(false);
      return setError(r.error);
    }
    // Stripe returns to the test page without the reference, so it is remembered for this tab.
    storeSelfie(cert.id, r.data!.sessionRef);
    window.location.assign(r.data!.url);
  }

  async function start() {
    if (!selfie) return;
    setPending(true);
    setError(null);
    const r = await call<AttemptInProgress>('POST', `/me/certifications/${cert.id}/test/start`, { sessionRef: selfie });
    setPending(false);
    if (r.ok) {
      storeSelfie(cert.id, null);
      return onStarted(r.data!);
    }
    if (r.code === 'SELFIE_ALREADY_USED' || (r.code === 'SELFIE_CHECK_REQUIRED' && !/processed/.test(r.error ?? ''))) {
      storeSelfie(cert.id, null);
      setSelfie(null);
    }
    setError(r.status === 503 ? 'Your test is being prepared. Wait a minute, then press Start again.' : r.error);
  }

  return (
    <section className="card p-5 text-sm">
      <h2 className="text-lg font-semibold">{retake ? 'Retake the test' : 'Before you start'}</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-fg-muted">
        <li>The test is timed. The clock starts when you press Start and a countdown stays on screen.</li>
        <li>Your answers save automatically as you go. If your connection drops, keep going; we save again when it’s back.</li>
        <li>Work on your own and in one sitting. Pasting text and leaving the test page are logged for the reviewers. They never fail anyone on their own.</li>
        <li>You have up to 3 attempts. After a fail you can retake after 48 hours, with new questions.</li>
      </ul>

      <ol className="mt-5 space-y-4">
        <li className="flex flex-wrap items-start gap-3">
          <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${selfie ? 'bg-success text-on-primary' : 'border border-line'}`}>{selfie ? '✓' : 1}</span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Quick selfie check</p>
            <p className="text-fg-muted">
              {selfie ? 'Done. If you close this page before starting, you’ll need to take it again.' : 'We check it’s you before every attempt. Only the result is kept; we never store your photo or ID.'}
            </p>
            {!selfie && (
              <button type="button" disabled={pending} onClick={takeSelfie} className="mt-3 btn btn-primary">
                {pending ? 'Opening…' : 'Take the selfie check →'}
              </button>
            )}
          </div>
        </li>
        <li className="flex flex-wrap items-start gap-3">
          <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-xs">2</span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Start the test</p>
            <p className="text-fg-muted">Make sure you have enough uninterrupted time before you press Start.</p>
            <button type="button" disabled={pending || !selfie} onClick={start} className="mt-3 btn btn-primary">
              {pending && selfie ? 'Starting…' : 'Start the test now →'}
            </button>
          </div>
        </li>
      </ol>
      {error && <p role="alert" className="mt-4 text-error">{error}</p>}
    </section>
  );
}
