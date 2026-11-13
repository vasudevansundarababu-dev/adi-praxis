-- Keyless Praxis <-> Anvil (owner, 12 Nov 2026): a grant row names the Google service account allowed to call.
ALTER TABLE "ApiClient" ADD COLUMN "service_account" TEXT;
CREATE UNIQUE INDEX "ApiClient_service_account_key" ON "ApiClient"("service_account");
