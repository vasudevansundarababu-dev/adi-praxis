-- Console search bar (owner, 12 Nov 2026): typo-tolerant letters matching (pg_trgm) plus meaning (pgvector).
-- A derived index of the lists' records, rebuilt from the source rows on search (no business state lives here).
-- Searches are scoped to the visible ids of one list, so no trigram GIN index is needed at this size.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "SearchDocument" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "client_id" UUID NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" UUID NOT NULL,
  "text" TEXT NOT NULL,
  "meaning_hash" TEXT NOT NULL,
  "embedding" vector(768),
  "embedding_model" TEXT,
  "source_updated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SearchDocument_entity_type_entity_id_key" ON "SearchDocument"("entity_type", "entity_id");
CREATE INDEX "SearchDocument_client_id_entity_type_idx" ON "SearchDocument"("client_id", "entity_type");
