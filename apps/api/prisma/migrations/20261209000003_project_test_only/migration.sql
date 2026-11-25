-- KYC Judgment v1 (RL Gym, 25 Nov 2026): a test-only project (integration tests only). Its exports carry the top-level
-- boolean `test_only: true`; the RL Gym labels it TEST and never puts it on a leaderboard. Additive; every existing
-- project stays false.
ALTER TABLE "Project" ADD COLUMN "test_only" BOOLEAN NOT NULL DEFAULT false;
