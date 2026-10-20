-- Preserve all existing records, accounts, source archives and notification keys.
-- No production seed or synthetic user is created by this migration.
CREATE TABLE "Challenge" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "year" INTEGER NOT NULL,
  "lifecycle" TEXT NOT NULL DEFAULT 'draft',
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "enrollmentDeadline" TEXT NOT NULL,
  "sourceChallengeId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "challenge_lifecycle_check" CHECK ("lifecycle" IN ('draft', 'published', 'archived')),
  CONSTRAINT "challenge_dates_check" CHECK (
    "startDate" ~ '^\d{4}-\d{2}-\d{2}$' AND "endDate" ~ '^\d{4}-\d{2}-\d{2}$'
    AND "enrollmentDeadline" ~ '^\d{4}-\d{2}-\d{2}$'
    AND "startDate"::date <= "endDate"::date
    AND "enrollmentDeadline"::date <= "endDate"::date)
);
CREATE TABLE "ChallengeWeek" (
  "id" TEXT NOT NULL,
  "challengeId" TEXT NOT NULL,
  "week" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "inputType" TEXT NOT NULL,
  "weeklyTarget" DOUBLE PRECISION NOT NULL,
  "dailyTarget" DOUBLE PRECISION,
  "unit" TEXT NOT NULL,
  "dailyUnit" TEXT,
  "color" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "exercises" JSONB,
  CONSTRAINT "ChallengeWeek_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "challenge_week_input_type_check" CHECK ("inputType" IN ('walking', 'check', 'count', 'distance', 'dumbbell')),
  CONSTRAINT "challenge_week_number_check" CHECK ("week" > 0),
  CONSTRAINT "challenge_week_dates_check" CHECK (
    "startDate" ~ '^\d{4}-\d{2}-\d{2}$' AND "endDate" ~ '^\d{4}-\d{2}-\d{2}$'
    AND "startDate"::date <= "endDate"::date),
  CONSTRAINT "challenge_week_target_check" CHECK (
    "weeklyTarget" > 0 AND "weeklyTarget" < 'Infinity'::float8
    AND ("dailyTarget" IS NULL OR ("dailyTarget" > '-Infinity'::float8 AND "dailyTarget" < 'Infinity'::float8))),
  CONSTRAINT "challenge_week_color_check" CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$')
);
CREATE TABLE "ChallengeMembership" (
  "id" TEXT NOT NULL,
  "challengeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "invitedById" TEXT,
  "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChallengeMembership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "challenge_membership_mode_check" CHECK ("mode" IN ('forced', 'invited')),
  CONSTRAINT "challenge_membership_status_check" CHECK ("status" IN ('active', 'pending', 'declined', 'removed'))
);
CREATE INDEX "Challenge_lifecycle_startDate_idx" ON "Challenge"("lifecycle", "startDate");
CREATE UNIQUE INDEX "ChallengeWeek_challengeId_week_key" ON "ChallengeWeek"("challengeId", "week");
CREATE UNIQUE INDEX "ChallengeMembership_challengeId_userId_key" ON "ChallengeMembership"("challengeId", "userId");
CREATE INDEX "ChallengeMembership_userId_status_idx" ON "ChallengeMembership"("userId", "status");
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_sourceChallengeId_fkey" FOREIGN KEY ("sourceChallengeId") REFERENCES "Challenge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChallengeWeek" ADD CONSTRAINT "ChallengeWeek_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeMembership" ADD CONSTRAINT "ChallengeMembership_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeMembership" ADD CONSTRAINT "ChallengeMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeMembership" ADD CONSTRAINT "ChallengeMembership_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DailyRecord" ADD COLUMN "challengeId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "data" JSONB;

INSERT INTO "Challenge" ("id", "title", "year", "lifecycle", "startDate", "endDate", "enrollmentDeadline", "createdById", "updatedAt")
VALUES ('challenge-2026-self-fit', '2026 Self Fit 챌린지', 2026, 'published', '2026-05-04', '2026-09-04', '2026-05-03',
  (SELECT "id" FROM "User" ORDER BY ("role" = 'teacher') DESC, "createdAt", "id" LIMIT 1), CURRENT_TIMESTAMP);

