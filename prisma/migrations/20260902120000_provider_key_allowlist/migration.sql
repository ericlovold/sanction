-- PROV-1 fix: provider:<id> rows were written with an EMPTY allow-list, which
-- the schema defines as "every agent in the wallet" — so any clearance-5 agent
-- could /exec + /inject the raw provider key. Close them with the gateway-only
-- sentinel (no agent id can match it). /exec now also refuses reserved labels
-- outright, so this is belt to that braces.
UPDATE "CredentialVault"
SET "allowedAgentIds" = ARRAY['gateway-internal-only']::TEXT[]
WHERE "label" LIKE 'provider:%'
  AND cardinality("allowedAgentIds") = 0;
