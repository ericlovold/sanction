# 20 — Infrastructure as code

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** If the hosting account vanished tonight, could this
infrastructure be rebuilt from the repo — or does it live only in dashboards?

## Investigate

- Declared infra: Terraform/Pulumi/CDK/SAM, `render.yaml`/`fly.toml`/
  `vercel.json`, Dockerfiles, compose files. What fraction of the real
  infrastructure do they cover?
- Click-ops residue: settings that exist only in a web console — env vars,
  domains, cron jobs, database config, DNS. Is the gap at least *documented*
  (a runbook listing manual settings), or is it tribal knowledge?
- Drift: does committed config match what docs/code imply is actually deployed
  (stale service names, dead URLs)?
- Secrets in IaC: values inline in committed config vs. referenced from a
  secret store.
- Environments: staging/preview parity — same IaC path, or prod is a special
  snowflake?
- State & safety (if Terraform-class): remote state, locking, plan-before-apply
  in CI.

## Amateur / AI-built signals

- Everything configured in a dashboard; the repo deploys to infrastructure it
  doesn't describe.
- IaC files from a tutorial, referencing resources that don't exist.
- One environment: production, configured by hand, unreproducible.

## Report

Write `audit/infrastructure-as-code.md` per the conventions template. Read-only —
never apply, deploy, or mutate infrastructure.
