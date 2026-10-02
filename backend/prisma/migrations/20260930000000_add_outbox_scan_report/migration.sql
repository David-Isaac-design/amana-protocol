-- CreateTable
CREATE TABLE "OutboxScanReport" (
    "id" SERIAL NOT NULL,
    "jobId" VARCHAR(255),
    "scanStartTime" TIMESTAMP(3) NOT NULL,
    "scanEndTime" TIMESTAMP(3) NOT NULL,
    "timeWindowMinutes" INTEGER NOT NULL,
    "totalTradesScanned" INTEGER NOT NULL,
    "gapCount" INTEGER NOT NULL,
    "criticalGaps" INTEGER NOT NULL,
    "warningGaps" INTEGER NOT NULL,
    "infoGaps" INTEGER NOT NULL,
    "gaps" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxScanReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboxScanReport_createdAt_idx" ON "OutboxScanReport"("createdAt");
