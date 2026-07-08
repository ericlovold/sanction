# Sanction + AWS Bedrock Agents (Action Group setup)

> Give a Bedrock Agent a governed wallet: expose Sanction's authorization
> operations as an Action Group so the agent must ask — approve / escalate /
> deny — before it spends, and can check its own budget. The agent key never
> enters the model context; it lives in the Lambda that fronts the API.

**Prerequisites:** a Sanction wallet and agent key (`pxy_…`) — create one at
[getsanction.com/start](https://getsanction.com/start) or `POST /api/v1/wallets`
(see the [Quickstart](QUICKSTART.md)) — plus an AWS account with Bedrock Agents
available in your region.

**First success** (the whole point of this guide): your Bedrock agent calls
`authorizeSpend` against your wallet and acts on a real approved / escalated /
denied decision. Ten minutes if the prerequisites are in hand.

---

## How the pieces fit

Bedrock Action Groups don't call external HTTPS APIs directly — they invoke a
Lambda you own, described by an OpenAPI schema. So the shape is:

```
Bedrock Agent ──(operation + params)──▶ Lambda forwarder ──(HTTPS + x-api-key)──▶ getsanction.com/api/v1
```

Three artifacts, in order: an **operation-subset OpenAPI schema**, a
**forwarder Lambda**, and the **Action Group** wiring them to your agent.

## 1. Trim the OpenAPI schema to an operation subset

Sanction serves its full Bedrock-compatible spec at
[`/api/openapi.json`](https://getsanction.com/api/openapi.json). Don't hand the
agent all of it — Bedrock caps operations per action group, and a smaller
surface makes tool selection sharper. This subset covers the governed-spend
loop end to end:

| Operation | Method + path | Why the agent needs it |
|---|---|---|
| `authorizeSpend` | `POST /authorize` | The core ask-before-spending check |
| `authorizeTool` | `POST /authorize/tool` | Governance for tool/MCP invocations |
| `getAuthorizationRequest` | `GET /authorize/{id}` | Poll an escalation; returns the one-use `grant_id` after human approval |
| `getWalletStats` | `GET /wallets/stats` | Budget self-awareness ("how much do I have left?") |

Download the spec and keep only those four paths (plus
`components`, which the `$ref`s need):

```bash
curl -s https://getsanction.com/api/openapi.json | jq '{
  openapi, info, servers, components,
  paths: { "/authorize": .paths."/authorize",
           "/authorize/tool": .paths."/authorize/tool",
           "/authorize/{id}": .paths."/authorize/{id}",
           "/wallets/stats": .paths."/wallets/stats" }
}' > sanction-action-group.json
```

Upload it to S3 (or paste it inline in the console later):

```bash
aws s3 cp sanction-action-group.json s3://YOUR-BUCKET/sanction-action-group.json
```

## 2. Auth header strategy: the key lives in the Lambda, not the prompt

Sanction's data plane authenticates with the agent key in an `x-api-key`
header (`AgentApiKey` in the spec). The rules:

- **The `pxy_` agent key goes in AWS Secrets Manager** and is read by the
  forwarder Lambda. It is never placed in agent instructions, knowledge
  bases, or session attributes — anything in model context can be echoed
  back out.
- **One Bedrock agent ↔ one Sanction agent key.** Spend and token usage
  attribute to that agent; run several Bedrock agents against one wallet by
  registering an agent (`POST /agents`) per Bedrock agent.
- **The `sk_` management key never touches AWS.** Approving escalations is a
  human act — dashboard or management-plane API from an operator machine.

```bash
aws secretsmanager create-secret \
  --name sanction/agent-key \
  --secret-string '{"x_api_key":"pxy_live_..."}'
```

## 3. The forwarder Lambda

A thin, generic bridge: Bedrock hands it `(apiPath, httpMethod, parameters,
requestBody)`; it replays that against `https://getsanction.com/api/v1` with
the key attached, and returns the JSON body in Bedrock's response envelope.
No per-operation code — adding an operation later is a schema change only.

```python
# lambda_function.py — Python 3.12, no dependencies outside the stdlib + boto3
import json, urllib.request, urllib.error
import boto3

SANCTION_API = "https://getsanction.com/api/v1"
_secret = None

def _api_key():
    global _secret
    if _secret is None:
        sm = boto3.client("secretsmanager")
        raw = sm.get_secret_value(SecretId="sanction/agent-key")["SecretString"]
        _secret = json.loads(raw)["x_api_key"]
    return _secret

def lambda_handler(event, _context):
    api_path = event["apiPath"]                      # e.g. /authorize
    method = event["httpMethod"].upper()

    # Path parameters: substitute {request_id} etc.; query params for GETs.
    query = {}
    for p in event.get("parameters") or []:
        if "{" + p["name"] + "}" in api_path:
            api_path = api_path.replace("{" + p["name"] + "}", p["value"])
        else:
            query[p["name"]] = p["value"]

    body = None
    rb = (event.get("requestBody") or {}).get("content", {}).get("application/json", {})
    if rb.get("properties"):
        body = json.dumps({p["name"]: p["value"] for p in rb["properties"]}).encode()

    url = SANCTION_API + api_path
    if query:
        url += "?" + "&".join(f"{k}={v}" for k, v in query.items())

    req = urllib.request.Request(url, data=body, method=method, headers={
        "x-api-key": _api_key(),
        "content-type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status, payload = resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        # 403 (denied) and 402 (over budget) are decisions, not failures —
        # pass them through so the agent can replan on the machine code.
        status, payload = e.code, e.read().decode()

    return {
        "messageVersion": "1.0",
        "response": {
            "actionGroup": event["actionGroup"],
            "apiPath": event["apiPath"],
            "httpMethod": event["httpMethod"],
            "httpStatusCode": status,
            "responseBody": {"application/json": {"body": payload}},
        },
    }
```

Grant the Lambda's execution role `secretsmanager:GetSecretValue` on the
secret, and add a resource-based policy so Bedrock may invoke it:

```bash
aws lambda add-permission \
  --function-name sanction-forwarder \
  --statement-id bedrock-invoke \
  --action lambda:InvokeFunction \
  --principal bedrock.amazonaws.com
```

## 4. Create the Action Group on your agent

Console: **Bedrock → Agents → your agent → Action groups → Add** — select
*Define with API schemas*, point at the Lambda and the S3 schema. CLI:

```bash
aws bedrock-agent create-agent-action-group \
  --agent-id YOUR_AGENT_ID --agent-version DRAFT \
  --action-group-name sanction-api \
  --action-group-executor lambda=arn:aws:lambda:REGION:ACCOUNT:function:sanction-forwarder \
  --api-schema s3='{s3BucketName=YOUR-BUCKET,s3ObjectKey=sanction-action-group.json}'
```

Then add the governance contract to the **agent instructions** — Bedrock
chooses tools from the schema's descriptions, but the always-ask rule belongs
in the instructions:

> Before any purchase, subscription, or transfer, you MUST call
> `authorizeSpend` and follow the decision. Never proceed on `denied`. On
> `escalated`, tell the user a human approval is pending; once approved,
> retry the same request with the `grant_id` from `getAuthorizationRequest`.
> Check `getWalletStats` when planning multi-step spending.

Finally **Prepare** the agent (console button or `aws bedrock-agent
prepare-agent`) so the draft picks up the new action group.

## 5. First governed decision (verify it works)

In the console's **Test** pane (or `invoke-agent`), prompt:

> Buy a $9 GitHub Actions subscription for the CI project.

Watch the trace: the agent should call `authorizeSpend` with
`{action: "subscribe", amount_usd: 9, merchant: "GitHub Actions",
category: "software"}` and report the decision. Confirm the other two
outcomes while you're there — an amount over your per-transaction limit
(escalates; approve it from the [dashboard](https://getsanction.com/dashboard)
and watch the grant retry), and a blocked category (denies with a reason).
Every decision is now in your audit feed with the full context recorded.

## Troubleshooting

- **Agent answers without calling the tool** → the always-ask rule is
  missing from instructions, or the agent wasn't re-prepared after the
  action group was added.
- **`401` from the API** → the Lambda read a stale/wrong secret; confirm the
  `pxy_` key with `GET /stats` via curl.
- **Schema validation errors on create** → Bedrock requires OpenAPI 3.0 with
  an `operationId` and description per operation — the served spec has both;
  re-check your `jq` trim kept `components`.
- **Denied vs. broken** → `403` bodies carry `code` + `reason`
  (see [decision codes](CONCEPTS-AUTHORIZATION.md)); they're the product
  working, not an integration failure.

## Reference

- [Quickstart](QUICKSTART.md) · [Gateway](GATEWAY.md) (meter Bedrock model
  calls too, if your agent's LLM traffic should count against the budget)
- [OpenAPI spec](https://getsanction.com/api/openapi.json) ·
  [Authorization concepts](CONCEPTS-AUTHORIZATION.md) ·
  [Domain glossary](DOMAIN.md)
