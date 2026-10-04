-- AlterTable
ALTER TABLE "WebhookSubscription" ADD COLUMN "previousSecretHash" VARCHAR(64),
ADD COLUMN "previousSecretExpiresAt" TIMESTAMP(3);
