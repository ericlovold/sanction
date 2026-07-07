# 28 — LLM / AI integration

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** If this product calls LLMs — is the integration safe, bounded,
and honest about model failure modes?

If the project makes **no LLM/AI calls**, say so, score N/A with a one-line
report, and stop.

## Investigate

- Key custody: provider keys server-side only? Any key reachable from client
  bundles, mobile apps, or repo history (cross-check 01, 27)?
- Spend bounds: per-request `max_tokens`, per-user/tenant quotas, global
  budget caps, retry loops around paid calls with no ceiling, streaming
  abandoned-request handling. What does one malicious user cost?
- Prompt injection surface: user content, retrieved documents, or tool results
  concatenated into prompts that also carry privileged instructions; any
  separation (system vs. user roles, delimiting, sanitization)? What can a
  successful injection actually reach (tools, data, other tenants)?
- Output trust: model output parsed as JSON without validation, rendered as
  HTML unsanitized, executed as code, or used in queries; schema validation /
  constrained decoding where structure matters.
- Tool/agent safety: if the model can invoke tools — allowlists, argument
  validation, human gates on destructive actions, audit logging of tool calls.
- Resilience & UX honesty: provider outage handling (timeout, fallback,
  degrade); hallucination posture — are model answers presented as fact where
  wrongness is costly, with no grounding or disclaimer?
- Privacy: PII sent to providers — under what retention terms, and is that
  disclosed (cross-check topic 29)?

## Amateur / AI-built signals

- The provider key in client-side code "temporarily."
- User input templated straight into a system prompt with admin-ish powers.
- `JSON.parse(response.text)` with no validation, driving real mutations.

## Report

Write `audit/llm-integration.md` per the conventions template. Read-only.
