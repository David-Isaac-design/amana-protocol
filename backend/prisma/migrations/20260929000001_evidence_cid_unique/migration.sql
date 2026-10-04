-- Remove duplicate (tradeId, cid) evidence rows, keeping the earliest.
DELETE FROM "TradeEvidence" a
USING "TradeEvidence" b
WHERE a."tradeId" = b."tradeId" AND a."cid" = b."cid" AND a."id" > b."id";

-- CreateIndex
CREATE UNIQUE INDEX "TradeEvidence_tradeId_cid_key" ON "TradeEvidence"("tradeId", "cid");
