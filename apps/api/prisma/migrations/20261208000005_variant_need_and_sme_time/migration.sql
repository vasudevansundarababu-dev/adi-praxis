-- E-001 §6b (owner, 24 Nov 2026): "He can define a new edge case for PM/Admin review": an SME proposes a new variant of
-- an existing family in Raise a need. And default c: outcome batches count as SME time, measured per answered item.
-- Additive only: a widened check and one new nullable column.
ALTER TABLE "SmeNeed" DROP CONSTRAINT "SmeNeed_kind_check";
ALTER TABLE "SmeNeed" ADD CONSTRAINT "SmeNeed_kind_check" CHECK ("kind" IN ('new_case_kind', 'more_data', 'new_edge_case_family', 'new_edge_case_variant'));
ALTER TABLE "OutcomeBatchItem" ADD COLUMN "active_seconds" INTEGER;
