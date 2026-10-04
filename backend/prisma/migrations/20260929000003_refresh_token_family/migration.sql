-- AlterTable: existing tokens each start their own family.
ALTER TABLE "RefreshToken" ADD COLUMN "familyId" VARCHAR(255);
UPDATE "RefreshToken" SET "familyId" = "jti" WHERE "familyId" IS NULL;
ALTER TABLE "RefreshToken" ALTER COLUMN "familyId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");
