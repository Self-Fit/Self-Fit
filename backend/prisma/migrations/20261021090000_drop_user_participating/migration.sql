-- Challenge memberships replaced the account-level participation flag. The challenges migration
-- (20261020120000) already backfilled every participating student into the legacy challenge.
ALTER TABLE "User" DROP COLUMN "participating";
