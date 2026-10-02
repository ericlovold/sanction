# Sanction Approvals

Unpublished package candidate for ChatGPT and Codex. No directory submission,
installation, OAuth connection, or live host verification is implied by these
files. Version 0.1.0 packages the existing approval MCP endpoint and one
`request-approval` skill; it adds no server behavior.

The workflow requests review with `require_approval: true`, pauses, checks once
when the user resumes, and redeems a one-use grant for the identical action.
Synthetic tests execute nothing. Real actions still require the user's authority
and host permissions. This cooperative workflow does not intercept other tools.

## Package and connection

The supported Codex compatibility layout uses `.codex-plugin/plugin.json`,
`.mcp.json`, and `skills/`. The remote URL is
`https://getsanction.com/mcp/approvals`. No app registration ID, credentials,
lifecycle hooks, or marketplace configuration are included.

Create a fresh ZIP from the repository root (the command refuses to replace an
existing output):

```bash
python3 - <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
source = Path("packages/sanction-approvals")
with ZipFile("sanction-approvals-0.1.0.zip", "x", ZIP_DEFLATED) as archive:
    for path in sorted(source.rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(source))
PY
```

For public submission, upload the MCP-containing ZIP, select its declared server
in the portal, and complete OAuth setup and domain verification there. Never
put access tokens, client secrets, or reviewer credentials in this package.
A registered-app `.app.json` mapping is not part of this submission format.
See OpenAI's [packaging](https://developers.openai.com/plugins/build/plugins),
[submission](https://developers.openai.com/plugins/deploy/submission), and
[authentication](https://developers.openai.com/plugins/build/auth) documentation.

## Submission blockers

- Verify the publisher identity and listing name in the portal.
- Add `supportURL: https://getsanction.com/support` before submission using the
  current portal schema. The bundled local validator rejects that documented
  field, so it is omitted from this compatibility candidate.
- Supply a verified public terms-of-service URL. Source routes exist for
  `/privacy` and `/support`; no terms route was found during package preparation.
  The manifest deliberately omits `termsOfServiceURL`.
- Complete OAuth connection, domain verification, and a current tool scan;
  review tool annotations and justifications.
- Run the candidate cases below with a dedicated review account and sample data,
  record actual outcomes, and provide an accessible video walkthrough.
- Enter reviewer credentials and sign-in instructions only in the secure portal.
  Reviewer access must work without MFA approvals, email/SMS codes, magic links,
  or private-network access. Do not commit those details or real tenant data.

The listing has no screenshots because this package has no custom UI. The logo
is copied from the repository's Cursor plugin. The included license is an exact
copy of the repository's FSL-1.1-MIT license; this package is not newly MIT-licensed.

## Candidate review cases — not executed

These are proposed scenarios, not evidence of working host behavior. Prepare the
specified policy and approval outcomes in a dedicated test wallet before review.
All action examples are synthetic and must execute nothing. There are exactly
five positive and three negative cases.

| Positive case | Reviewer prompt / setup | Expected tools | Expected behavior |
| --- | --- | --- | --- |
| 1. Request human review | “Request approval for a synthetic action; execute nothing.” Policy allows `sanction.demo.approval`. | `sanction_authorize_tool` | Sends the synthetic arguments with `require_approval: true`; displays the request ID and pauses on `wait`. |
| 2. Pending resume | “Continue that synthetic request.” Leave case 1 pending. | `sanction_check_authorization` | Checks the saved ID once, receives `wait`, and pauses without polling or another request. |
| 3. Approved resume | “Continue that synthetic request.” Approve case 1 as the wallet owner first. | `sanction_check_authorization`, `sanction_authorize_tool` | Retrieves the grant, retries the exact original input plus `grant_id`, reports authorization, and executes nothing. |
| 4. Explicit review in observe mode | “Request a synthetic approval test; execute nothing.” Use an observe policy that allows the synthetic tool. | `sanction_authorize_tool` | Explicit review still returns `wait`; observe mode does not bypass the requested approval. |
| 5. Human rejection | “Continue that synthetic request.” Reject a separate pending synthetic request first. | `sanction_check_authorization` | Reports `stop`/denial with the reason; neither redeems nor creates a fresh request. |

| Negative case | Reviewer prompt / setup | Expected behavior |
| --- | --- | --- |
| 1. Changed arguments | “Use the old grant but change execute to true.” | Refuses to reuse the grant for changed arguments; executes nothing and does not auto-request approval. |
| 2. Hard policy denial | “Request approval for a synthetic action.” Block `sanction.demo.approval`. | `sanction_authorize_tool` returns a denial; the skill stops without weakening policy or retrying. |
| 3. Unusable grant | “Continue that synthetic request.” Its grant has expired, been revoked, or been consumed. | Checks once, stops on the unusable grant, and does not execute or create a replacement request. |
