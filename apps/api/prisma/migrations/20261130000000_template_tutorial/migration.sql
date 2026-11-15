-- MVP1 step 7: the template's tutorial video (display metadata, not part of the authored contract). Additive only.
ALTER TABLE "Template" ADD COLUMN "tutorial_video_url" TEXT;
ALTER TABLE "Template" ADD COLUMN "tutorial_chapters" JSONB;
