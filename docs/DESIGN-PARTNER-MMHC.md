# Sanction — Design Partner Brief: MMHC (David Guth)

> **Status (2026-07-01):** David Guth (MN Mental Health Coalition) is **bought in** — implementing Sanction in his new startup. This captures his live ideas as a tracked pilot. Living doc; fold in new notes as they come.

## The deployment in one line
**Tenet** (the agent) does the work; **Sanction** is its authorization plane; **an MMHC admin** holds the approval inbox — the *same* engine whether the action is LLM spend, an MCP tool, or provisioning an Azure seat. Every decision is provenance-logged.

## David's ideas → capability map
| Idea (from David) | Sanction primitive | Status on `main` |
|---|---|---|
| **The vault** (attractive across ideas) | KMS-envelope credential vault + scoped exec-token injection (`/v1/exec` → `/v1/credentials/inject`) | ✅ Shipped |
| **Approve Tenet to individual provisioning** | Per-action authorization + human approval — `POST /v1/authorize/tool` (tool authz, ADR-0009 M3) + escalation → owner approval inbox | ✅ Shipped |
| **Seats in Azure — provision by line and dollar** | Dollar via spend authz (`/v1/authorize`), the action via tool authz; approve over threshold; audit every grant | ◑ Mostly there — needs a thin **"provision" action shape** (resource + line-item + $) so it reads natively instead of two calls |
| **Leftover tokens → reallocate** | Dynamic budget reallocation *within* the org total, on top of the cascade counters (`lib/cascadeBudget.ts`) | ⬜ Net-new (customer-validated) |
| **Healthcare / coalition org structure** | HIPAA/BAA gateway · account-tree org isolation · privilege-sensitive credentials (clearance-gated, ADR-0009 M4) | ◑ Partial / deal-triggered |

## Minimal pilot slice (≈ shippable on `main` today)
1. Tenet calls **`/v1/authorize/tool`** (and `/v1/authorize` for the $) before each provisioning action → approve / deny / **escalate**.
2. Escalations land in the **admin approval inbox** (`/dashboard/approvals`) + email/webhook.
3. Azure service-principal creds live in the **vault**, injected to Tenet only under a short-lived scoped **execution token**.
4. Every action → an **`AuthorizationRequest`** (spend/tool) + **`CredentialInjection`** (secret) row = the audit trail David can show a client/board.
5. Org budget as the **root wallet** with cascade enforcement (a coalition → program → agent tree).

## Net-new builds for the pilot (ranked)
1. **"Provision" action shape** — model `provision` (resource, line-item, quantity, $) so Azure-seat governance is one native call (small: a rule + endpoint, reuses the engine).
2. **Budget reallocation** — move unused sub-budget across the cascade tree toward where it's needed; report the reallocation in the audit. Sits on the counters cascade already writes.
3. **Enterprise / deal-triggered:** HIPAA-eligible gateway (Render BAA), org/multi-tenant hardening, privilege-sensitive credential handling. (Build when the paid pilot commits; entity stood up first.)

## Open questions for David
- Which provider(s) is Tenet provisioning — **Azure only**, or also M365/SaaS seats? Which credential type (service principal, PAT)?
- **Who approves** (single admin, or role-based per program)? What dollar threshold auto-approves vs. escalates?
- Org shape: one coalition wallet with program sub-wallets, or per-entity roots?
- Does any provisioning **description carry PHI**? (drives the no-store / redaction + BAA path)
- Timeline to a live pilot, and what "success" looks like for him.

## Positioning
Traditional IAM governed *Pete's* access per service; for an **agent**, that whole structure collapses into **one Sanction key** — spend + tools + credentials + provisioning, one funded number, every decision defensible. **Sanction makes AI agency defensible.**
