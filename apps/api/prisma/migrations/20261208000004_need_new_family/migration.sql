-- E-001 §6b (owner, 24 Nov 2026): an SME raises a new edge-case family (with its first variants and their outcomes) in
-- Raise a need. Widens the kind check only; existing needs are unchanged.
ALTER TABLE "SmeNeed" DROP CONSTRAINT "SmeNeed_kind_check";
ALTER TABLE "SmeNeed" ADD CONSTRAINT "SmeNeed_kind_check" CHECK ("kind" IN ('new_case_kind', 'more_data', 'new_edge_case_family'));
