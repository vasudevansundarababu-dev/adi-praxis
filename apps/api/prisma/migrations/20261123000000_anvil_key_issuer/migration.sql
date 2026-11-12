-- Owner decision (11 Nov 2026) on Anvil's answer Q7: an ANVIL key is bound to the Admin who issued it.
ALTER TABLE "ApiClient" ADD COLUMN "issued_by_id" UUID;
