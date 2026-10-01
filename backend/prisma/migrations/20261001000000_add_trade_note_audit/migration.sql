-- Note history is intentionally not foreign-keyed to TradeNote so deletion of
-- the current note cannot erase its immutable prior-content audit records.
CREATE TABLE "TradeNoteAudit" (
    "id" SERIAL NOT NULL,
    "noteId" INTEGER NOT NULL,
    "tradeId" VARCHAR(255) NOT NULL,
    "authorAddress" VARCHAR(255) NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradeNoteAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TradeNoteAudit_tradeId_noteId_createdAt_idx"
    ON "TradeNoteAudit"("tradeId", "noteId", "createdAt");
CREATE INDEX "TradeNoteAudit_authorAddress_createdAt_idx"
    ON "TradeNoteAudit"("authorAddress", "createdAt");