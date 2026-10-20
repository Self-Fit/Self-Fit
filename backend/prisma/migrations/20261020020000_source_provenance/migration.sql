-- Preserve original workbook data separately from application-facing users.
CREATE TABLE "SourceDataset" (
    "id" TEXT NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "filename" TEXT NOT NULL,
    "metadataJson" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceDataset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SourceDataset_hash_check" CHECK ("hash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "StudentSource" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rosterJson" JSONB NOT NULL,
    "fitnessJson" JSONB,
    "metadataJson" JSONB,

    CONSTRAINT "StudentSource_pkey" PRIMARY KEY ("id")
);

-- Existing records remain valid without import provenance.
ALTER TABLE "DailyRecord"
    ADD COLUMN "sourceDatasetId" TEXT,
    ADD COLUMN "sourceMetadata" JSONB;

CREATE UNIQUE INDEX "SourceDataset_hash_key" ON "SourceDataset"("hash");
CREATE UNIQUE INDEX "StudentSource_datasetId_userId_key" ON "StudentSource"("datasetId", "userId");
CREATE INDEX "StudentSource_userId_idx" ON "StudentSource"("userId");
CREATE INDEX "DailyRecord_sourceDatasetId_idx" ON "DailyRecord"("sourceDatasetId");

ALTER TABLE "StudentSource" ADD CONSTRAINT "StudentSource_datasetId_fkey"
    FOREIGN KEY ("datasetId") REFERENCES "SourceDataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentSource" ADD CONSTRAINT "StudentSource_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyRecord" ADD CONSTRAINT "DailyRecord_sourceDatasetId_fkey"
    FOREIGN KEY ("sourceDatasetId") REFERENCES "SourceDataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
