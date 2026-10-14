# CodeRabbit review workflow

Configuration and workflow tuned from a 20-PR audit on 2026-10-13. Recheck subscription entitlements in the billing dashboard before adopting paid features; a YAML toggle does not establish entitlement.

## Before merge

1. Keep work in draft while iterating, then mark ready when tests pass. Draft reviews remain disabled to preserve the review allowance.
2. Check the **latest commit**, not merely a green badge. Require a completed review and inspect the walkthrough for skipped, rate-limited, paused, or still-processing states. In the audit, bot skips and rate limits reported green GitHub statuses.
3. For a bot-authored PR that was skipped, or after the stated rate-limit cooldown, request `@coderabbitai review` once. Verify completion before merging. Use `@coderabbitai full review` only when a complete fresh pass is needed.
4. Verify findings against the implementation. Record fixed, already covered, invalid, or deferred with a reason. A suggestion's severity is not proof of a defect.
5. After a fix, ensure the new head was reviewed. Automatic incremental reviews can pause after five reviewed commits by default; resume deliberately when ready.

These are operator checks, not a new enforced GitHub merge gate. `fail_commit_status` exposes review errors; it does not guarantee that skips or rate limits fail. Do not treat the bot as an automatic merge approver.

## Configuration intent

- Balanced feedback with concrete call-path evidence; no documentation style policing.
- Review details and progress visible; review errors fail their status surface.
- Source reviewed once; the generated MCP bundle is excluded because CI rebuilds it and rejects artifact drift. Keep that CI freshness check in place.
- ESLint, Gitleaks, Semgrep, Prisma checks, repository guidelines, and repository-local learnings remain enabled. These complement the project's own CI.
- Docstring-percentage warnings disabled. Authorization tests and behavioral contracts remain review priorities.

## Use the subscription deliberately

- Use PR chat to ask a bounded question about a finding, authorization path, or missing test. Feed an accepted correction back as repository-local guidance; do not accept suggestions blindly.
- Consider CLI review before opening a large PR, then use GitHub review as the final independent pass. Avoid repeated local/full reviews of unchanged code.
- Unit-test generation is configured, but current pricing lists finishing touches under Team. Verify access before relying on it; generated tests still need meaningful assertions.
- Current Essentials pricing includes MCP connections and issue-tracker integrations. Enable only a specific useful source with appropriate permissions; production credentials and arbitrary integrations are unnecessary for repository review.
- Current Team pricing lists multi-repository analysis and custom pre-merge checks. Neither is needed to fix the coverage gaps above. Paid usage and the coding agent have separate cost implications.

After the next 20 merged PRs, compare completed final-head coverage, confirmed defects, useful test gaps, rejected findings, fixes adopted, and review delay. Keep the subscription if the independent catches and time saved justify its cost; do not use comment volume as the value metric.

Sources: [configuration](https://docs.coderabbit.ai/reference/configuration), [automatic review controls](https://docs.coderabbit.ai/configuration/auto-review), [commands](https://docs.coderabbit.ai/reference/review-commands), [pricing](https://www.coderabbit.ai/pricing). Product terms and defaults can change.
