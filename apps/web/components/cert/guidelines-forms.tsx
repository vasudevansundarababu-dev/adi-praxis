'use client';

import { LAUNCH_DOMAINS } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { ActionMessages, input, upload, useAction } from '@/components/supply/action';

/** A package is one domain + task family; it serves all three tiers. */
export function NewPackageForm() {
  const a = useAction();
  const [domain, setDomain] = useState('banking');
  const [taskFamily, setTaskFamily] = useState('');
  const [name, setName] = useState('');
  return (
    <form
      className="card mt-6 max-w-3xl space-y-3 p-4 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await a.run('POST', '/guidelines/packages', { domain, taskFamily, name }, { success: 'Package created. Upload its first version.' });
        if (res.ok) {
          setTaskFamily('');
          setName('');
        }
      }}
    >
      <h2 className="font-semibold">New guidelines package</h2>
      <RequiredNote />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          Domain
          <Req />
          <input required list="pkg-domains" value={domain} onChange={(e) => setDomain(e.target.value)} className={input} />
          <datalist id="pkg-domains">
            {LAUNCH_DOMAINS.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </label>
        <label className="block">
          Task family
          <Req />
          <input required minLength={2} value={taskFamily} onChange={(e) => setTaskFamily(e.target.value)} placeholder="KYC review" className={input} />
        </label>
        <label className="block">
          Name
          <Req />
          <input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="Banking KYC guidelines" className={input} />
        </label>
      </div>
      <button type="submit" disabled={a.pending} className="btn btn-primary">
        Create package
      </button>
      <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
    </form>
  );
}

/** Upload a new version (PDF, DOCX, Markdown or text, up to 10 MB). Generation runs in the background. */
export function UploadVersionForm({ packageId }: { packageId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [major, setMajor] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) return setError('The file is larger than 10 MB. Split it or remove images, then try again.');
        setPending(true);
        setError(null);
        setNotice(null);
        const form = new FormData();
        // Fields before the file, so the API reads them with the upload.
        form.append('major', major ? 'true' : 'false');
        form.append('file', file);
        const res = await upload<{ id: string; version: number; sections: number }>(`/guidelines/packages/${packageId}/versions`, form);
        setPending(false);
        if (!res.ok) return setError(res.error);
        setNotice(`Version ${res.data!.version} uploaded (${res.data!.sections} sections). Generation has started.`);
        setFile(null);
        (e.target as HTMLFormElement).reset();
        router.push(`/guidelines/versions/${res.data!.id}`);
      }}
    >
      <RequiredNote className="w-full" />
      <label className="block">
        Upload a new version
        <Req />
        <input required type="file" accept=".pdf,.docx,.md,.markdown,.txt,application/pdf,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block" />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={major} onChange={(e) => setMajor(e.target.checked)} />
        Major change (SMEs take an update module and quiz before their next task)
      </label>
      <button type="submit" disabled={pending || !file} className="btn btn-primary">
        {pending ? 'Uploading…' : 'Upload'}
      </button>
      <div className="w-full">
        <ActionMessages error={error} notice={notice} />
      </div>
    </form>
  );
}
