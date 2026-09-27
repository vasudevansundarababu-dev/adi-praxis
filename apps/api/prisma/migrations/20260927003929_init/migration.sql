-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "InternalRole" AS ENUM ('ADMIN', 'PM', 'REVIEWER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "SessionAudience" AS ENUM ('INTERNAL', 'CANDIDATE');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'CANDIDATE', 'SYSTEM', 'SERVICE');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "TaskMode" AS ENUM ('AUTHORING', 'ANNOTATION');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('AUTHORING', 'ANNOTATION', 'RL_REVIEW');

-- CreateEnum
CREATE TYPE "DemographicAttributeType" AS ENUM ('SINGLE_SELECT', 'MULTI_SELECT', 'NUMBER_RANGE', 'GEO_RADIUS');

-- CreateEnum
CREATE TYPE "FilterOperator" AS ENUM ('IN', 'GTE', 'LTE', 'BETWEEN', 'WITHIN_RADIUS');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('REMOTE', 'ONSITE', 'HYBRID');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'READY_FOR_STAFFING', 'STAFFING', 'STAFFED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CampaignChannel" AS ENUM ('LINKEDIN_MANUAL', 'LINKEDIN_APPLY_CONNECT');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'LIVE', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TaskInstanceStatus" AS ENUM ('CREATED', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'ACCEPTED', 'REWORK');

-- CreateEnum
CREATE TYPE "InviteChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "InputSource" AS ENUM ('UPLOAD', 'API');

-- CreateEnum
CREATE TYPE "CoverageSlotStatus" AS ENUM ('OPEN', 'OFFERED', 'IN_PROGRESS', 'FILLED', 'RELEASED');

-- CreateEnum
CREATE TYPE "SimilarityMethod" AS ENUM ('EMBEDDING', 'STRUCTURED');

-- CreateEnum
CREATE TYPE "DuplicateDecision" AS ENUM ('ACCEPT_AS_DISTINCT', 'REWORK', 'REJECT_DUPLICATE');

-- CreateEnum
CREATE TYPE "RLVerdict" AS ENUM ('PASS', 'FAIL', 'NEEDS_EXPERT');

-- CreateEnum
CREATE TYPE "RLReviewRequestStatus" AS ENUM ('RECEIVED', 'IN_REVIEW', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ApiClientKind" AS ENUM ('CLIENT_API', 'RL_GYM');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "IdentityStatus" AS ENUM ('NOT_STARTED', 'REQUIRES_INPUT', 'PROCESSING', 'VERIFIED', 'CANCELED', 'MANUAL_REVIEW_REQUIRED', 'ALTERNATIVE_VERIFIED');

-- CreateEnum
CREATE TYPE "ProfileConversationStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'READY_TO_CONFIRM', 'SUBMITTED', 'AMENDMENT_PENDING');

-- CreateEnum
CREATE TYPE "SuitabilityStatus" AS ENUM ('NOT_RUN', 'EVALUATING', 'FIT_RECOMMENDED', 'NOT_FIT_RECOMMENDED', 'NEEDS_INFORMATION', 'ERROR', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'NEEDS_INFORMATION', 'REVIEW_PENDING', 'SELECTED', 'NOT_SELECTED', 'REVIEW_REQUESTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "SmeAssignmentStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELED', 'HANDED_OFF');

-- CreateEnum
CREATE TYPE "SelectionOutcome" AS ENUM ('SELECTED', 'NOT_SELECTED', 'NEEDS_INFORMATION');

-- CreateEnum
CREATE TYPE "EvidenceLevel" AS ENUM ('SELF_REPORTED', 'DOCUMENT_SUPPORTED', 'INDEPENDENTLY_VERIFIED', 'INCONCLUSIVE', 'CONTRADICTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE', 'APPLE');

-- CreateEnum
CREATE TYPE "Speaker" AS ENUM ('CANDIDATE', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ContributionRole" AS ENUM ('TASK_AUTHOR', 'ANNOTATOR', 'REVIEWER', 'RUBRIC_DESIGNER', 'SCENARIO_VALIDATOR');

-- CreateEnum
CREATE TYPE "DatePrecision" AS ENUM ('MONTH', 'YEAR', 'APPROXIMATE');

-- CreateTable
CREATE TABLE "Client" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roles" "InternalRole"[],
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "password_hash" TEXT NOT NULL,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "audience" "SessionAudience" NOT NULL,
    "user_id" UUID,
    "sme_user_id" UUID,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiClient" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ApiClientKind" NOT NULL,
    "key_hash" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "DomainStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "lineage_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "workflow_name" TEXT NOT NULL,
    "primary_work" TEXT,
    "verification_criteria" TEXT,
    "human_gate" TEXT,
    "task_definition_schema" JSONB NOT NULL DEFAULT '{}',
    "collection_schema" JSONB NOT NULL DEFAULT '{}',
    "default_tpt_minutes" INTEGER,
    "default_jd_id" UUID,
    "skills" TEXT[],
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "task_modes" "TaskMode"[],
    "coverage_dimensions" JSONB NOT NULL DEFAULT '{}',
    "edge_case_catalog" JSONB NOT NULL DEFAULT '[]',
    "default_distinct_target" INTEGER NOT NULL DEFAULT 50,
    "default_max_per_expert" INTEGER NOT NULL DEFAULT 4,
    "open_slot_share" DECIMAL(4,3) NOT NULL DEFAULT 0.2,
    "similarity_threshold" DECIMAL(4,3) NOT NULL DEFAULT 0.90,
    "published_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemographicAttribute" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "DemographicAttributeType" NOT NULL,
    "allowed_values" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemographicAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDescription" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "normalized_title" TEXT NOT NULL,
    "responsibilities" TEXT NOT NULL,
    "skills" TEXT[],
    "wage_per_task" DECIMAL(12,2) NOT NULL,
    "wage_currency" CHAR(3) NOT NULL,
    "location_type" "LocationType" NOT NULL,
    "location" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDescriptionSnapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "job_description_id" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobDescriptionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_version" INTEGER NOT NULL,
    "job_description_id" UUID,
    "jd_snapshot_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "task_mode" "TaskMode" NOT NULL DEFAULT 'AUTHORING',
    "task_count" INTEGER,
    "distinct_target" INTEGER,
    "max_per_expert" INTEGER,
    "open_slot_share" DECIMAL(4,3),
    "coverage_quotas" JSONB,
    "tpt_minutes" INTEGER,
    "hours_per_worker_day" DECIMAL(4,2) NOT NULL DEFAULT 4,
    "start_date" DATE,
    "end_date" DATE,
    "required_workers" INTEGER,
    "demographics_snapshot" JSONB,
    "auto_launch_campaign" BOOLEAN NOT NULL DEFAULT false,
    "open_task_cap_per_candidate" INTEGER NOT NULL DEFAULT 3,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDemographicFilter" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "attribute_key" TEXT NOT NULL,
    "operator" "FilterOperator" NOT NULL,
    "values" JSONB NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectDemographicFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "latest_profile_version_id" UUID,
    "pool_status" TEXT,
    "location" JSONB,
    "languages" JSONB NOT NULL DEFAULT '[]',
    "specialties" TEXT[],
    "jurisdictions" TEXT[],
    "availability" JSONB,
    "concurrent_project_limit" INTEGER NOT NULL DEFAULT 2,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "job_description_id" UUID NOT NULL,
    "channel" "CampaignChannel" NOT NULL,
    "external_id" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "budget" DECIMAL(12,2),
    "post_text" TEXT,
    "apply_url" TEXT,
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "candidate_id" UUID,
    "enrollment_id" UUID,
    "source" "CampaignChannel" NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAssignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "match_score" DECIMAL(6,2),
    "enrollment_id" UUID,
    "sme_assignment_id" UUID,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageSlot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "coverage_tags" JSONB NOT NULL,
    "is_open" BOOLEAN NOT NULL DEFAULT false,
    "brief" TEXT NOT NULL,
    "status" "CoverageSlotStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverageSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskInputBatch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source" "InputSource" NOT NULL,
    "uploaded_by_id" UUID,
    "api_client_id" UUID,
    "item_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskInputBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskInstance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_type" "TaskType" NOT NULL,
    "slot_id" UUID,
    "input_batch_id" UUID,
    "rl_review_request_id" UUID,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "status" "TaskInstanceStatus" NOT NULL DEFAULT 'CREATED',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "assigned_to_id" UUID,
    "project_assignment_id" UUID,
    "assigned_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "active_seconds" INTEGER NOT NULL DEFAULT 0,
    "reviewer_id" UUID,
    "review_notes" TEXT,
    "rework_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimilarityCheck" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "task_instance_id" UUID NOT NULL,
    "compared_to_id" UUID NOT NULL,
    "score" DECIMAL(5,4) NOT NULL,
    "method" "SimilarityMethod" NOT NULL,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimilarityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_assignment_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "channel" "InviteChannel" NOT NULL,
    "sent_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovedTaskRecord" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schema_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content_hash" TEXT NOT NULL,
    "prev_hash" TEXT,
    "supersedes_id" UUID,
    "task_instance_id" UUID NOT NULL,
    "task_mode" "TaskType" NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "active_seconds" INTEGER NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "slot_id" UUID,
    "coverage_tags" JSONB,
    "is_open_slot" BOOLEAN NOT NULL DEFAULT false,
    "nearest_duplicate_id" UUID,
    "nearest_duplicate_score" DECIMAL(5,4),
    "author_task_index" INTEGER,
    "input_source" "InputSource",
    "input_batch_id" UUID,
    "uploaded_by_id" UUID,
    "api_client_id" UUID,
    "candidate_id" UUID NOT NULL,
    "identity_ref" TEXT,
    "project_assignment_id" UUID,
    "qualification_snapshot" JSONB,
    "reviewer_id" UUID NOT NULL,
    "review_decision_at" TIMESTAMP(3) NOT NULL,
    "review_notes" TEXT,
    "rework_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_decision" "DuplicateDecision",
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_version" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,
    "workflow" TEXT NOT NULL,
    "jd_snapshot_id" UUID,
    "worker_terms_version" TEXT,

    CONSTRAINT "ApprovedTaskRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RLReviewRequest" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "rl_run_id" TEXT NOT NULL,
    "rl_task_id" TEXT NOT NULL,
    "source_record_ids" UUID[],
    "eval_results" JSONB NOT NULL,
    "trajectories" JSONB NOT NULL,
    "rubric_id" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "due_by" TIMESTAMP(3),
    "status" "RLReviewRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RLReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RLReviewRecord" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content_hash" TEXT NOT NULL,
    "prev_hash" TEXT,
    "supersedes_id" UUID,
    "rl_review_request_id" UUID NOT NULL,
    "rl_run_id" TEXT NOT NULL,
    "rl_task_id" TEXT NOT NULL,
    "source_record_ids" UUID[],
    "reviewer_id" UUID NOT NULL,
    "verdict" "RLVerdict" NOT NULL,
    "metric_verdicts" JSONB NOT NULL,
    "comments" JSONB NOT NULL,
    "reason_codes" TEXT[],
    "rubric_id" TEXT,
    "review_started_at" TIMESTAMP(3),
    "review_submitted_at" TIMESTAMP(3) NOT NULL,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "RLReviewRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FailureReasonCode" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FailureReasonCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventHandlerReceipt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "handler" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventHandlerReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "actor_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID,
    "provider" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "livemode" BOOLEAN,
    "payload_hash" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmeUser" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "display_name" TEXT,
    "contact_email" TEXT,
    "preferred_language" TEXT,
    "timezone" TEXT,
    "account_status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "identity_status" "IdentityStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "adult_attested_at" TIMESTAMP(3),
    "anonymized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmeUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderIdentity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "subject" TEXT NOT NULL,
    "email_at_link" TEXT,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityAttempt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "provider_session_id" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "status" "IdentityStatus" NOT NULL,
    "checked_at" TIMESTAMP(3),
    "error_code" TEXT,
    "last_event_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlternativeIdentityCheck" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "notes" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlternativeIdentityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "brief" JSONB NOT NULL,
    "criteria" JSONB NOT NULL,
    "question_policy" JSONB NOT NULL,
    "scope" JSONB NOT NULL,
    "terms_refs" JSONB NOT NULL DEFAULT '[]',
    "owner_id" UUID NOT NULL,
    "published_at" TIMESTAMP(3),
    "published_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "opportunity_version_id" UUID NOT NULL,
    "profile_version_id" UUID,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "status" "ProfileConversationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "next_question" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationTurn" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "client_message_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "speaker" "Speaker" NOT NULL,
    "content" TEXT NOT NULL,
    "question_id" TEXT,
    "acknowledged_at" TIMESTAMP(3),
    "schema_version" TEXT,
    "model_version" TEXT,
    "policy_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "flags" JSONB NOT NULL DEFAULT '{}',
    "source_links" JSONB NOT NULL DEFAULT '{}',
    "content_hash" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperienceEpisode" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "profile_version_id" UUID NOT NULL,
    "start_month" TEXT,
    "end_month" TEXT,
    "precision" "DatePrecision" NOT NULL,
    "domain" TEXT,
    "specialty" TEXT,
    "role" TEXT,
    "responsibility" TEXT,
    "employer_scope" TEXT,
    "contribution_mode" TEXT,
    "source_turn_ids" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExperienceEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialClaim" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "profile_version_id" UUID NOT NULL,
    "claim_type" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "issuer" TEXT,
    "scope" TEXT,
    "valid_from" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "evidence_level" "EvidenceLevel" NOT NULL DEFAULT 'SELF_REPORTED',
    "method" TEXT,
    "checker_id" UUID,
    "checked_at" TIMESTAMP(3),
    "disputed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CredentialClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceArtifact" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "permission_granted" BOOLEAN NOT NULL DEFAULT false,
    "redaction_status" TEXT NOT NULL DEFAULT 'NONE',
    "scan_status" TEXT NOT NULL DEFAULT 'PENDING',
    "retention_category" TEXT NOT NULL,
    "deletion_requested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuitabilityAssessment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "profile_version_id" UUID NOT NULL,
    "opportunity_version_id" UUID NOT NULL,
    "status" "SuitabilityStatus" NOT NULL DEFAULT 'NOT_RUN',
    "input_hash" TEXT,
    "rule_version" TEXT,
    "model_version" TEXT,
    "findings" JSONB,
    "limitations" TEXT,
    "proposed_scope" JSONB,
    "error_code" TEXT,
    "superseded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuitabilityAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelectionDecision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "outcome" "SelectionOutcome" NOT NULL,
    "reasons" JSONB NOT NULL,
    "profile_version_id" UUID NOT NULL,
    "assessment_id" UUID,
    "criteria_ref" JSONB NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelectionDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationScope" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "selection_decision_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "specialty" TEXT,
    "jurisdictions" TEXT[],
    "languages" TEXT[],
    "contribution_roles" "ContributionRole"[],
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualificationScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingChecklist" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "checklist_version" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "block_reason" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingAcknowledgement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "checklist_id" UUID NOT NULL,
    "item_key" TEXT NOT NULL,
    "terms_hash" TEXT,
    "acknowledged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmeAssignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "requirements_version" INTEGER NOT NULL,
    "qualification_snapshot" JSONB NOT NULL,
    "scope" JSONB NOT NULL,
    "capacity" INTEGER,
    "deadline" TIMESTAMP(3),
    "terms_ref" TEXT,
    "status" "SmeAssignmentStatus" NOT NULL DEFAULT 'PROPOSED',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "decline_reason" TEXT,
    "workbench_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictDeclaration" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "enrollment_id" UUID,
    "reviewer_id" UUID,
    "employer_description" TEXT NOT NULL,
    "details" TEXT,
    "declared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConflictDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CredentialClaimToEvidenceArtifact" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_CredentialClaimToEvidenceArtifact_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_name_key" ON "Client"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_client_id_idx" ON "User"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_hash_key" ON "Session"("token_hash");

-- CreateIndex
CREATE INDEX "Session_user_id_idx" ON "Session"("user_id");

-- CreateIndex
CREATE INDEX "Session_sme_user_id_idx" ON "Session"("sme_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ApiClient_key_hash_key" ON "ApiClient"("key_hash");

-- CreateIndex
CREATE INDEX "ApiClient_client_id_idx" ON "ApiClient"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_client_id_name_key" ON "Domain"("client_id", "name");

-- CreateIndex
CREATE INDEX "Template_client_id_status_idx" ON "Template"("client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Template_lineage_id_version_key" ON "Template"("lineage_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DemographicAttribute_client_id_key_key" ON "DemographicAttribute"("client_id", "key");

-- CreateIndex
CREATE INDEX "JobDescription_client_id_normalized_title_idx" ON "JobDescription"("client_id", "normalized_title");

-- CreateIndex
CREATE INDEX "Project_owner_id_idx" ON "Project"("owner_id");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_client_id_name_key" ON "Project"("client_id", "name");

-- CreateIndex
CREATE INDEX "ProjectDemographicFilter_project_id_idx" ON "ProjectDemographicFilter"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_sme_user_id_key" ON "Candidate"("sme_user_id");

-- CreateIndex
CREATE INDEX "Candidate_client_id_idx" ON "Candidate"("client_id");

-- CreateIndex
CREATE INDEX "Campaign_project_id_idx" ON "Campaign"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "Application_campaign_id_enrollment_id_key" ON "Application"("campaign_id", "enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAssignment_sme_assignment_id_key" ON "ProjectAssignment"("sme_assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAssignment_project_id_candidate_id_key" ON "ProjectAssignment"("project_id", "candidate_id");

-- CreateIndex
CREATE INDEX "CoverageSlot_project_id_status_idx" ON "CoverageSlot"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaskInstance_rl_review_request_id_key" ON "TaskInstance"("rl_review_request_id");

-- CreateIndex
CREATE INDEX "TaskInstance_project_id_status_idx" ON "TaskInstance"("project_id", "status");

-- CreateIndex
CREATE INDEX "TaskInstance_assigned_to_id_status_idx" ON "TaskInstance"("assigned_to_id", "status");

-- CreateIndex
CREATE INDEX "SimilarityCheck_task_instance_id_idx" ON "SimilarityCheck"("task_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_token_hash_key" ON "Invite"("token_hash");

-- CreateIndex
CREATE INDEX "ApprovedTaskRecord_created_at_idx" ON "ApprovedTaskRecord"("created_at");

-- CreateIndex
CREATE INDEX "ApprovedTaskRecord_project_id_idx" ON "ApprovedTaskRecord"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "RLReviewRequest_rl_run_id_rl_task_id_key" ON "RLReviewRequest"("rl_run_id", "rl_task_id");

-- CreateIndex
CREATE INDEX "RLReviewRecord_created_at_idx" ON "RLReviewRecord"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "FailureReasonCode_client_id_code_key" ON "FailureReasonCode"("client_id", "code");

-- CreateIndex
CREATE INDEX "AuditEvent_entity_type_entity_id_idx" ON "AuditEvent"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "AuditEvent_created_at_idx" ON "AuditEvent"("created_at");

-- CreateIndex
CREATE INDEX "OutboxEvent_dispatched_at_available_at_idx" ON "OutboxEvent"("dispatched_at", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "EventHandlerReceipt_event_id_handler_key" ON "EventHandlerReceipt"("event_id", "handler");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expires_at_idx" ON "IdempotencyKey"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_actor_id_key_key" ON "IdempotencyKey"("actor_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookReceipt_provider_external_event_id_key" ON "WebhookReceipt"("provider", "external_event_id");

-- CreateIndex
CREATE INDEX "SmeUser_client_id_idx" ON "SmeUser"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderIdentity_provider_subject_key" ON "ProviderIdentity"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityAttempt_provider_session_id_key" ON "IdentityAttempt"("provider_session_id");

-- CreateIndex
CREATE INDEX "IdentityAttempt_sme_user_id_idx" ON "IdentityAttempt"("sme_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_project_id_key" ON "Opportunity"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityVersion_opportunity_id_version_key" ON "OpportunityVersion"("opportunity_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_sme_user_id_opportunity_id_key" ON "Enrollment"("sme_user_id", "opportunity_id");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationSession_enrollment_id_key" ON "ConversationSession"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTurn_session_id_client_message_id_key" ON "ConversationTurn"("session_id", "client_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTurn_session_id_sequence_key" ON "ConversationTurn"("session_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileVersion_sme_user_id_version_key" ON "ProfileVersion"("sme_user_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceArtifact_storage_key_key" ON "EvidenceArtifact"("storage_key");

-- CreateIndex
CREATE INDEX "SuitabilityAssessment_enrollment_id_idx" ON "SuitabilityAssessment"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingChecklist_enrollment_id_key" ON "OnboardingChecklist"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingAcknowledgement_checklist_id_item_key_key" ON "OnboardingAcknowledgement"("checklist_id", "item_key");

-- CreateIndex
CREATE INDEX "SmeAssignment_sme_user_id_status_idx" ON "SmeAssignment"("sme_user_id", "status");

-- CreateIndex
CREATE INDEX "Consent_sme_user_id_purpose_idx" ON "Consent"("sme_user_id", "purpose");

-- CreateIndex
CREATE INDEX "ConflictDeclaration_reviewer_id_idx" ON "ConflictDeclaration"("reviewer_id");

-- CreateIndex
CREATE INDEX "_CredentialClaimToEvidenceArtifact_B_index" ON "_CredentialClaimToEvidenceArtifact"("B");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_sme_user_id_fkey" FOREIGN KEY ("sme_user_id") REFERENCES "SmeUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_default_jd_id_fkey" FOREIGN KEY ("default_jd_id") REFERENCES "JobDescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDescriptionSnapshot" ADD CONSTRAINT "JobDescriptionSnapshot_job_description_id_fkey" FOREIGN KEY ("job_description_id") REFERENCES "JobDescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_job_description_id_fkey" FOREIGN KEY ("job_description_id") REFERENCES "JobDescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_jd_snapshot_id_fkey" FOREIGN KEY ("jd_snapshot_id") REFERENCES "JobDescriptionSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDemographicFilter" ADD CONSTRAINT "ProjectDemographicFilter_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_sme_user_id_fkey" FOREIGN KEY ("sme_user_id") REFERENCES "SmeUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_job_description_id_fkey" FOREIGN KEY ("job_description_id") REFERENCES "JobDescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_sme_assignment_id_fkey" FOREIGN KEY ("sme_assignment_id") REFERENCES "SmeAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageSlot" ADD CONSTRAINT "CoverageSlot_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInputBatch" ADD CONSTRAINT "TaskInputBatch_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "CoverageSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_input_batch_id_fkey" FOREIGN KEY ("input_batch_id") REFERENCES "TaskInputBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_rl_review_request_id_fkey" FOREIGN KEY ("rl_review_request_id") REFERENCES "RLReviewRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_project_assignment_id_fkey" FOREIGN KEY ("project_assignment_id") REFERENCES "ProjectAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimilarityCheck" ADD CONSTRAINT "SimilarityCheck_task_instance_id_fkey" FOREIGN KEY ("task_instance_id") REFERENCES "TaskInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_project_assignment_id_fkey" FOREIGN KEY ("project_assignment_id") REFERENCES "ProjectAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovedTaskRecord" ADD CONSTRAINT "ApprovedTaskRecord_task_instance_id_fkey" FOREIGN KEY ("task_instance_id") REFERENCES "TaskInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovedTaskRecord" ADD CONSTRAINT "ApprovedTaskRecord_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "ApprovedTaskRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RLReviewRecord" ADD CONSTRAINT "RLReviewRecord_rl_review_request_id_fkey" FOREIGN KEY ("rl_review_request_id") REFERENCES "RLReviewRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderIdentity" ADD CONSTRAINT "ProviderIdentity_sme_user_id_fkey" FOREIGN KEY ("sme_user_id") REFERENCES "SmeUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityAttempt" ADD CONSTRAINT "IdentityAttempt_sme_user_id_fkey" FOREIGN KEY ("sme_user_id") REFERENCES "SmeUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlternativeIdentityCheck" ADD CONSTRAINT "AlternativeIdentityCheck_sme_user_id_fkey" FOREIGN KEY ("sme_user_id") REFERENCES "SmeUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityVersion" ADD CONSTRAINT "OpportunityVersion_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_sme_user_id_fkey" FOREIGN KEY ("sme_user_id") REFERENCES "SmeUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_opportunity_version_id_fkey" FOREIGN KEY ("opportunity_version_id") REFERENCES "OpportunityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_profile_version_id_fkey" FOREIGN KEY ("profile_version_id") REFERENCES "ProfileVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSession" ADD CONSTRAINT "ConversationSession_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ConversationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileVersion" ADD CONSTRAINT "ProfileVersion_sme_user_id_fkey" FOREIGN KEY ("sme_user_id") REFERENCES "SmeUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperienceEpisode" ADD CONSTRAINT "ExperienceEpisode_profile_version_id_fkey" FOREIGN KEY ("profile_version_id") REFERENCES "ProfileVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialClaim" ADD CONSTRAINT "CredentialClaim_profile_version_id_fkey" FOREIGN KEY ("profile_version_id") REFERENCES "ProfileVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_sme_user_id_fkey" FOREIGN KEY ("sme_user_id") REFERENCES "SmeUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuitabilityAssessment" ADD CONSTRAINT "SuitabilityAssessment_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionDecision" ADD CONSTRAINT "SelectionDecision_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionDecision" ADD CONSTRAINT "SelectionDecision_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "SuitabilityAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationScope" ADD CONSTRAINT "QualificationScope_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationScope" ADD CONSTRAINT "QualificationScope_selection_decision_id_fkey" FOREIGN KEY ("selection_decision_id") REFERENCES "SelectionDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingChecklist" ADD CONSTRAINT "OnboardingChecklist_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingAcknowledgement" ADD CONSTRAINT "OnboardingAcknowledgement_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "OnboardingChecklist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmeAssignment" ADD CONSTRAINT "SmeAssignment_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmeAssignment" ADD CONSTRAINT "SmeAssignment_sme_user_id_fkey" FOREIGN KEY ("sme_user_id") REFERENCES "SmeUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_sme_user_id_fkey" FOREIGN KEY ("sme_user_id") REFERENCES "SmeUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictDeclaration" ADD CONSTRAINT "ConflictDeclaration_sme_user_id_fkey" FOREIGN KEY ("sme_user_id") REFERENCES "SmeUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CredentialClaimToEvidenceArtifact" ADD CONSTRAINT "_CredentialClaimToEvidenceArtifact_A_fkey" FOREIGN KEY ("A") REFERENCES "CredentialClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CredentialClaimToEvidenceArtifact" ADD CONSTRAINT "_CredentialClaimToEvidenceArtifact_B_fkey" FOREIGN KEY ("B") REFERENCES "EvidenceArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
