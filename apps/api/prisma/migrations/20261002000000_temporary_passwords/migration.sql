-- Temporary passwords issued by an Admin must be changed at the next sign-in.
ALTER TABLE "User" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PartnerUser" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
