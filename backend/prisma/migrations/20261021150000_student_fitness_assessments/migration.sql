-- Fitness grades are separate from school grades and legacy roster target types.
-- Existing accounts and provenance are unchanged; confirmed sources are imported
-- separately after identity matching and a reviewable dry run.
ALTER TABLE "User"
  ADD COLUMN "fitnessGrade" INTEGER,
  ADD COLUMN "fitnessGradeYear" INTEGER,
  ADD COLUMN "fitnessGradeSemester" INTEGER;

ALTER TABLE "User" ADD CONSTRAINT "user_fitness_projection_check" CHECK (
  ("fitnessGrade" IS NULL AND "fitnessGradeYear" IS NULL AND "fitnessGradeSemester" IS NULL)
  OR ("fitnessGrade" IS NOT NULL AND "fitnessGradeYear" IS NOT NULL AND "fitnessGradeSemester" IS NOT NULL
    AND "fitnessGrade" BETWEEN 1 AND 5 AND "fitnessGradeYear" BETWEEN 1 AND 9999 AND "fitnessGradeSemester" = 2)
);

CREATE INDEX "User_role_fitnessGrade_grade_classNumber_idx" ON "User"("role", "fitnessGrade", "grade", "classNumber");

CREATE TABLE "StudentFitnessAssessment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "semester" INTEGER NOT NULL,
  "grade" INTEGER NOT NULL,
  "score" DOUBLE PRECISION,
  "sourceDatasetId" TEXT NOT NULL,
  "sourceSheet" TEXT NOT NULL,
  "sourceRow" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentFitnessAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fitness_assessment_year_check" CHECK ("year" BETWEEN 1 AND 9999),
  CONSTRAINT "fitness_assessment_semester_check" CHECK ("semester" IN (1, 2)),
  CONSTRAINT "fitness_assessment_grade_check" CHECK ("grade" BETWEEN 1 AND 5),
  CONSTRAINT "fitness_assessment_score_check" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" < 'Infinity'::double precision)),
  CONSTRAINT "fitness_assessment_source_check" CHECK (length(btrim("sourceSheet")) > 0 AND "sourceRow" > 0)
);

CREATE UNIQUE INDEX "StudentFitnessAssessment_userId_year_semester_key" ON "StudentFitnessAssessment"("userId", "year", "semester");
CREATE INDEX "StudentFitnessAssessment_sourceDatasetId_idx" ON "StudentFitnessAssessment"("sourceDatasetId");

ALTER TABLE "StudentFitnessAssessment" ADD CONSTRAINT "StudentFitnessAssessment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentFitnessAssessment" ADD CONSTRAINT "StudentFitnessAssessment_sourceDatasetId_fkey"
  FOREIGN KEY ("sourceDatasetId") REFERENCES "SourceDataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
