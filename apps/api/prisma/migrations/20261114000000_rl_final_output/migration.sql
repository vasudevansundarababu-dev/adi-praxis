-- Owner, 12 Nov 2026: the run's final output.json, when RL Gym / Anvil sends it, to score Q4 query clustering by F1.
ALTER TABLE "RLReviewRequest" ADD COLUMN "final_output" JSONB;
