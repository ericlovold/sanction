# Sanction Commercial License

**One page · summary only**

Sanction’s server, dashboard, and API are source-available under the
[Functional Source License 1.1 (FSL-1.1-MIT)](https://github.com/ericlovold/sanction/blob/main/LICENSE). That license is
deliberately permissive for **your own use** and deliberately narrow for
**competing offerings**. When your use crosses into a Competing Use (defined
below), you need a **Commercial License** from us.

This document is a plain-language guide for procurement, legal, and partners.
It is **not** a contract. Your signed agreement and the FSL govern.

**Contact:** [Talk to us](https://getsanction.com/#pricing) ·
[Book a call](https://calendly.com/eric-getsanction/30min)

---

## Two ways to use Sanction

| | **FSL (default)** | **Commercial License** |
|---|---|---|
| **Cost** | Free | Negotiated agreement |
| **Who** | Individuals, teams, and orgs governing their **own** AI usage — departments, cost centers, internal fleets | Vendors, platforms, MSPs, regulated deployments at scale |
| **Self-host** | Yes — internal use, modify, fork | Yes — including uses the FSL restricts |
| **Resell / embed as product** | No (Competing Use) | Yes — scope defined in your agreement |
| **Hosted at getsanction.com** | Free for individual & production client work | Enterprise features via agreement |
| **Support / SLA** | Community + docs | Contractual |
| **Converts to MIT** | Each release → MIT after 2 years | Your agreement terms |

The **`sanction-mcp`** client (`npx sanction-mcp`) is **[MIT](https://github.com/ericlovold/sanction/blob/main/packages/sanction-mcp/LICENSE)** —
embed it anywhere, no commercial license required for the client itself.

---

## Always free (no commercial license)

You do **not** need a commercial license to:

- **Use the hosted service** at [getsanction.com](https://getsanction.com) for
  personal, production, and client work (no card).
- **Self-host** Sanction for **your organization’s own agents** — internal
  governance, audit, and policy enforcement.
- **Integrate** via REST, AuthZEN, MCP, SDK, or gateway against your own
  deployment or ours.
- **Modify and fork** the source for internal use (FSL redistribution rules
  apply — include the license).
- **Teach or research** non-commercially with the software.
- **Deliver professional services** (implementation, integration, policy
  design) to a customer who runs Sanction under the FSL for their own use —
  you are not substituting for Sanction as a product.

If you are governing **your** agents, you are almost certainly in Permitted
Purpose territory.

---

## When you need a Commercial License

Under the FSL, a **Competing Use** means making the Software available to
others in a commercial product or service that:

1. **Substitutes for Sanction** — you offer Sanction (or a fork) as your
   product instead of directing users to Sanction or licensing from us.
2. **Substitutes for a Sanction offering** — you replicate a hosted or packaged
   product we already sell using the Software.
3. **Same or substantially similar functionality** — you embed the
   authorization plane (policy engine, wallet/governance, approval loop,
   credential vault, or equivalent) as **your** commercial governance layer
   for third parties.

**Plain English:** building **your product’s** trust layer on our chokepoint
without a license — or running **Sanction-as-a-Service** for others — requires
a Commercial License.

### Typical buyers

| Use case | Why it needs a license |
|---|---|
| **Platform / PaaS vendor** | Embed agent authorization, budgets, and audit as a feature of your platform |
| **MSP / systems integrator at scale** | Operate a multi-tenant governed agent stack as your managed offering |
| **White-label AuthZEN PDP** | Ship Sanction as the decision point behind your brand |
| **Agent framework or gateway** | Bundle substantially similar governance as a paid product module |
| **Sanction Local (air-gapped)** | On-prem / zero-egress deployment for regulated environments — site license |
| **Enterprise hosted agreement** | SSO, policy administration, audit export, SLA, deployment control on getsanction.com |

When in doubt: if **third parties** would pay **you** for governance that
**is** Sanction (or a derivative with the same job), talk to us first.

---

## What a Commercial License agreement covers

Terms are **shaped to your deployment**, not a tier sheet. Agreements commonly
include some or all of:

- **Scope** — entities, environments, seat or evaluation limits, derivative
  work permitted, redistribution rights
- **Deployment** — hosted enterprise, self-hosted, air-gapped (Sanction Local),
  or embedded in your product
- **Support & SLA** — response times, uptime, escalation path
- **Security & compliance** — audit export, customer-managed keys, SOC 2
  attestation (as available), data residency
- **Trademark** — approved use of Sanction name and compatibility badges
  (e.g. “AuthZEN PDP powered by Sanction”)
- **Updates** — access to releases during the term; FSL still applies to
  code you received unless your agreement says otherwise

**Individual use stays free.** A commercial license is for organizations whose
**business model** intersects the authorization plane — not for teams wiring up
their first agent.

---

## Sanction Local

**Sanction Local** is the air-gapped deployment path: private models, zero
egress by design, signed audit trail for assessors. It is aimed at regulated
practices (healthcare, legal, financial) and other environments where hosted
SaaS is not an option.

Local is licensed **per deployment or site**, not self-serve. Same policy
engine and grant spine as hosted Sanction; different trust boundary.

---

## License stack (reference)

| Component | License |
|---|---|
| Server, dashboard, API, SDK source | FSL-1.1-MIT → MIT after 2 years per release |
| `sanction-mcp` npm package | MIT |
| Commercial use beyond FSL | Commercial License (this document) |
| Hosted free tier | No license fee for individual & production client work |

---

## FAQ

**We self-host for one company. Do we need a commercial license?**  
No — internal use is a Permitted Purpose under the FSL.

**We’re a consultancy and deploy Sanction for clients.**  
Generally no — professional services to a licensee are permitted. If you
**operate** Sanction **for** many clients as **your** multi-tenant product,
that is a Competing Use.

**Can we fork and change the UI?**  
Yes for internal use. You cannot offer the fork as a competing commercial
governance product without a license.

**Does the code become open source eventually?**  
Each version converts to MIT two years after release. Your commercial agreement
may grant rights sooner or beyond what MIT allows (e.g. trademark, support).

**What about competing with getsanction.com on price?**  
The FSL exists so the ecosystem can inspect and self-host while sustainable
product development continues. Competing hosted offerings require a commercial
relationship — we’d rather partner than litigate.

---

## Next step

Describe your use case (who runs it, who pays whom, single-tenant vs
multi-tenant, hosted vs on-prem). We’ll confirm whether you’re already covered
by the FSL or scope a Commercial License.

**[Talk to us](https://getsanction.com/#pricing)** ·
**[Book 30 minutes](https://calendly.com/eric-getsanction/30min)**

---

*Sanction · Authorize · Protect · Govern · getsanction.com*
