-- CreateEnum
CREATE TYPE "EvidenceRequestStatus" AS ENUM ('OPEN', 'FULFILLED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN "mediatorAddress" VARCHAR(255);

-- CreateTable
CREATE TABLE "DisputeEvidenceRequest" (
    "id" SERIAL NOT NULL,
    "disputeId" INTEGER NOT NULL,
    "tradeId" VARCHAR(255) NOT NULL,
    "requestedBy" VARCHAR(255) NOT NULL,
    "requestedFrom" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "EvidenceRequestStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisputeEvidenceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DisputeEvidenceRequest_disputeId_status_idx" ON "DisputeEvidenceRequest"("disputeId", "status");
CREATE INDEX "DisputeEvidenceRequest_requestedFrom_idx" ON "DisputeEvidenceRequest"("requestedFrom");

-- AddForeignKey
ALTER TABLE "DisputeEvidenceRequest" ADD CONSTRAINT "DisputeEvidenceRequest_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
