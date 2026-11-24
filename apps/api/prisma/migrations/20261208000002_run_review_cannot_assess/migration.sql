-- E-007 phase 2: "Can't assess" is a decision kept in ADI Forge (the RL Gym takes only its five), recorded as
-- send outcome kept_in_forge. The verdict is accept, dispute or cannot_assess (NULL for decisions made before).
ALTER TABLE "RunReviewDecision" DROP CONSTRAINT "RunReviewDecision_decision_check";
ALTER TABLE "RunReviewDecision" ADD CONSTRAINT "RunReviewDecision_decision_check" CHECK ("decision" IN ('agent_failure', 'task_correction', 'rubric_correction', 'grader_wrong', 'environment_wrong', 'cannot_assess'));
ALTER TABLE "RunReviewDecision" DROP CONSTRAINT "RunReviewDecision_send_check";
ALTER TABLE "RunReviewDecision" ADD CONSTRAINT "RunReviewDecision_send_check" CHECK ("send_outcome" IN ('received', 'rejected', 'unavailable', 'not_connected', 'kept_in_forge'));
ALTER TABLE "RunReviewDecision" ADD CONSTRAINT "RunReviewDecision_verdict_check" CHECK ("verdict" IS NULL OR "verdict" IN ('accept', 'dispute', 'cannot_assess'));
