-- E-007 phase 2 (owner, 24 Nov 2026): the receipt ADI Forge issues with each Export for benchmark: the digests of every
-- task sent (record, package, frozen snapshot, check report) and of the export itself. Signing comes later (phase 7).
ALTER TABLE "RlGymProjectExport" ADD COLUMN "authoring_receipt" JSONB;
