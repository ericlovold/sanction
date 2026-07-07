# 26 — IaaS platforms (raw cloud)

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** If this project touches raw cloud (AWS/GCP/Azure) — are the
classic beginner traps armed?

If the project uses **no raw-cloud services** (pure PaaS — see topic 27), say
so, score N/A with a one-line report, and stop. If it uses one cloud service
(e.g. KMS, S3) alongside a PaaS, audit just that surface.

## Investigate

- IAM: wildcard policies (`Action: *`, `Resource: *`), long-lived root/user
  access keys in env or code vs. roles/OIDC; one god-key shared by everything;
  key rotation evidence.
- Network exposure: security groups/firewalls open to 0.0.0.0/0 on databases,
  SSH, or admin ports; services public that should be private.
- Storage exposure: public buckets/containers; signed-URL discipline;
  encryption-at-rest left off where sensitive data lands.
- Billing guardrails: budgets/alerts configured (IaC or docs); services that
  scale cost with attacker-controlled input left unmetered.
- Account hygiene: everything in one account/project with prod and experiments
  mixed; MFA/console posture where documentation shows it.
- Regionality & durability: single-AZ where the platform makes multi trivial;
  snapshots/lifecycle rules on stateful services.

## Amateur / AI-built signals

- An AWS key pair in `.env.example` — with real-looking values.
- IAM policy copied from Stack Overflow with `"Resource": "*"` and a comment
  saying to fix it later.
- A public S3 bucket because signed URLs were hard.

## Report

Write `audit/iaas-platforms.md` per the conventions template. Read-only —
inspect config and code only; never call cloud APIs mutatingly.
