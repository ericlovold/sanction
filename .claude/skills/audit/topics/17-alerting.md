# 17 — Alerting

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** When production breaks, does a human find out from a page — or
from a customer?

## Investigate

- Any alert path at all: uptime monitors, error-tracker alert rules, platform
  notifications (deploy failures, crash loops), cron/job failure notification.
  Evidence lives in configs, IaC, workflow files, or docs.
- Coverage of the fatal cases: site down, error-rate spike, deploy failed,
  database unreachable, certificate expiry, job/queue stuck, budget/credit
  exhaustion on the hosting platform.
- Signal-to-noise design: are alerts actionable and bounded, or will the first
  incident produce 400 emails that get filtered?
- Ownership: is it clear WHO gets alerted, and does the route work for a solo
  founder (phone, not a dashboard nobody watches)?
- Runbooks: for the alerts that exist, is there any "what to do when this
  fires" written down?

## Amateur / AI-built signals

- Uptime monitored by "I use the site most days."
- Alert config pointing at an email/webhook that was never verified.
- Every failure mode discovered so far was reported by a user first.

## Report

Write `audit/alerting.md` per the conventions template. Read-only.
