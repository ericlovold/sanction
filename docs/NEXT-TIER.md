# Sanction — Next Tier (3–9 mo): Neutrality + Identity

> Engineering notes for the "Next" tier of the roadmap (`docs/STRATEGY.md`).
> Centerpiece: **Sanction ID** — verifiable agent identity + integrity
> attestation. Last updated: 2026-06-14. Owner: Eric Lovold.

The Next tier has four workstreams. Three are extensions of what's shipped
(gateway, vault, org layer). One is new and is the moat: **Sanction ID**.

---

## 0. Framing: what we already have to build on

Today's primitives map cleanly onto the identity model:

- `Agent` — has an `apiKeyHash` (a bearer secret). This is *authentication*, not
  *identity*. A bearer key proves "someone holds the key," not "this is the agent
  I approved, unmodified."
- `AgentClearance` — level 1–5 + industry. This is *authorization* (what tier
  it's allowed into), already keyed per agent.
- `ExecutionToken` — short-lived JWT, bounded scope + budget, 15-min TTL. This is
  the *capability* an agent wields for one execution.
- `CredentialVault` — encrypted secrets, gated by `minClearance` + allowlist.

The gap: nothing verifies the agent **is what we approved** and **hasn't been
tampered with** before we hand it clearance, credentials, or spend authority. A
stolen `pxy_` key, a prompt-injected agent, or an agent whose toolset was swapped
all look identical to the system today. Sanction ID closes that.

---

## 1. Gateway as the universal enforcement point

Already provider-agnostic (`app/api/gateway/[provider]/[...path]`). Make it the
headline, not a side feature.

- **Promote** it as the zero-instrumentation way to meter + cap *any* agent's
  model spend: point the base URL at Sanction, pass `x-sanction-key`, done.
- **Extend** metering beyond tokens: any HTTP egress the agent makes through the
  gateway can be attributed + budgeted (the same TransformStream metering hook).
- **Tie** every gateway call to a Sanction ID (below) so spend is attributable to
  a *verified* agent, not just a key. This is the join between "metering" and
  "identity."

No schema change required for v1; the identity binding lands with §3.

---

## 2. Vault-injected provider keys (the bridge to identity)

Today the agent holds its own Anthropic/OpenAI key. Next: **the agent never holds
the provider key.** It holds a Sanction execution token; Sanction injects the
real key at the gateway boundary.

- Store provider keys as normal vault credentials (`type: "api_key"`,
  `scopes: ["anthropic:messages"]`).
- Gateway resolves the execution token → checks clearance/scope → injects the
  decrypted key into the upstream request → strips it from anything logged.
- **Why it matters:** one Sanction key now governs *spend* AND *model access* AND
  (with §3) *identity*. Revoking a Sanction ID instantly cuts a compromised
  agent off from every provider — no key rotation across N services.

This is mostly wiring on top of the existing vault + gateway. The injection audit
trail (`CredentialInjection`) already exists.

---

## 3. Sanction ID — verifiable identity + integrity attestation

**The problem Eric named:** your agents act on your behalf. Before one gets your
credentials or spend authority, you need to verify it **is the agent you
approved** and that it **isn't carrying injected instructions, a swapped
toolset, or malware**. A bearer API key can't tell you any of that.

**The principle:** Sanction sits at the gate between the agent and everything
valuable (money, credentials, actions). So enforce **no trust without
attestation** — defense in depth across four layers:

```
  IDENTITY      →   who is this agent?            (cryptographic, not a bearer key)
  INTEGRITY     →   is it untampered?             (attestation vs. approved baseline)
  AUTHORIZATION →   is it allowed?                (clearance + policy — shipped)
  ENFORCEMENT   →   bounded if it lies            (budget + scope + TTL — shipped)
```

The bottom two already exist and are the safety net: even a fully compromised
agent still hits the spend wall, the per-txn cap, the clearance gate, and the
15-min token TTL. Sanction ID adds the top two so we catch compromise *before*
it spends, not just bound it after.

### 3.1 Identity — cryptographic, per agent

Replace "bearer key = identity" with a keypair the agent proves possession of.

- At registration, the agent (or its owner) generates an Ed25519 keypair.
  Sanction stores the **public** key; the private key never leaves the agent's
  environment.
- The agent authenticates by signing a challenge (or signing each execution-token
  request), not by presenting a reusable secret. Steals of a log line or a
  bearer key no longer grant access.
- This is a DID-shaped identity (`did:sanction:<walletId>:<agentId>`), so it can
  align with emerging agent-identity standards rather than fight them.

```prisma
model AgentIdentity {
  id            String   @id @default(cuid())
  agentId       String   @unique
  publicKey     String              // Ed25519, base64
  did           String   @unique    // did:sanction:<wallet>:<agent>
  status        String   @default("active") // active | suspended | revoked
  createdAt     DateTime @default(now())

  agent         Agent    @relation(fields: [agentId], references: [id])
  attestations  AgentAttestation[]
}
```

### 3.2 Integrity attestation — "is this agent untampered?"

This is the novel part. An agent is defined by more than its key: its **system
prompt, its tool/MCP manifest, its model, and its code/container.** If any of
those changed since approval, it's not the agent you cleared — it may be
injected or backdoored.

Define an **agent baseline** = a set of hashes the owner approves once:

```prisma
model AgentBaseline {
  id            String   @id @default(cuid())
  agentId       String
  label         String              // "v1.2 prod"
  systemPromptHash String           // sha256 of the canonical system prompt
  toolManifestHash String           // sha256 of sorted tool/MCP server list
  modelId       String              // e.g. claude-opus-4-8
  codeDigest    String?             // container image digest / bundle hash
  approvedBy    String              // owner email
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())

  agent         Agent    @relation(fields: [agentId], references: [id])
}
```

At **execution-token request time**, the agent presents a signed **attestation**:

```jsonc
// signed by the agent's private key
{
  "did": "did:sanction:wlt_x:agt_y",
  "nonce": "<server-issued, single-use>",
  "system_prompt_hash": "sha256:...",
  "tool_manifest_hash": "sha256:...",
  "model_id": "claude-opus-4-8",
  "code_digest": "sha256:...",      // optional, when run in a known container
  "runtime": "claude-code|cursor|bedrock|custom"
}
```

Sanction verifies, in order:

1. **Signature** — matches the registered public key (identity).
2. **Freshness** — nonce is one we issued and unused (anti-replay).
3. **Baseline match** — every hash equals the active `AgentBaseline`. A mismatch
   on `system_prompt_hash` is the prompt-injection / prompt-tampering signal; a
   mismatch on `tool_manifest_hash` is the swapped-tool / malware signal; a
   mismatch on `code_digest` is the binary-tampering signal.
4. **Policy gate** — only then run the existing clearance/budget checks and mint
   the `ExecutionToken`.

```prisma
model AgentAttestation {
  id            String   @id @default(cuid())
  identityId    String
  executionTokenId String?           // linked once a token is issued
  verdict       String              // pass | fail
  failReason    String?             // PROMPT_DRIFT | TOOL_DRIFT | CODE_DRIFT | BAD_SIG | REPLAY
  promptHash    String
  toolHash      String
  modelId       String
  createdAt     DateTime @default(now())

  identity      AgentIdentity @relation(fields: [identityId], references: [id])
}
```

New decision codes (extend `lib/decisions.ts`):

```
ATTESTATION_REQUIRED   — no valid attestation presented; agent must attest before acting.
IDENTITY_UNVERIFIED    — signature didn't match the registered key.
INTEGRITY_DRIFT        — prompt/tool/code hash diverged from the approved baseline.
ATTESTATION_REPLAY     — nonce reused/expired.
```

### 3.3 What this does and does NOT solve (honest scope)

**Solves / detects:**
- Stolen bearer key → useless without the private key (identity).
- Tampered system prompt, swapped/added tools, modified code → caught at
  attestation as drift, *before* credentials or spend are granted.
- Mid-session compromise → re-attestation on each execution-token request means a
  swap invalidates the next token; short TTL bounds the window.
- Attribution → every spend/credential event ties to a verified DID, not a key.

**Does NOT fully solve (be honest in marketing):**
- **Runtime prompt injection via untrusted inputs** (a malicious web page or tool
  output that hijacks the agent mid-task). The agent's *definition* can be clean
  and still be steered by poisoned inputs. Sanction's answer is **containment,
  not prevention**: the injected agent still can't exceed budget, breach
  clearance, touch a credential it lacks scope for, or act past the token TTL.
  That's the enforcement layer doing its job — we bound the blast radius even
  when we can't stop the injection.
- We can *add* an optional input-scanning hook (signature/heuristic scan of the
  declared task at authorize time) as a tripwire, but it's defense-in-depth, not
  a guarantee. Don't oversell it.

**Positioning line:** "Sanction ID proves your agent is who it says and hasn't
been tampered with — and even if it's hijacked at runtime, it can't spend, leak,
or act beyond the limits you set."

### 3.4 Threat model summary

| Threat | Caught by | Layer |
|---|---|---|
| Stolen API key | Signature challenge fails | Identity |
| Injected/edited system prompt | `system_prompt_hash` drift | Integrity |
| Malicious tool / MCP server added | `tool_manifest_hash` drift | Integrity |
| Backdoored code / container | `code_digest` drift | Integrity |
| Replayed attestation | Single-use nonce | Integrity |
| Runtime prompt injection (poisoned inputs) | Budget/clearance/scope/TTL caps | Enforcement (contain) |
| Over-spend / wrong category | Policy ladder (shipped) | Authorization |

---

## 4. Org / team layer (the enterprise conversion path)

Once identity exists, the org layer is mostly aggregation:

- **Teams / cost-centers** above wallets; roll spend + attestation status up.
- **Roles** (owner, approver, viewer) on the management plane — today it's a
  single `mgmt` key per wallet.
- **Chargeback** — `TokenLog` + authorization spend already carry `agentId`; add
  a team dimension and the reporting falls out.
- **SSO** (SAML/OIDC) for the dashboard — table stakes for the finance/security
  buyer.
- **Audit export** — every attestation, injection, and decision is already
  persisted; expose a signed, append-only export (the compliance artifact).

This is the layer that converts the CFO/CISO, and it's where neutrality pays off:
one control plane reporting across agents on Claude Code, Cursor, Bedrock, and
custom runtimes.

---

## Suggested build order

1. **Sanction ID v1 — identity only** (keypair registration + signed
   execution-token requests). Immediately kills the stolen-bearer-key risk and
   establishes the DID. Smallest schema change with real security payoff.
2. **Integrity attestation** (baselines + attestation verify in `/authorize` and
   the gateway). The differentiated, demo-able moat — "watch Sanction refuse a
   tampered agent."
3. **Vault-injected provider keys** (§2) — now that identity gates it, this is
   safe and high-leverage.
4. **Org/team layer** (§4) — when the first enterprise conversation needs it.

Ship 1 + 2 as the headline "Sanction ID" launch; they're what make the identity
story real and defensible.