-- Exact legacy definitions; do not regenerate from mutable runtime rules.
INSERT INTO "ChallengeWeek" ("id", "challengeId", "week", "title", "startDate", "endDate", "inputType", "weeklyTarget", "dailyTarget", "unit", "dailyUnit", "color", "description", "exercises") VALUES
('challenge-2026-self-fit-week-1', 'challenge-2026-self-fit', 1, '만보 걷기', '2026-05-04', '2026-05-10', 'walking', 5, 10000, '일', '보', '#E07A2E', '하루 10,000보 이상, 기준을 충족한 5일', NULL),
('challenge-2026-self-fit-week-2', 'challenge-2026-self-fit', 2, '아침 스트레칭', '2026-05-18', '2026-05-24', 'check', 5, 5, '일', '분', '#2E9E6A', '등교 후 5분 스트레칭, 수행 5일', NULL),
('challenge-2026-self-fit-week-3', 'challenge-2026-self-fit', 3, '줄넘기', '2026-05-25', '2026-05-31', 'count', 1000, 200, '회', '회', '#2F7FD8', '하루 200회, 주간 합계 1,000회 이상', NULL),
('challenge-2026-self-fit-week-4', 'challenge-2026-self-fit', 4, '플랭크', '2026-06-01', '2026-06-07', 'check', 5, 1, '일', '분', '#8A5CD6', '1분 이상 유지, 기준을 충족한 5일', NULL),
('challenge-2026-self-fit-week-5', 'challenge-2026-self-fit', 5, '스쿼트', '2026-06-08', '2026-06-14', 'count', 500, NULL, '회', NULL, '#D9486A', '주간 합계 500회 이상', NULL),
('challenge-2026-self-fit-week-6', 'challenge-2026-self-fit', 6, '계단 오르기', '2026-06-15', '2026-06-21', 'check', 5, 20, '일', '층', '#1E9FA8', '하루 20층 이상, 기준을 충족한 5일', NULL),
('challenge-2026-self-fit-week-7', 'challenge-2026-self-fit', 7, '팔굽혀펴기', '2026-06-22', '2026-06-28', 'count', 1000, NULL, '회', NULL, '#C08A12', '주간 합계 1,000회 이상', NULL),
('challenge-2026-self-fit-week-8', 'challenge-2026-self-fit', 8, '러닝·워킹', '2026-06-29', '2026-07-05', 'distance', 10, NULL, 'km', NULL, '#4C6FD1', '주간 합계 10km 이상', NULL),
('challenge-2026-self-fit-week-9', 'challenge-2026-self-fit', 9, '윗몸 일으키기', '2026-07-06', '2026-07-12', 'count', 1000, NULL, '회', NULL, '#C2552B', '주간 합계 1,000회 이상', NULL),
('challenge-2026-self-fit-week-10', 'challenge-2026-self-fit', 10, '버피 테스트', '2026-08-17', '2026-08-23', 'count', 300, 60, '회', '회', '#3C9A3C', '하루 60회, 주간 합계 300회 이상', NULL),
('challenge-2026-self-fit-week-11', 'challenge-2026-self-fit', 11, '홈트 15분', '2026-08-24', '2026-08-30', 'check', 5, 15, '일', '분', '#A2508F', '하루 15분 서킷, 수행 5일', NULL),
('challenge-2026-self-fit-week-12', 'challenge-2026-self-fit', 12, '덤벨 운동', '2026-08-31', '2026-09-04', 'dumbbell', 3, 3, '일', '종목', '#5A6372', '하루 컬·스쿼트·로우 각 10회씩 2세트, 세 종목을 모두 충족한 3일 이상', '[{"id":"D12_CURL","title":"덤벨 컬","repetitions":10,"targetSets":2,"sideRule":"좌우 각각 10회 = 1세트"},{"id":"D12_SQUAT","title":"덤벨 스쿼트","repetitions":10,"targetSets":2,"sideRule":"전체 10회 = 1세트"},{"id":"D12_ROW","title":"덤벨 로우","repetitions":10,"targetSets":2,"sideRule":"좌우 각각 10회 = 1세트"}]');

UPDATE "DailyRecord" SET "challengeId" = 'challenge-2026-self-fit';
ALTER TABLE "DailyRecord" ALTER COLUMN "challengeId" SET NOT NULL;
DROP INDEX "DailyRecord_userId_date_key";
CREATE UNIQUE INDEX "DailyRecord_challengeId_userId_date_key" ON "DailyRecord"("challengeId", "userId", "date");
CREATE INDEX "DailyRecord_userId_date_idx" ON "DailyRecord"("userId", "date");
ALTER TABLE "DailyRecord" ADD CONSTRAINT "DailyRecord_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "ChallengeMembership" ("id", "challengeId", "userId", "mode", "status", "invitedById", "updatedAt")
SELECT 'legacy-membership-' || u."id", 'challenge-2026-self-fit', u."id",
  CASE WHEN u."targetType" = 'required' THEN 'forced' ELSE 'invited' END, 'active',
  (SELECT "id" FROM "User" WHERE "role" = 'teacher' ORDER BY "createdAt", "id" LIMIT 1), CURRENT_TIMESTAMP
FROM "User" u WHERE u."role" = 'student' AND (u."targetType" = 'required' OR (u."targetType" = 'optional' AND u."participating"));

-- A CHECK cannot inspect another table. Deferred constraint triggers check the
-- final transaction state, so replacing weeks and shifting a draft is atomic.
-- Locking the parent serializes concurrent parent/child period edits.
CREATE FUNCTION check_challenge_week_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id text; challenge_start text; challenge_end text;
BEGIN
  IF TG_TABLE_NAME = 'Challenge' THEN parent_id := NEW."id";
  ELSE parent_id := NEW."challengeId"; END IF;
  SELECT "startDate", "endDate" INTO challenge_start, challenge_end FROM "Challenge" WHERE "id" = parent_id FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM "ChallengeWeek" WHERE "challengeId" = parent_id
    AND ("startDate" < challenge_start OR "endDate" > challenge_end)) THEN
    RAISE EXCEPTION 'Challenge week must be inside challenge period' USING ERRCODE = '23514', CONSTRAINT = 'challenge_week_period_check';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER challenge_week_period_check AFTER INSERT OR UPDATE ON "ChallengeWeek"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_challenge_week_period();
CREATE CONSTRAINT TRIGGER challenge_period_weeks_check AFTER UPDATE ON "Challenge"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_challenge_week_period();
