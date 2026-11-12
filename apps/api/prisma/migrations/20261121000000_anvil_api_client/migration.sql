-- Praxis-Anvil contract (12 Nov 2026): Anvil calls the Praxis template API with a Praxis-issued, expiring key.
ALTER TYPE "ApiClientKind" ADD VALUE 'ANVIL';
ALTER TABLE "ApiClient" ADD COLUMN "expires_at" TIMESTAMP(3);
