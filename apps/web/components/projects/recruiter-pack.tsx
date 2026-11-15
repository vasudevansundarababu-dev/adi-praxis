import type { RecruiterPackDto } from '@praxis/shared';

/** The Export to Recruiter preview: the PDF's four sections, as the recruiter will read them. */
export function RecruiterPackPreview({ pack }: { pack: RecruiterPackDto }) {
  const base = `/api/v1/projects/${pack.projectId}/recruiter-pack`;
  const requirementPairs = pack.requirements.length;
  return (
    <div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Export to Recruiter</h1>
        <span className="ml-auto flex gap-2">
          <a href={`${base}.xlsx`} className="btn btn-secondary" download>
            Download Excel only
          </a>
          <a href={`${base}.pdf`} className="btn btn-primary" download>
            Download PDF
          </a>
        </span>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-fg-muted">
        One PDF for recruitment agencies, built from the project. Preview it here, then download and send it. The candidate assessment sheet (Excel) is attached inside the PDF.
      </p>

      <article className="card mt-5 max-w-4xl p-7" aria-label="Recruiter pack preview">
        <header className="mb-4 flex items-center gap-3 border-b-2 border-brand-navy pb-3">
          <strong className="font-display">ADI Forge</strong>
          <span className="ml-auto text-xs text-fg-muted">
            Recruiter pack · {pack.projectName} · {pack.date}
          </span>
        </header>

        <h2 className="text-lg font-semibold">1 · The role</h2>
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[11rem_1fr]">
          <dt className="font-medium text-fg-muted">Role</dt>
          <dd>{pack.role.title}</dd>
          <dt className="font-medium text-fg-muted">Work</dt>
          <dd>{pack.role.work}</dd>
          <dt className="font-medium text-fg-muted">Location · language</dt>
          <dd>
            {pack.role.location} · {pack.role.language}
          </dd>
          <dt className="font-medium text-fg-muted">Pay · effort</dt>
          <dd>
            {pack.role.pay} · {pack.role.effort}
          </dd>
          <dt className="font-medium text-fg-muted">People needed</dt>
          <dd className="font-mono tabular-nums">{pack.role.peopleNeeded ?? 'To be confirmed'}</dd>
        </dl>

        <h2 className="mt-6 text-lg font-semibold">2 · Requirements</h2>
        {pack.requirements.length ? (
          <table className="mt-2 w-full text-left text-sm">
            <thead className="border-b border-line text-fg-muted">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Requirement</th>
                <th className="py-1.5 pr-3 font-medium">Detail</th>
                <th className="py-1.5 pr-3 font-medium">Level</th>
                <th className="py-1.5 font-medium">Evidence to check</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {pack.requirements.map((r, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-3 align-top">{r.kind}</td>
                  <td className="py-1.5 pr-3 align-top">{r.detail}</td>
                  <td className="py-1.5 pr-3 align-top">
                    <span className={`pill ${r.level === 'Required' ? 'pill-info' : ''}`}>{r.level}</span>
                  </td>
                  <td className="py-1.5 align-top">{r.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-sm text-fg-muted">No requirements are set for this project yet.</p>
        )}

        <h2 className="mt-6 text-lg font-semibold">3 · The task they would author (SME cheat sheet)</h2>
        <p className="mt-2 text-sm">{pack.cheatSheetIntro}</p>
        <table className="mt-2 w-full text-left text-sm">
          <tbody className="divide-y divide-line">
            {pack.cheatSheet.map((s) => (
              <tr key={s.section}>
                <td className="w-48 py-1.5 pr-3 align-top">
                  <strong className="font-mono">{s.section}</strong> {s.title}
                </td>
                <td className="py-1.5 align-top">{s.explanation}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-fg-muted">
          Good fits have done this work themselves: they can explain a real (anonymised) case step by step and say which rule drove each decision.
        </p>

        <h2 className="mt-6 text-lg font-semibold">4 · What to send back for each candidate</h2>
        <table className="mt-2 w-full text-left text-sm">
          <tbody className="divide-y divide-line">
            {pack.sendBack.map((s) => (
              <tr key={s.item}>
                <td className="w-56 py-1.5 pr-3 align-top font-semibold">{s.item}</td>
                <td className="py-1.5 align-top">{s.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="mt-4 text-sm font-semibold">Questions in the sheet</h3>
        <ol className="mt-1 list-none space-y-1 text-sm">
          {pack.questions.map((q) => (
            <li key={q.n}>
              <span className="font-mono">Q{q.n}.</span> {q.text}
              {q.required ? '' : ' (optional)'}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-fg-muted">Fill in the attached sheet, one row per candidate, and send it back with any CVs. Never include real customer or employer data.</p>

        <div className="mt-5 flex items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3">
          <span className="pill pill-info">Attached</span>
          <div>
            <strong className="text-sm">Attachment: {pack.fileName}</strong>
            <div className="text-xs text-fg-muted">
              Columns: First name* · Last name* · Email (Gmail)* · LinkedIn URL · one &quot;Met? / Evidence&quot; pair per requirement ({requirementPairs}) · Q1–Q{pack.questions.length}{' '}
              answers · Why they fit · Recruiter name · Agency
            </div>
          </div>
        </div>
      </article>
      <p className="mt-3 text-xs text-fg-muted">Some PDF viewers (for example Chrome and email previews) hide attachments. &quot;Download Excel only&quot; gives the same sheet on its own.</p>
    </div>
  );
}
