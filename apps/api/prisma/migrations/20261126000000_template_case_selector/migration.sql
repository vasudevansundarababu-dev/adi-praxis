-- One task per case-selector value (KYC five-state contract, 13 Nov 2026): the template keeps its case selector so
-- projects get one slot per value. Backfill from the stored Anvil proposal (anvil_spec.authoring.template), which is
-- where versions created before this column carry it. No other column changes.
ALTER TABLE "Template" ADD COLUMN "case_selector" JSONB;

UPDATE "Template"
SET "case_selector" = "anvil_spec" -> 'authoring' -> 'template' -> 'caseSelector'
WHERE "anvil_spec" IS NOT NULL
  AND jsonb_typeof("anvil_spec" -> 'authoring' -> 'template' -> 'caseSelector') = 'object';
