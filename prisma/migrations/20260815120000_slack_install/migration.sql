-- SLACK-1 OAuth: per-wallet Slack app install. Bot token is envelope-encrypted
-- (app layer); RLS is the DB backstop so a forgotten where clause cannot leak
-- another tenant's token blob.
CREATE TABLE "SlackInstall" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamName" TEXT,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT,
    "botTokenEnc" TEXT NOT NULL,
    "keyId" TEXT,
    "slackUserId" TEXT,
    "events" TEXT[] DEFAULT ARRAY['approval.created', 'approval.resolved', 'escalation.created', 'escalation.resolved', 'budget.threshold']::TEXT[],
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "SlackInstall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SlackInstall_walletId_idx" ON "SlackInstall"("walletId");

CREATE UNIQUE INDEX "SlackInstall_walletId_teamId_key" ON "SlackInstall"("walletId", "teamId");

ALTER TABLE "SlackInstall" ADD CONSTRAINT "SlackInstall_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SlackInstall" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SlackInstall" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "SlackInstall"
  USING ("walletId" = ANY(string_to_array(current_setting('app.wallet_ids', true), ',')))
  WITH CHECK ("walletId" = ANY(string_to_array(current_setting('app.wallet_ids', true), ',')));
