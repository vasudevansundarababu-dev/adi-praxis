import { jurisdictionProblem } from '@praxis/shared';

/**
 * Pure helpers for the policy library's documents (D-090). Kept out of `library-setup.tsx` ('use client') so server
 * components (the Policy page, its setup checklist) can call them: a function exported from a client module is only a
 * client reference on the server, and calling it there throws.
 */
export interface LibraryDocument {
  id: string;
  title: string;
  jurisdiction: string | null;
  libraryKind: string | null;
  captureSourceUrl: string | null;
  captureDownloadedOn: string | null;
  effectiveFrom?: string | null;
}
export interface LibraryExportRow {
  revision: number;
  exportId: string;
  sha256: string;
  rules: number;
  versions: number;
  at: string;
}

/** What C1 still needs from a document, in plain words (null when nothing). */
export function documentLibraryProblem(d: LibraryDocument): string | null {
  if (!d.libraryKind || !d.jurisdiction) return 'Set the kind (official text or bank policy) and an ISO jurisdiction such as US-CA.';
  const j = jurisdictionProblem(d.jurisdiction);
  if (j) return `${j} Set an ISO jurisdiction such as US or US-CA.`;
  if (d.libraryKind === 'official_text' && (!d.captureSourceUrl || !d.captureDownloadedOn)) return 'An official text needs where and when it was downloaded.';
  return null;
}

/** A document is ready for the library when C1 needs nothing more and it has an in-force date for its rules (D-090). */
export const documentReady = (d: LibraryDocument) => !documentLibraryProblem(d) && !!d.effectiveFrom;
