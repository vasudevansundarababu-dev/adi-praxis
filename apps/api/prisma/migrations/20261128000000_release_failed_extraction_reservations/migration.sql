-- Failed extraction jobs that the provider never accepted (no provider operation id) cannot have been charged, but
-- their worst-case RESERVE rows were never released, so they kept counting against the spending ceiling (QA, 14 Nov
-- 2026: $4.80 of $5 held by refused LlamaExtract calls). The worker now writes a negative RELEASE row when such a job
-- ends; this releases what earlier jobs still hold. ExtractionSpend stays append-only: only new rows are inserted.
INSERT INTO "ExtractionSpend" (client_id, provider, job_id, kind, amount_usd)
SELECT s.client_id, s.provider, s.job_id, 'RELEASE', -SUM(s.amount_usd)
FROM "ExtractionSpend" s
JOIN "ExtractionJob" j ON j.id = s.job_id
WHERE j.status IN ('FAILED', 'CANCELLED') AND j.provider_operation_id IS NULL
GROUP BY s.client_id, s.provider, s.job_id
HAVING SUM(s.amount_usd) > 0;
