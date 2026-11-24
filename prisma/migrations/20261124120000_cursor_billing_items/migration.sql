CREATE TABLE "CursorBillingItem" (
  "walletId" TEXT NOT NULL REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "itemHash" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "product" TEXT NOT NULL,
  "chargeCategory" TEXT NOT NULL,
  "usageType" TEXT NOT NULL,
  "currency" TEXT,
  "contracted" DECIMAL(30,10),
  "model" TEXT,
  "promptTokens" INTEGER,
  "completionTokens" INTEGER,
  "cachedPromptTokens" INTEGER,
  "cacheWriteTokens" INTEGER,
  PRIMARY KEY ("walletId", "itemHash")
);
