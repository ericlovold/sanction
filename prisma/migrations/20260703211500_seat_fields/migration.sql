-- Seat wallets slice 1: a seat is an Agent you can hand around.
-- holder: current human holding the seat (display/audit, never auth-bearing).
-- expiresAt: contractor auto-shutoff; the key fails closed past this instant.
ALTER TABLE "Agent" ADD COLUMN "holder" TEXT;
ALTER TABLE "Agent" ADD COLUMN "expiresAt" TIMESTAMP(3);
