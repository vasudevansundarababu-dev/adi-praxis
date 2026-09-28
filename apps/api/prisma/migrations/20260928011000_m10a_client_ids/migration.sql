-- Tenancy (M0 rule): every business table carries client_id. The M10a tables are new and empty when this runs.
ALTER TABLE "PartnerUser" ADD COLUMN "client_id" UUID NOT NULL;
ALTER TABLE "PartnerClient" ADD COLUMN "client_id" UUID NOT NULL;
ALTER TABLE "PartnerAccessToken" ADD COLUMN "client_id" UUID NOT NULL;
ALTER TABLE "PartnerWebhook" ADD COLUMN "client_id" UUID NOT NULL;
ALTER TABLE "PartnerWebhookDelivery" ADD COLUMN "client_id" UUID NOT NULL;
ALTER TABLE "CandidateStateEvent" ADD COLUMN "client_id" UUID NOT NULL;
