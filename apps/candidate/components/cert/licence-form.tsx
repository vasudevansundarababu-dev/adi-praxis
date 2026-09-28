'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { upload } from '@/lib/client';
import type { LicenceStatus } from '@/lib/supply-types';

const input = 'mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5';

/** Healthcare Experts: licence number, issuing body and certificate, checked by a Validator. */
export function LicenceForm({ certificationId, status }: { certificationId: string; status: LicenceStatus }) {
  const router = useRouter();
  const [number, setNumber] = useState('');
  const [issuingBody, setIssuingBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'CONFIRMED') return <p className="mt-4 text-sm text-success">Professional licence confirmed.</p>;
  if (status === 'PENDING') return <p className="mt-4 text-sm text-fg-muted">Your professional licence is with a Validator. We’ll let you know when it’s checked.</p>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return setError('The file is larger than 10 MB. Upload a smaller PDF, PNG or JPG.');
    setPending(true);
    setError(null);
    const form = new FormData();
    form.append('number', number.trim());
    form.append('issuingBody', issuingBody.trim());
    form.append('file', file);
    const r = await upload(`/me/certifications/${certificationId}/licence`, form);
    setPending(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-lg border border-line p-4 text-sm">
      <div>
        <h3 className="font-semibold">Professional licence</h3>
        <p className="mt-1 text-fg-muted">
          {status === 'REJECTED' ? 'The Validator could not confirm your last upload. Check the details and upload it again.' : 'This role needs a current professional licence. A Validator checks it; your certificate is issued once it is confirmed.'}
        </p>
        <RequiredNote className="mt-1" />
      </div>
      <label className="block">
        Licence number
        <Req />
        <input required maxLength={60} value={number} onChange={(e) => setNumber(e.target.value)} className={`${input} sm:max-w-xs`} />
      </label>
      <label className="block">
        Issuing body
        <Req />
        <input required maxLength={200} value={issuingBody} onChange={(e) => setIssuingBody(e.target.value)} className={input} />
      </label>
      <label className="block">
        Licence certificate (PDF, PNG or JPG, up to 10 MB)
        <Req />
        <input required type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
      </label>
      <button type="submit" disabled={pending || !number.trim() || !issuingBody.trim() || !file} className="btn btn-primary">
        {pending ? 'Uploading…' : 'Upload licence'}
      </button>
      {error && <p role="alert" className="text-error">{error}</p>}
    </form>
  );
}
